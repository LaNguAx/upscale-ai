"""Unit tests for the VSR chunk scheduler and sizing helpers.

These import only ``baseline/windowing.py`` (no torch / cv2 / GPU), so they run
fast in any environment. Run with ``pytest`` or directly:
``python test_windowing.py``.

``windowing`` is loaded as a top-level module rather than via
``baseline.windowing`` on purpose: ``baseline/__init__.py`` pulls in the model
architecture and therefore torch, which would defeat the point.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "baseline"))

from windowing import (  # noqa: E402
    HighResPolicy,
    ResolutionTooHighError,
    even_dim,
    iter_chunks,
    next_chunk,
    target_size,
)

SEQ_LEN = 15
HALF = SEQ_LEN // 2
FRAME_COUNTS = [1, 2, 5, 14, 15, 16, 17, 31, 100, 1801]


def reference_window(center: int, n: int, seq_len: int = SEQ_LEN) -> tuple[int, int]:
    """The original ``_process_window`` window selection, kept as an oracle.

    Returns ``(window_start, offset_in_window)`` for one output frame, exactly as
    the pre-refactor engine computed it.
    """
    half = seq_len // 2
    start = max(0, center - half)
    end = min(n, start + seq_len)
    start = max(0, end - seq_len)
    return start, center - start


def kept_frames(n: int, context_radius: int, seq_len: int = SEQ_LEN):
    """Flatten a schedule into ``{frame: (window_start, offset)}``."""
    placement = {}
    for chunk in iter_chunks(n, seq_len, context_radius):
        for frame in range(chunk.keep_start, chunk.keep_end):
            placement[frame] = (chunk.window_start, frame - chunk.window_start)
    return placement


# --- Coverage: every frame written exactly once, in order ---


def test_covers_every_frame_exactly_once():
    for n in FRAME_COUNTS:
        for radius in range(0, HALF + 1):
            chunks = list(iter_chunks(n, SEQ_LEN, radius))
            written = [f for c in chunks for f in range(c.keep_start, c.keep_end)]
            assert written == list(range(n)), f"n={n} radius={radius}: {written[:20]}"


def test_chunks_are_contiguous_and_progress():
    for n in FRAME_COUNTS:
        for radius in range(0, HALF + 1):
            expected_next = 0
            for chunk in iter_chunks(n, SEQ_LEN, radius):
                assert chunk.keep_start == expected_next
                assert chunk.keep_end > chunk.keep_start, "must make progress"
                expected_next = chunk.keep_end
            assert expected_next == n


def test_kept_range_lies_inside_window():
    for n in FRAME_COUNTS:
        for radius in range(0, HALF + 1):
            for chunk in iter_chunks(n, SEQ_LEN, radius):
                assert chunk.window_start <= chunk.keep_start
                assert chunk.keep_end <= chunk.window_end
                assert 0 <= chunk.keep_lo < chunk.keep_hi <= SEQ_LEN


def test_full_windows_when_video_is_long_enough():
    for n in [n for n in FRAME_COUNTS if n >= SEQ_LEN]:
        for radius in range(0, HALF + 1):
            for chunk in iter_chunks(n, SEQ_LEN, radius):
                assert chunk.window_end - chunk.window_start == SEQ_LEN
                assert 0 <= chunk.window_start
                assert chunk.window_end <= n, "must not read past the last frame"


def test_empty_and_short_videos():
    assert list(iter_chunks(0, SEQ_LEN, 1)) == []
    assert list(iter_chunks(-3, SEQ_LEN, 1)) == []
    for n in (1, 2, 14):
        chunks = list(iter_chunks(n, SEQ_LEN, 1))
        assert len(chunks) == 1, "short clips get one padded window"
        assert chunks[0] == (0, n, 0, n)


# --- Parity with the original per-frame implementation ---


def test_radius_zero_exactly_reproduces_original_windows():
    """T=0 must be bit-identical to the pre-refactor behaviour for every frame."""
    for n in [n for n in FRAME_COUNTS if n >= SEQ_LEN]:
        placement = kept_frames(n, context_radius=0)
        for frame in range(n):
            assert placement[frame] == reference_window(frame, n), (
                f"n={n} frame={frame}: {placement[frame]} != {reference_window(frame, n)}"
            )


def test_boundary_frames_match_original_at_default_radius():
    """The true first/last frames keep the original window even at T=1."""
    for n in [n for n in FRAME_COUNTS if n >= SEQ_LEN]:
        placement = kept_frames(n, context_radius=1)
        assert placement[0] == reference_window(0, n) == (0, 0)
        assert placement[n - 1] == reference_window(n - 1, n) == (n - SEQ_LEN, SEQ_LEN - 1)


def test_steady_state_uses_centre_offsets():
    """Away from the edges, T=1 keeps window offsets {6, 7, 8}."""
    placement = kept_frames(100, context_radius=1)
    middle = [placement[f][1] for f in range(20, 80)]
    assert set(middle) == {HALF - 1, HALF, HALF + 1} == {6, 7, 8}


def test_minimum_context_guarantee():
    """Every kept frame keeps at least ``half - radius`` frames of context."""
    for radius in range(0, HALF + 1):
        for n in (100, 1801):
            for frame, (_, offset) in kept_frames(n, radius).items():
                if frame < HALF or frame >= n - HALF:
                    continue  # true video boundaries are inherently one-sided
                assert min(offset, SEQ_LEN - 1 - offset) >= HALF - radius


# --- The streaming drive must match the known-length schedule ---


def simulate_streaming(n: int, context_radius: int, seq_len: int = SEQ_LEN):
    """Replay exactly what ``VSRInferenceEngine._stream`` does.

    The engine does not know the frame count until EOF, so it drives
    ``next_chunk`` with ``total=None`` and only supplies the real count for the
    final chunk. This reproduces that control flow with a simulated reader so the
    streaming schedule can be compared against ``iter_chunks``.
    """
    emitted = []
    frames_read = 0
    next_out = 0

    while True:
        chunk = next_chunk(next_out, seq_len, context_radius, total=None)
        # fill_to(chunk.window_end), stopping early at EOF
        frames_read = min(chunk.window_end, n)
        if frames_read < chunk.window_end:  # hit EOF
            break
        emitted.append(chunk)
        next_out = chunk.keep_end

    tail = next_chunk(next_out, seq_len, context_radius, total=frames_read)
    if tail is not None:
        emitted.append(tail)
    return emitted


def placement_of(chunks) -> dict[int, tuple[int, int]]:
    """Map each frame to the ``(window_start, offset)`` that produces it."""
    placement = {}
    for chunk in chunks:
        for frame in range(chunk.keep_start, chunk.keep_end):
            placement[frame] = (chunk.window_start, frame - chunk.window_start)
    return placement


def test_streaming_produces_identical_frame_placement():
    """Streaming must place every frame in the same window as the offline schedule.

    Placement is what determines pixel output, so this is the invariant that
    matters. The chunk *boundaries* may differ slightly (see the test below).
    """
    for n in FRAME_COUNTS:
        for radius in range(0, HALF + 1):
            streamed = placement_of(simulate_streaming(n, radius))
            offline = placement_of(iter_chunks(n, SEQ_LEN, radius))
            assert streamed == offline, f"placement diverged at n={n} radius={radius}"


def test_streaming_costs_at_most_one_extra_forward_pass():
    """Not knowing the frame count in advance is allowed to cost a little.

    The loop commits to a chunk before it can tell EOF is near, so the final
    window may be run twice over a partially overlapping range. Output is
    unaffected (see the placement test); the price is bounded at one pass.
    """
    for n in FRAME_COUNTS:
        for radius in range(0, HALF + 1):
            overhead = len(simulate_streaming(n, radius)) - len(
                list(iter_chunks(n, SEQ_LEN, radius))
            )
            assert 0 <= overhead <= 1, f"n={n} radius={radius} cost {overhead} passes"


def test_streaming_writes_every_frame_once_in_order():
    for n in FRAME_COUNTS:
        for radius in range(0, HALF + 1):
            written = [
                f
                for c in simulate_streaming(n, radius)
                for f in range(c.keep_start, c.keep_end)
            ]
            assert written == list(range(n)), f"n={n} radius={radius}"


def test_streaming_never_reads_past_eof():
    """Every window the streaming loop commits to must be fully readable."""
    for n in FRAME_COUNTS:
        for radius in range(0, HALF + 1):
            for chunk in simulate_streaming(n, radius):
                assert chunk.window_end <= max(n, chunk.window_end - chunk.window_start)
                assert chunk.window_start >= 0
                if n >= SEQ_LEN:
                    assert chunk.window_end <= n


def test_streaming_tail_window_is_the_final_buffer_contents():
    """The last chunk must read exactly the deque's residual contents.

    The engine keeps a ``deque(maxlen=seq_len)``, so at EOF it holds frames
    ``[max(0, n - seq_len), n)``. The tail chunk has to line up with that
    window or it would index the wrong frames.
    """
    for n in FRAME_COUNTS:
        for radius in range(0, HALF + 1):
            tail = simulate_streaming(n, radius)[-1]
            assert tail.window_start == max(0, n - SEQ_LEN)
            assert tail.keep_end == n
            assert tail.keep_hi <= min(n, SEQ_LEN), "kept range must fit the buffer"


# --- Forward-pass savings ---


def test_larger_radius_means_fewer_forward_passes():
    n = 1801
    counts = [len(list(iter_chunks(n, SEQ_LEN, r))) for r in range(0, HALF + 1)]
    # T=0 is one pass per frame, except the head and tail windows which each
    # emit `half + 1` frames from a single pass.
    assert counts[0] == n - (SEQ_LEN - 1)
    assert counts == sorted(counts, reverse=True), "more context kept => fewer passes"
    assert counts[1] < counts[0] / 2.5, "default T=1 should be roughly 3x cheaper"
    assert counts[HALF] <= n // SEQ_LEN + 2, "T=half approaches one pass per window"


def test_rejects_invalid_parameters():
    for bad_radius in (-1, HALF + 1, 99):
        try:
            list(iter_chunks(100, SEQ_LEN, bad_radius))
        except ValueError:
            pass
        else:
            raise AssertionError(f"context_radius={bad_radius} should raise")
    try:
        list(iter_chunks(100, 14, 1))
    except ValueError:
        pass
    else:
        raise AssertionError("even seq_len should raise")


# --- Even dimensions ---


def test_even_dim_rounds_down_and_floors_at_two():
    assert even_dim(853) == 852
    assert even_dim(852) == 852
    assert even_dim(1) == 2
    assert even_dim(0) == 2
    assert even_dim(3) == 2


def test_target_size_fixes_the_odd_width_bug():
    """1920x1080 used to become 853x480 and broke the yuv420p comparison encode."""
    width, height = target_size(1920, 1080, 480, HighResPolicy.DOWNSCALE)
    assert (width, height) == (852, 480)
    assert width % 2 == 0 and height % 2 == 0


def test_target_size_all_outputs_are_even():
    sizes = [(1920, 1080), (1280, 720), (640, 361), (853, 481), (321, 241), (1000, 1000)]
    for policy in (HighResPolicy.DOWNSCALE, HighResPolicy.NATIVE):
        for orig_w, orig_h in sizes:
            width, height = target_size(orig_w, orig_h, 480, policy)
            assert width % 2 == 0 and height % 2 == 0, (orig_w, orig_h, policy)


def test_target_size_leaves_small_input_alone_apart_from_evenness():
    for policy in HighResPolicy:
        assert target_size(640, 480, 480, policy) == (640, 480)
        assert target_size(320, 240, 480, policy) == (320, 240)
    # Odd dimensions are still corrected below the threshold — that is the bug fix.
    assert target_size(321, 241, 480, HighResPolicy.REJECT) == (320, 240)


def test_target_size_reject_policy_raises():
    try:
        target_size(1920, 1080, 480, HighResPolicy.REJECT)
    except ResolutionTooHighError as exc:
        assert "1920x1080" in str(exc)
        assert "480" in str(exc)
        assert "HIGH_RES_POLICY=downscale" in str(exc), "error should name the escape hatch"
    else:
        raise AssertionError("REJECT should raise for oversized input")


def test_target_size_native_keeps_resolution():
    assert target_size(1920, 1080, 480, HighResPolicy.NATIVE) == (1920, 1080)


def test_target_size_preserves_aspect_ratio_when_downscaling():
    width, height = target_size(1280, 720, 480, HighResPolicy.DOWNSCALE)
    assert (width, height) == (852, 480)
    assert abs((width / height) - (1280 / 720)) < 0.01


def test_target_size_rejects_degenerate_dimensions():
    for bad in ((0, 480), (640, 0), (-1, 480)):
        try:
            target_size(bad[0], bad[1], 480, HighResPolicy.DOWNSCALE)
        except ValueError:
            pass
        else:
            raise AssertionError(f"{bad} should raise")


def test_high_res_policy_values_match_env_strings():
    assert HighResPolicy("reject") is HighResPolicy.REJECT
    assert HighResPolicy("downscale") is HighResPolicy.DOWNSCALE
    assert HighResPolicy("native") is HighResPolicy.NATIVE


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for test in tests:
        test()
        print(f"ok: {test.__name__}")
    print(f"All {len(tests)} windowing tests passed")
