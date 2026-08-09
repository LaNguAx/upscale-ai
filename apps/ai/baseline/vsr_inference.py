"""
VSR Backend Inference Module
-----------------------------
Self-contained inference function for the Upscale backend.

Usage:
    from vsr_inference import VSRInferenceEngine

    engine = VSRInferenceEngine(
        checkpoint_path="vsr_model_best.pth",
        device="cuda"
    )

    # Process a video file
    engine.process_video(
        input_path="user_uploaded.mp4",
        output_path="enhanced_output.mp4",
        max_height=480,  # taller input is rejected unless the policy allows it
        progress_callback=lambda done, total: print(f"{done}/{total}")
    )

Frames are streamed: only a rolling window of ``seq_len`` frames is ever held in
memory, so RAM is O(seq_len) rather than O(video length). Each model call
super-resolves its whole window, and ``context_radius`` controls how many of
those outputs are kept per call (see ``windowing.iter_chunks``).

Model requirements (all from the architecture file):
    - SPyNet + BasicVSR (num_prop_blocks=20, seq_len=15, scale=4)
    - PyTorch >= 2.0
    - GPU with >= 8GB VRAM recommended for 720p output

The checkpoint file must have been trained with matching architecture params.
"""

import logging
import subprocess
import tempfile
from collections import deque
from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np
import torch

# Import the model architecture (place model_architecture.py next to this file)
from .model_architecture import BasicVSRRecurrentSeq
from .windowing import HighResPolicy, ResolutionTooHighError, next_chunk, target_size

logger = logging.getLogger(__name__)

DEFAULT_FPS = 30.0  # fallback for videos with broken metadata


class InferenceCancelledError(RuntimeError):
    """Raised when inference is cancelled mid-run."""


def _transcode_for_opencv(input_path: str) -> str:
    """Re-encode to H.264 in a temp file so OpenCV can decode it."""
    temp_dir = tempfile.gettempdir()
    temp_output = str(Path(temp_dir) / f"{Path(input_path).stem}_opencv_fallback.mp4")
    command = [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        temp_output,
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"Cannot decode video and ffmpeg fallback failed for {input_path}: "
            f"{result.stderr.strip() or result.stdout.strip()}"
        )
    return temp_output


class _FrameSource:
    """Streaming video reader that always releases what it opens.

    Yields one raw BGR frame per :meth:`read` call. If OpenCV cannot decode the
    input, it transcodes once via ffmpeg and reads that instead; the temp file is
    removed on exit no matter how the block is left.

    The first frame is decoded eagerly to learn the source dimensions and is then
    cached and replayed by the first :meth:`read` — the original implementation
    seeked back with ``CAP_PROP_POS_FRAMES``, which is unreliable on some codecs.
    """

    def __init__(self, input_path: str):
        self._input_path = input_path
        self._cap: cv2.VideoCapture | None = None
        self._fallback_path: str | None = None
        self._pending_first: np.ndarray | None = None
        self.fps: float = DEFAULT_FPS
        self.width: int = 0
        self.height: int = 0
        self.frame_count_hint: int = 0

    def __enter__(self) -> "_FrameSource":
        try:
            self._open()
        except Exception:
            self.close()
            raise
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def _open(self) -> None:
        source_path = self._input_path
        self._cap = cv2.VideoCapture(source_path)
        fps = self._cap.get(cv2.CAP_PROP_FPS)
        ok, first = self._cap.read()

        if not ok:
            # Undecodable by OpenCV — transcode once and retry.
            self._cap.release()
            self._cap = None
            self._fallback_path = _transcode_for_opencv(self._input_path)
            source_path = self._fallback_path
            self._cap = cv2.VideoCapture(source_path)
            fps = self._cap.get(cv2.CAP_PROP_FPS) or fps
            ok, first = self._cap.read()
            if not ok:
                raise RuntimeError(f"Cannot read video: {self._input_path}")

        self.fps = fps if fps and fps > 0 else DEFAULT_FPS
        self._pending_first = first
        self.height, self.width = first.shape[:2]
        self.frame_count_hint = self._probe_frame_count(source_path)

    def _probe_frame_count(self, source_path: str) -> int:
        """Best-effort total frame count, used only to pace progress reporting.

        Prefers the container's metadata; falls back to a ``grab()``-only pass
        (no decoding, so it is cheap) when that is missing or nonsensical.
        Scheduling never depends on this value — the pipeline is EOF-driven.
        """
        assert self._cap is not None
        reported = int(self._cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if reported > 0:
            return reported

        counter = cv2.VideoCapture(source_path)
        try:
            count = 0
            while counter.grab():
                count += 1
            return count
        except Exception:  # pragma: no cover - defensive
            return 0
        finally:
            counter.release()

    def read(self) -> Optional[np.ndarray]:
        """Return the next raw BGR frame, or ``None`` at end of stream."""
        if self._pending_first is not None:
            frame = self._pending_first
            self._pending_first = None
            return frame
        if self._cap is None:
            return None
        ok, frame = self._cap.read()
        return frame if ok else None

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        self._pending_first = None
        if self._fallback_path:
            Path(self._fallback_path).unlink(missing_ok=True)
            self._fallback_path = None


class VSRInferenceEngine:
    """Runs VSR inference on videos by streaming a rolling temporal window."""

    def __init__(
        self,
        checkpoint_path: str,
        device: str = "cuda",
        seq_len: int = 15,
        scale: int = 4,
        context_radius: int = 1,
        high_res_policy: HighResPolicy = HighResPolicy.REJECT,
    ):
        self.device = torch.device(device if torch.cuda.is_available() else "cpu")
        self.seq_len = seq_len
        self.scale = scale
        self.half = seq_len // 2
        if not 0 <= context_radius <= self.half:
            raise ValueError(
                f"context_radius must be in [0, {self.half}], got {context_radius}"
            )
        self.context_radius = context_radius
        self.high_res_policy = high_res_policy

        self.model = BasicVSRRecurrentSeq(
            seq_len=seq_len,
            scale=scale,
            num_feats=64,
            num_extract_blocks=5,
            num_prop_blocks=20,
            num_recon_blocks=5,
        ).to(self.device)

        state = torch.load(checkpoint_path, map_location=self.device)
        self.model.load_state_dict(state)
        self.model.eval()
        logger.info(f"[VSR] Loaded checkpoint: {checkpoint_path} on {self.device}")

    def _frame_to_tensor(self, frame_bgr: np.ndarray) -> torch.Tensor:
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        return torch.from_numpy(frame_rgb.transpose(2, 0, 1)).float() / 255.0

    def _tensor_to_frame(self, sr_tensor: torch.Tensor) -> np.ndarray:
        sr_rgb = (sr_tensor.numpy().transpose(1, 2, 0).clip(0, 1) * 255).astype(np.uint8)
        return cv2.cvtColor(sr_rgb, cv2.COLOR_RGB2BGR)

    @torch.no_grad()
    def _run_chunk(
        self, window: list[torch.Tensor], keep_lo: int, keep_hi: int
    ) -> torch.Tensor:
        """Super-resolve one window, returning only the outputs worth keeping.

        The model produces an output for every frame it is given, so slicing here
        (rather than re-running per frame) is what makes larger ``context_radius``
        values cheaper.
        """
        batch = torch.stack(window, dim=0).unsqueeze(0).to(self.device)

        if batch.shape[1] < self.seq_len:
            # Only reachable for clips shorter than seq_len: repeat the last
            # frame, matching the original engine's short-clip fallback.
            pad_count = self.seq_len - batch.shape[1]
            padding = batch[:, -1:].repeat(1, pad_count, 1, 1, 1)
            batch = torch.cat([batch, padding], dim=1)

        pred = self.model(batch)
        out = pred[0, keep_lo:keep_hi].cpu()
        del pred, batch
        return out

    def _resolve_size(
        self, source: _FrameSource, max_height: int, policy: HighResPolicy
    ) -> tuple[int, int]:
        """Pick the inference resolution and log any downscale explicitly."""
        lr_w, lr_h = target_size(source.width, source.height, max_height, policy)
        if (lr_w, lr_h) != (source.width, source.height):
            downscaled = lr_h != source.height and source.height > max_height
            reason = (
                f"exceeds max_height={max_height}"
                if downscaled
                else "odd dimensions are not codec-safe"
            )
            logger.warning(
                f"[VSR] Resizing input {source.width}x{source.height} -> "
                f"{lr_w}x{lr_h} ({reason})"
            )
        return lr_w, lr_h

    def process_video(
        self,
        input_path: str,
        output_path: str,
        max_height: int = 480,
        progress_callback: Optional[Callable[[int, int], None]] = None,
        should_cancel: Optional[Callable[[], bool]] = None,
        preview_callback: Optional[Callable[[int, int, np.ndarray, np.ndarray], None]] = None,
        high_res_policy: Optional[HighResPolicy] = None,
    ) -> dict:
        """
        Process a full video and save enhanced output.

        Frames are streamed through a rolling buffer of at most ``seq_len``
        frames, so memory does not grow with video length.

        Args:
            preview_callback, when provided, receives (frame_number, total_frames,
            enhanced_bgr_frame, input_bgr_frame) for every frame after it is
            written; sampling and any I/O are the caller's responsibility.

            high_res_policy overrides the engine default for this call.

        Raises:
            ResolutionTooHighError: input is taller than ``max_height`` and the
                effective policy is ``HighResPolicy.REJECT``.
            InferenceCancelledError: ``should_cancel`` returned True.

        Returns: {"frames": N, "fps": float, "input_res": (w, h), "output_res": (w, h)}
        """
        policy = self.high_res_policy if high_res_policy is None else high_res_policy

        with _FrameSource(input_path) as source:
            lr_w, lr_h = self._resolve_size(source, max_height, policy)
            sr_w, sr_h = lr_w * self.scale, lr_h * self.scale
            needs_resize = (lr_w, lr_h) != (source.width, source.height)
            fps = source.fps

            logger.info(
                f"[VSR] Streaming {lr_w}x{lr_h} -> {sr_w}x{sr_h} "
                f"(seq_len={self.seq_len}, context_radius={self.context_radius})"
            )

            writer = cv2.VideoWriter(
                output_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (sr_w, sr_h)
            )
            if not writer.isOpened():
                writer.release()
                raise RuntimeError(
                    f"Cannot open video writer for {output_path} at {sr_w}x{sr_h}"
                )

            try:
                frames_written = self._stream(
                    source=source,
                    writer=writer,
                    size=(lr_w, lr_h),
                    needs_resize=needs_resize,
                    progress_callback=progress_callback,
                    should_cancel=should_cancel,
                    preview_callback=preview_callback,
                )
            finally:
                writer.release()

        if frames_written == 0:
            # Don't leave a zero-frame file behind for the caller to publish.
            Path(output_path).unlink(missing_ok=True)
            raise RuntimeError(f"No decodable frames found in {input_path}")

        logger.info(f"[VSR] Saved: {output_path} ({frames_written} frames)")

        return {
            "frames": frames_written,
            "fps": fps,
            "input_res": (lr_w, lr_h),
            "output_res": (sr_w, sr_h),
        }

    def _stream(
        self,
        source: _FrameSource,
        writer: "cv2.VideoWriter",
        size: tuple[int, int],
        needs_resize: bool,
        progress_callback: Optional[Callable[[int, int], None]],
        should_cancel: Optional[Callable[[], bool]],
        preview_callback: Optional[Callable[[int, int, np.ndarray, np.ndarray], None]],
    ) -> int:
        """Drive the rolling buffer and write every output frame in order.

        The deque holds the most recent ``seq_len`` frames, so its contents are
        always exactly the window starting at ``frames_read - seq_len``. That
        makes the final window fall out for free at EOF, with no backward seek.
        """
        seq_len, radius = self.seq_len, self.context_radius
        buffer: deque[torch.Tensor] = deque(maxlen=seq_len)
        frames_read = 0
        next_out = 0
        eof = False

        def fill_to(target: int) -> None:
            nonlocal frames_read, eof
            while not eof and frames_read < target:
                frame = source.read()
                if frame is None:
                    eof = True
                    return
                if needs_resize:
                    frame = cv2.resize(frame, size, interpolation=cv2.INTER_AREA)
                buffer.append(self._frame_to_tensor(frame))
                frames_read += 1

        def emit(chunk) -> None:
            """Run one chunk and write its kept frames."""
            nonlocal next_out
            sr_frames = self._run_chunk(list(buffer), chunk.keep_lo, chunk.keep_hi)

            for offset, sr_tensor in enumerate(sr_frames):
                if should_cancel and should_cancel():
                    raise InferenceCancelledError("Upscaling cancelled by user")

                frame_number = chunk.keep_start + offset + 1  # 1-indexed, no gaps
                sr_bgr = self._tensor_to_frame(sr_tensor)
                writer.write(sr_bgr)

                total = max(source.frame_count_hint, frame_number)
                if progress_callback:
                    progress_callback(frame_number, total)
                if preview_callback:
                    preview_callback(
                        frame_number,
                        total,
                        sr_bgr,
                        self._tensor_to_frame(buffer[chunk.keep_lo + offset]),
                    )
            next_out = chunk.keep_end

        # Steady state: emit each chunk as soon as its full window is buffered.
        # `total=None` keeps the schedule EOF-driven — no frame count needed yet.
        while True:
            chunk = next_chunk(next_out, seq_len, radius, total=None)
            assert chunk is not None  # total=None never terminates the schedule
            fill_to(chunk.window_end)
            if eof:
                break
            emit(chunk)

        # EOF: the frame count is known, and because the deque keeps the most
        # recent seq_len frames it already holds the final window verbatim.
        total_frames = frames_read
        if total_frames == 0:
            return 0

        tail = next_chunk(next_out, seq_len, radius, total=total_frames)
        if tail is not None:
            emit(tail)

        return total_frames
