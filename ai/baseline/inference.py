"""Video super-resolution inference with sliding window."""

import os
import cv2
import numpy as np
import torch
import torch.nn as nn
from collections import deque
from typing import Callable


def make_demo_lr_frame(frame_bgr: np.ndarray, scale: int = 4) -> np.ndarray:
    """Downscale a frame to simulate low-quality input."""
    h, w = frame_bgr.shape[:2]
    small = cv2.resize(
        frame_bgr,
        (w // scale, h // scale),
        interpolation=cv2.INTER_CUBIC,
    )
    return small


def run_video_vsr(
    input_path: str,
    output_path: str,
    model: nn.Module,
    device: torch.device,
    seq_len: int = 5,
    scale: int = 4,
    simulate_lq: bool = True,
    max_frames: int | None = None,
    progress_callback: Callable[[int, int], None] | None = None,
) -> dict:
    """
    Run video super-resolution inference using a sliding temporal window.

    Args:
        input_path: Path to the input video file.
        output_path: Path where the enhanced video will be written.
        model: Trained VSR model.
        device: Torch device (cpu or cuda).
        seq_len: Number of frames in the temporal window.
        scale: Upscaling factor.
        simulate_lq: If True, downscale input frames before inference (for demo).
        max_frames: Limit the number of processed frames (None = all).
        progress_callback: Called with (current_frame, total_frames) after each frame.

    Returns:
        Metadata dict with total_frames and output_path.
    """
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise FileNotFoundError(f"Could not open video: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 25

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if simulate_lq:
        out_width, out_height = width, height
    else:
        out_width, out_height = width * scale, height * scale

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(output_path, fourcc, fps, (out_width, out_height))

    if not out.isOpened():
        cap.release()
        raise RuntimeError(f"VideoWriter failed to open: {output_path}")

    def frame_to_tensor(frame_bgr: np.ndarray) -> torch.Tensor:
        if simulate_lq:
            frame_bgr = make_demo_lr_frame(frame_bgr, scale=scale)
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        tensor = torch.from_numpy(frame_rgb.transpose(2, 0, 1)).float() / 255.0
        return tensor

    ret, first_frame = cap.read()
    if not ret:
        cap.release()
        out.release()
        raise RuntimeError("No frames were read from the input video.")

    first_tensor = frame_to_tensor(first_frame)
    window = deque([first_tensor.clone() for _ in range(seq_len)], maxlen=seq_len)

    processed_count = 0
    frame_count_limit = total_frames if max_frames is None else min(max_frames, total_frames)

    model.eval()
    with torch.no_grad():
        while True:
            input_tensor = torch.stack(list(window), dim=0).unsqueeze(0).to(device)
            output_tensor = model(input_tensor)

            output_img = output_tensor.squeeze(0).cpu().numpy().transpose(1, 2, 0)
            output_img = (np.clip(output_img, 0, 1) * 255).astype(np.uint8)
            output_bgr = cv2.cvtColor(output_img, cv2.COLOR_RGB2BGR)

            if output_bgr.shape[1] != out_width or output_bgr.shape[0] != out_height:
                output_bgr = cv2.resize(output_bgr, (out_width, out_height), interpolation=cv2.INTER_CUBIC)

            out.write(output_bgr)

            processed_count += 1
            if progress_callback:
                progress_callback(processed_count, frame_count_limit)

            if max_frames is not None and processed_count >= max_frames:
                break

            ret, next_frame = cap.read()
            if not ret:
                break

            next_tensor = frame_to_tensor(next_frame)
            window.append(next_tensor)

    cap.release()
    out.release()

    if not os.path.exists(output_path):
        raise RuntimeError("Output video was not created.")

    file_size = os.path.getsize(output_path)
    if file_size == 0:
        raise RuntimeError("Output video file is empty.")

    return {
        "total_frames": processed_count,
        "output_path": output_path,
        "file_size": file_size,
    }
