"""Frame processor for video restoration — model-based or stub fallback.

When a trained model checkpoint is available (via MODEL_CHECKPOINT env var
or settings.model_checkpoint), uses the TemporalSRNet for inference.
Otherwise, falls back to bicubic upscaling as a placeholder.
"""

import logging
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from src.config import settings

logger = logging.getLogger(__name__)

# Lazy-loaded model predictor (initialized on first use)
_predictor: Optional[object] = None
_predictor_initialized = False


def _get_predictor() -> Optional[object]:
    """Lazily load the model predictor if a checkpoint is available."""
    global _predictor, _predictor_initialized

    if _predictor_initialized:
        return _predictor

    _predictor_initialized = True
    checkpoint_path = settings.model_checkpoint

    if not checkpoint_path or not Path(checkpoint_path).exists():
        logger.info("No model checkpoint found — using bicubic stub")
        return None

    try:
        from src.ml.inference.predictor import ModelPredictor
        _predictor = ModelPredictor(checkpoint_path)
        logger.info(f"Model loaded from {checkpoint_path}")
    except Exception as e:
        logger.error(f"Failed to load model checkpoint: {e}. Falling back to stub.")
        _predictor = None

    return _predictor


def process_temporal_window(
    frames: list[np.ndarray],
    upscale_factor: int = 2,
) -> np.ndarray:
    """Process a temporal window of frames and return the enhanced central frame.

    Uses the trained TemporalSRNet if a checkpoint is available, otherwise
    falls back to bicubic upscaling.

    Args:
        frames: List of consecutive video frames (BGR, uint8).
            Typically 3-7 frames forming a temporal window.
        upscale_factor: Factor by which to increase spatial resolution.

    Returns:
        Enhanced central frame as numpy array (BGR, uint8).
    """
    predictor = _get_predictor()

    if predictor is not None:
        # Use the trained deep learning model
        return predictor.predict(frames, upscale_factor)

    # Fallback: bicubic upscaling stub
    central_idx = len(frames) // 2
    central_frame = frames[central_idx]

    h, w = central_frame.shape[:2]
    new_h, new_w = h * upscale_factor, w * upscale_factor

    enhanced = cv2.resize(
        central_frame,
        (new_w, new_h),
        interpolation=cv2.INTER_CUBIC,
    )

    # Simulate processing time in stub mode
    time.sleep(0.03)

    return enhanced


def process_all_frames(
    frame_paths: list[str],
    output_dir: str,
    upscale_factor: int = 2,
    window_size: int = 5,
    on_progress: object = None,
) -> list[str]:
    """Process all frames using a sliding temporal window.

    Args:
        frame_paths: Ordered list of input frame file paths.
        output_dir: Directory to save enhanced frames.
        upscale_factor: Super-resolution scale factor.
        window_size: Number of frames in each temporal window.
        on_progress: Optional callback(processed_count, total_count).

    Returns:
        Ordered list of enhanced frame file paths.
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    total = len(frame_paths)
    half_window = window_size // 2
    enhanced_paths: list[str] = []

    logger.info(f"Processing {total} frames with window_size={window_size}, upscale={upscale_factor}x")

    for i in range(total):
        # Build the temporal window with boundary handling (replicate edges)
        window_indices = []
        for offset in range(-half_window, half_window + 1):
            idx = max(0, min(total - 1, i + offset))
            window_indices.append(idx)

        # Load frames for the window
        window_frames = []
        for idx in window_indices:
            frame = cv2.imread(frame_paths[idx])
            if frame is None:
                raise ValueError(f"Cannot read frame: {frame_paths[idx]}")
            window_frames.append(frame)

        # Process the temporal window
        enhanced = process_temporal_window(window_frames, upscale_factor)

        # Save the enhanced frame
        out_filename = f"enhanced_{i:06d}.png"
        out_path = str(output_path / out_filename)
        cv2.imwrite(out_path, enhanced)
        enhanced_paths.append(out_path)

        # Report progress
        if on_progress is not None:
            on_progress(i + 1, total)

    logger.info(f"Processed {total} frames to {output_dir}")
    return enhanced_paths
