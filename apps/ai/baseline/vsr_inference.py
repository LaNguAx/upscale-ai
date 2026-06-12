"""
VSR Backend Inference Module
-----------------------------
Self-contained inference function for the Upscale backend.

Usage:
    from vsr_inference import VSRInferenceEngine

    engine = VSRInferenceEngine(
        checkpoint_path="vsr_model_best_loss.pth",
        device="cuda"
    )

    # Process a video file
    engine.process_video(
        input_path="user_uploaded.mp4",
        output_path="enhanced_output.mp4",
        max_height=480,  # resize if taller (avoid OOM)
        progress_callback=lambda done, total: print(f"{done}/{total}")
    )

    # Or process frames one at a time for streaming
    for sr_frame in engine.stream_video("user_uploaded.mp4"):
        # sr_frame is a numpy array (H, W, 3) in BGR, ready to encode/send
        send_to_frontend(sr_frame)

Model requirements (all from the architecture file):
    - SPyNet + BasicVSR (num_prop_blocks=20, seq_len=15, scale=4)
    - PyTorch >= 2.0
    - GPU with >= 8GB VRAM recommended for 720p output

The checkpoint file must have been trained with matching architecture params.
"""

import cv2
import torch
import numpy as np
import subprocess
import tempfile
from pathlib import Path
from typing import Optional, Callable, Iterator

# Import the model architecture (place model_architecture.py next to this file)
from .model_architecture import BasicVSRRecurrentSeq


class InferenceCancelledError(RuntimeError):
    """Raised when inference is cancelled mid-run."""


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
        print(f"[VSR] Loaded checkpoint: {checkpoint_path} on {self.device}")

    def _frame_to_tensor(self, frame_bgr: np.ndarray) -> torch.Tensor:
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        return torch.from_numpy(frame_rgb.transpose(2, 0, 1)).float() / 255.0

    def _tensor_to_frame(self, sr_tensor: torch.Tensor) -> np.ndarray:
        sr_rgb = (sr_tensor.numpy().transpose(1, 2, 0).clip(0, 1) * 255).astype(np.uint8)
        return cv2.cvtColor(sr_rgb, cv2.COLOR_RGB2BGR)

    def _transcode_for_opencv(self, input_path: str) -> str:
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

    def _read_and_resize(self, input_path: str, max_height: int = 480):
        source_path = input_path
        generated_fallback = None

        cap = cv2.VideoCapture(source_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps == 0 or fps is None:
            fps = 30.0  # fallback for broken metadata

        ret, first = cap.read()
        if not ret:
            cap.release()
            generated_fallback = self._transcode_for_opencv(input_path)
            source_path = generated_fallback
            cap = cv2.VideoCapture(source_path)
            fps = cap.get(cv2.CAP_PROP_FPS) or fps
            ret, first = cap.read()
            if not ret:
                cap.release()
                if generated_fallback and Path(generated_fallback).exists():
                    Path(generated_fallback).unlink(missing_ok=True)
                raise RuntimeError(f"Cannot read video: {input_path}")
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

        orig_h, orig_w = first.shape[:2]
        if orig_h > max_height:
            scale_factor = max_height / orig_h
            lr_w = int(orig_w * scale_factor)
            lr_h = max_height
            need_resize = True
        else:
            lr_w, lr_h = orig_w, orig_h
            need_resize = False

        frames = []
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if need_resize:
                frame = cv2.resize(frame, (lr_w, lr_h), interpolation=cv2.INTER_AREA)
            frames.append(frame)
        cap.release()
        if generated_fallback and Path(generated_fallback).exists():
            Path(generated_fallback).unlink(missing_ok=True)
        return frames, fps, (lr_w, lr_h)

    @torch.no_grad()
    def _process_window(self, lr_tensors: list, center: int) -> torch.Tensor:
        """Process one center frame using 15-frame sliding window."""
        start = max(0, center - self.half)
        end = min(len(lr_tensors), start + self.seq_len)
        start = max(0, end - self.seq_len)

        window = torch.stack(lr_tensors[start:end], dim=0).unsqueeze(0).to(self.device)

        if window.shape[1] < self.seq_len:
            pad_count = self.seq_len - window.shape[1]
            padding = window[:, -1:].repeat(1, pad_count, 1, 1, 1)
            window = torch.cat([window, padding], dim=1)

        pred = self.model(window)
        idx_in_window = center - start
        out = pred[0, idx_in_window].cpu()
        del pred, window
        return out

    def process_video(
        self,
        input_path: str,
        output_path: str,
        max_height: int = 480,
        progress_callback: Optional[Callable[[int, int], None]] = None,
        should_cancel: Optional[Callable[[], bool]] = None,
    ) -> dict:
        """
        Process a full video and save enhanced output.

        Returns: {"frames": N, "fps": float, "input_res": (w, h), "output_res": (w, h)}
        """
        frames_bgr, fps, (lr_w, lr_h) = self._read_and_resize(input_path, max_height)
        n = len(frames_bgr)
        print(f"[VSR] Processing {n} frames at {lr_w}x{lr_h} -> {lr_w*4}x{lr_h*4}")

        lr_tensors = [self._frame_to_tensor(f) for f in frames_bgr]
        del frames_bgr

        if n == 0:
            raise RuntimeError(f"No decodable frames found in {input_path}")

        sr_w, sr_h = lr_w * self.scale, lr_h * self.scale
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(output_path, fourcc, fps, (sr_w, sr_h))

        try:
            for i in range(n):
                if should_cancel and should_cancel():
                    raise InferenceCancelledError("Upscaling cancelled by user")

                sr_tensor = self._process_window(lr_tensors, i)
                sr_bgr = self._tensor_to_frame(sr_tensor)
                writer.write(sr_bgr)

                if progress_callback:
                    progress_callback(i + 1, n)
        finally:
            writer.release()

        print(f"[VSR] Saved: {output_path}")

        return {
            "frames": n,
            "fps": fps,
            "input_res": (lr_w, lr_h),
            "output_res": (sr_w, sr_h),
        }

    def stream_video(
        self,
        input_path: str,
        max_height: int = 480,
    ) -> Iterator[np.ndarray]:
        """
        Generator that yields each enhanced frame (BGR numpy array) as it's ready.
        Use this for streaming to frontend via WebSocket/SSE.
        """
        frames_bgr, fps, (lr_w, lr_h) = self._read_and_resize(input_path, max_height)
        lr_tensors = [self._frame_to_tensor(f) for f in frames_bgr]

        for i in range(len(lr_tensors)):
            sr_tensor = self._process_window(lr_tensors, i)
            yield self._tensor_to_frame(sr_tensor)


# Example backend integration (FastAPI-style pseudocode):
#
# from fastapi import FastAPI, UploadFile
# from fastapi.responses import FileResponse
#
# app = FastAPI()
# engine = VSRInferenceEngine("vsr_model_best_loss.pth", device="cuda")
#
# @app.post("/upload")
# async def upload(file: UploadFile):
#     job_id = create_job()
#     input_path = f"uploads/{job_id}.mp4"
#     output_path = f"outputs/{job_id}.mp4"
#
#     with open(input_path, "wb") as f:
#         f.write(await file.read())
#
#     # Run in background task
#     engine.process_video(
#         input_path, output_path,
#         max_height=480,
#         progress_callback=lambda done, total: update_job_progress(job_id, done, total)
#     )
#
#     return {"jobId": job_id}
