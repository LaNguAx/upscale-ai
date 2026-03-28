import logging
from pathlib import Path

import cv2
import numpy as np

from src.models.job import FrameMetadata

logger = logging.getLogger(__name__)


def extract_frames(video_path: str, output_dir: str) -> tuple[list[str], FrameMetadata]:
    """Extract all frames from a video file and save as PNG images.

    Args:
        video_path: Path to the input video file.
        output_dir: Directory to save extracted frames.

    Returns:
        Tuple of (list of frame file paths, frame metadata).

    Raises:
        ValueError: If the video cannot be opened or has no frames.
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
    codec = "".join([chr((fourcc >> 8 * i) & 0xFF) for i in range(4)])

    if total_frames <= 0:
        cap.release()
        raise ValueError(f"Video has no frames: {video_path}")

    metadata = FrameMetadata(
        fps=fps if fps > 0 else 30.0,
        total_frames=total_frames,
        width=width,
        height=height,
        codec=codec,
    )

    frame_paths: list[str] = []
    frame_idx = 0

    logger.info(f"Extracting {total_frames} frames from {video_path}")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_filename = f"frame_{frame_idx:06d}.png"
        frame_path = str(output_path / frame_filename)
        cv2.imwrite(frame_path, frame)
        frame_paths.append(frame_path)
        frame_idx += 1

    cap.release()
    logger.info(f"Extracted {len(frame_paths)} frames to {output_dir}")

    return frame_paths, metadata
