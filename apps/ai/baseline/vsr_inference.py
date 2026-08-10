"""
VSR Backend Inference Module
-----------------------------
Self-contained inference for the Upscale backend.

Usage:
    from vsr_inference import VSRInferenceEngine

    engine = VSRInferenceEngine(checkpoint_path="vsr_model_best.pth", device="cuda")
    engine.process_video(
        input_path="user_uploaded.mp4",
        output_path="enhanced_output.mp4",
        max_height=480,  # taller input is rejected
        progress_callback=lambda done, total: print(f"{done}/{total}"),
    )

Frames are streamed through a rolling 15-frame buffer, so RAM stays O(seq_len)
instead of O(video length). One forward pass produces one output frame, exactly
as the original implementation did.

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

logger = logging.getLogger(__name__)

DEFAULT_FPS = 30.0  # fallback for videos with broken metadata


class InferenceCancelledError(RuntimeError):
    """Raised when inference is cancelled mid-run."""


class ResolutionTooHighError(RuntimeError):
    """Input is taller than ``max_height``.

    Subclasses ``RuntimeError`` so the server's existing handler turns it into a
    ``failed`` NDJSON line without extra plumbing.
    """


def _even(value: int) -> int:
    """Round down to even. H.264 yuv420p cannot encode odd dimensions."""
    return max(2, value - (value % 2))


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

    Falls back to an ffmpeg transcode when OpenCV cannot decode the input; the
    temp file is removed on exit no matter how the block is left. The first
    frame is decoded eagerly to learn the dimensions, then replayed by the first
    ``read()`` (seeking back with CAP_PROP_POS_FRAMES is unreliable on some
    codecs).
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
        """Best-effort total, used only to pace progress reporting."""
        assert self._cap is not None
        reported = int(self._cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if reported > 0:
            return reported

        counter = cv2.VideoCapture(source_path)
        try:
            count = 0
            while counter.grab():  # grab() skips decoding, so this is cheap
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
    """Runs VSR inference on videos using a sliding 15-frame window."""

    def __init__(
        self,
        checkpoint_path: str,
        device: str = "cuda",
        seq_len: int = 15,
        scale: int = 4,
    ):
        self.device = torch.device(device if torch.cuda.is_available() else "cpu")
        self.seq_len = seq_len
        self.scale = scale
        self.half = seq_len // 2

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
    def _process_window(
        self, window: list[torch.Tensor], idx_in_window: int
    ) -> torch.Tensor:
        """Super-resolve one 15-frame window and return a single output frame."""
        batch = torch.stack(window, dim=0).unsqueeze(0).to(self.device)

        if batch.shape[1] < self.seq_len:
            # Clip shorter than seq_len: repeat the last frame to fill.
            pad_count = self.seq_len - batch.shape[1]
            padding = batch[:, -1:].repeat(1, pad_count, 1, 1, 1)
            batch = torch.cat([batch, padding], dim=1)

        pred = self.model(batch)
        out = pred[0, idx_in_window].cpu()
        del pred, batch
        return out

    def process_video(
        self,
        input_path: str,
        output_path: str,
        max_height: int = 480,
        progress_callback: Optional[Callable[[int, int], None]] = None,
        should_cancel: Optional[Callable[[], bool]] = None,
        preview_callback: Optional[Callable[[int, int, np.ndarray, np.ndarray], None]] = None,
    ) -> dict:
        """
        Process a full video and save enhanced output.

        Args:
            preview_callback, when provided, receives (frame_number, total_frames,
            enhanced_bgr_frame, input_bgr_frame) for every frame after it is
            written; sampling and any I/O are the caller's responsibility.

        Raises:
            ResolutionTooHighError: input is taller than ``max_height``.
            InferenceCancelledError: ``should_cancel`` returned True.

        Returns: {"frames": N, "fps": float, "input_res": (w, h), "output_res": (w, h)}
        """
        with _FrameSource(input_path) as source:
            if source.height > max_height:
                raise ResolutionTooHighError(
                    f"Input resolution {source.width}x{source.height} exceeds the "
                    f"maximum supported height of {max_height}px."
                )

            lr_w, lr_h = _even(source.width), _even(source.height)
            needs_resize = (lr_w, lr_h) != (source.width, source.height)
            sr_w, sr_h = lr_w * self.scale, lr_h * self.scale
            fps = source.fps

            logger.info(f"[VSR] Streaming {lr_w}x{lr_h} -> {sr_w}x{sr_h}")

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
        """Slide a 15-frame window over the video, writing one frame per pass.

        The deque always holds the most recent ``seq_len`` frames, so it *is* the
        window for the frame currently being decoded. That makes the opening and
        closing windows fall out for free: the first `half+1` frames and the last
        `half` frames are read off the first and last full buffer respectively,
        which is the same shift-window behaviour the original had at the edges.
        """
        buffer: deque[torch.Tensor] = deque(maxlen=self.seq_len)
        written = 0

        def read_next() -> bool:
            frame = source.read()
            if frame is None:
                return False
            if needs_resize:
                frame = cv2.resize(frame, size, interpolation=cv2.INTER_AREA)
            buffer.append(self._frame_to_tensor(frame))
            return True

        def emit(idx_in_window: int) -> None:
            nonlocal written
            if should_cancel and should_cancel():
                raise InferenceCancelledError("Upscaling cancelled by user")

            sr_bgr = self._tensor_to_frame(self._process_window(list(buffer), idx_in_window))
            writer.write(sr_bgr)
            written += 1

            total = max(source.frame_count_hint, written)
            if progress_callback:
                progress_callback(written, total)
            if preview_callback:
                preview_callback(
                    written, total, sr_bgr, self._tensor_to_frame(buffer[idx_in_window])
                )

        while len(buffer) < self.seq_len and read_next():
            pass

        if not buffer:
            return 0

        if len(buffer) < self.seq_len:
            # Whole clip is shorter than one window: every frame is decoded from
            # it, padded inside _process_window.
            for i in range(len(buffer)):
                emit(i)
            return written

        # Opening window: frames 0..half all come from the first full buffer.
        for i in range(self.half + 1):
            emit(i)

        # Steady state: one new frame in, one centred output out.
        while read_next():
            emit(self.half)

        # Closing window: the buffer already holds the final seq_len frames.
        for i in range(self.half + 1, self.seq_len):
            emit(i)

        return written
