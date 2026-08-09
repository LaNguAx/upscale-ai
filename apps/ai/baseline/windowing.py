"""Pure scheduling and sizing helpers for VSR inference.

Dependency-free by design (no torch, cv2, or FastAPI) so ``test_windowing.py``
runs fast anywhere — the same split ``security.py`` uses for the server's
validation helpers.

Two concerns live here:

* **Chunk scheduling** (:func:`iter_chunks`) — decides which frames each model
  forward pass covers and which of its outputs are kept. ``BasicVSRRecurrentSeq``
  returns super-resolved outputs for *every* frame in the window it is given, so
  keeping more than one per call is free compute we already paid for.
* **Target sizing** (:func:`target_size`) — resolves the input resolution under
  an explicit :class:`HighResPolicy`, always landing on codec-safe even
  dimensions.
"""

from enum import Enum
from typing import Iterator, NamedTuple


class HighResPolicy(str, Enum):
    """What to do with input taller than the configured ``max_height``."""

    REJECT = "reject"
    """Refuse the video (default). Nothing is silently degraded."""

    DOWNSCALE = "downscale"
    """Downscale to ``max_height``, aspect preserved, and log that it happened."""

    NATIVE = "native"
    """Run at native resolution. Output is ``scale``x larger — VRAM-hungry."""


class ResolutionTooHighError(RuntimeError):
    """Input exceeds ``max_height`` and the policy is :attr:`HighResPolicy.REJECT`.

    Subclasses ``RuntimeError`` so the server's existing broad handler turns it
    into a ``failed`` NDJSON line without extra plumbing.
    """


class Chunk(NamedTuple):
    """One model forward pass and the slice of its outputs worth keeping.

    ``window_start``/``window_end`` bound the frames fed to the model;
    ``keep_start``/``keep_end`` bound the frames whose outputs are written.
    Offsets within the returned tensor are ``keep_start - window_start`` to
    ``keep_end - window_start``.
    """

    window_start: int
    window_end: int
    keep_start: int
    keep_end: int

    @property
    def keep_lo(self) -> int:
        """Index of the first kept frame within the window."""
        return self.keep_start - self.window_start

    @property
    def keep_hi(self) -> int:
        """Index one past the last kept frame within the window."""
        return self.keep_end - self.window_start


def even_dim(value: int) -> int:
    """Round *down* to the nearest even number, floored at 2.

    H.264 with ``yuv420p`` chroma subsampling requires even width and height.
    An odd width silently breaks the ``{jobId}_original.mp4`` comparison encode,
    which scales ffmpeg to exactly the inference resolution.
    """
    return max(2, value - (value % 2))


def target_size(
    orig_w: int,
    orig_h: int,
    max_height: int,
    policy: HighResPolicy,
) -> tuple[int, int]:
    """Resolve the inference resolution, always even.

    Raises:
        ResolutionTooHighError: input is taller than ``max_height`` and the
            policy is :attr:`HighResPolicy.REJECT`.
    """
    if orig_w <= 0 or orig_h <= 0:
        raise ValueError(f"Invalid source dimensions: {orig_w}x{orig_h}")

    if orig_h <= max_height or policy is HighResPolicy.NATIVE:
        return even_dim(orig_w), even_dim(orig_h)

    if policy is HighResPolicy.REJECT:
        raise ResolutionTooHighError(
            f"Input resolution {orig_w}x{orig_h} exceeds the maximum supported "
            f"height of {max_height}px. Set HIGH_RES_POLICY=downscale to "
            f"downscale it automatically, or re-encode the video first."
        )

    scale = max_height / orig_h
    return even_dim(round(orig_w * scale)), even_dim(max_height)


def _validate(seq_len: int, context_radius: int) -> int:
    if seq_len % 2 == 0:
        raise ValueError(f"seq_len must be odd, got {seq_len}")
    half = seq_len // 2
    if not 0 <= context_radius <= half:
        raise ValueError(f"context_radius must be in [0, {half}], got {context_radius}")
    return half


def next_chunk(
    next_out: int,
    seq_len: int,
    context_radius: int,
    total: int | None = None,
) -> Chunk | None:
    """Decide the single chunk that starts at ``next_out``.

    ``total`` is the frame count when known. Streaming callers pass ``None``
    until they hit EOF: without it the window is only bounded from below, which
    is all that is needed while frames are still arriving. Once ``total`` is
    known the window is additionally clamped to the end of the video, which is
    what reproduces the original implementation's shift-window behaviour for the
    final frames.

    Returns ``None`` when there is nothing left to emit.
    """
    half = _validate(seq_len, context_radius)

    if total is not None:
        if next_out >= total or total <= 0:
            return None
        if total < seq_len:
            # Not enough frames for a full window; the caller repeats the last
            # frame to reach seq_len, matching the original short-clip fallback.
            return Chunk(0, total, next_out, total)

    window_start = max(next_out + context_radius - half, 0)

    if total is None:
        keep_end = window_start + half + context_radius + 1
    else:
        last_start = total - seq_len
        window_start = min(window_start, last_start)
        if window_start >= last_start:
            keep_end = total  # final window: take everything that remains
        else:
            keep_end = min(total, window_start + half + context_radius + 1)

    if keep_end <= next_out:  # defensive: guarantee forward progress
        keep_end = next_out + 1

    return Chunk(window_start, window_start + seq_len, next_out, keep_end)


def iter_chunks(n: int, seq_len: int, context_radius: int) -> Iterator[Chunk]:
    """Schedule forward passes over ``n`` frames, yielding chunks in frame order.

    A convenience wrapper over :func:`next_chunk` for callers that already know
    the frame count (and for tests). The streaming engine drives ``next_chunk``
    directly instead, since it only learns ``n`` at EOF.

    Every frame is covered exactly once across all chunks, so callers can write
    output sequentially without gaps or duplicates.

    ``context_radius`` (T) trades temporal context for speed. Each pass keeps up
    to ``2T+1`` outputs from the middle of its window, so a kept frame always has
    at least ``half - T`` real frames of context on its thinner side:

    * ``T=0`` — one output per pass, always window-centred. Reproduces the
      original per-frame behaviour exactly, at ``n`` forward passes.
    * ``T=1`` (default) — 3 outputs per pass, >=6 frames of context, ~3x fewer passes.
    * ``T=half`` — whole window kept, ~``seq_len``x fewer passes, but frames at
      chunk edges get no context on one side.

    Windows shift rather than pad at the true start and end of the video, so the
    first and last frames get the identical window the original implementation
    gave them. Videos shorter than ``seq_len`` yield a single short chunk that
    the caller is expected to pad.
    """
    _validate(seq_len, context_radius)
    next_out = 0
    while True:
        chunk = next_chunk(next_out, seq_len, context_radius, total=n)
        if chunk is None:
            return
        yield chunk
        next_out = chunk.keep_end
