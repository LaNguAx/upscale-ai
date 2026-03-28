"""Model inference wrapper for the video processing pipeline.

Loads a trained TemporalSRNet checkpoint and provides a clean interface
for the frame processor service. Handles tensor conversion, device
management, and window size adjustment.
"""

import logging
from pathlib import Path

import numpy as np
import torch

from src.ml.config import MLConfig
from src.ml.models.baseline_model import TemporalSRNet
from src.ml.data.transforms import to_tensor, to_numpy

logger = logging.getLogger(__name__)


class ModelPredictor:
    """Stateful inference wrapper that loads a trained model checkpoint.

    Args:
        checkpoint_path: Path to a .pth checkpoint file.
        device: Device to run inference on ("auto", "cuda", or "cpu").
    """

    def __init__(self, checkpoint_path: str, device: str = "auto") -> None:
        if not Path(checkpoint_path).exists():
            raise FileNotFoundError(f"Checkpoint not found: {checkpoint_path}")

        self.device = torch.device(
            "cuda" if device == "auto" and torch.cuda.is_available() else "cpu"
        )

        # Load checkpoint and reconstruct config
        checkpoint = torch.load(
            checkpoint_path, map_location=self.device, weights_only=False
        )
        self.config = MLConfig.from_dict(checkpoint["config"])

        # Build and load model
        self.model = TemporalSRNet(self.config).to(self.device)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.eval()

        param_count = sum(p.numel() for p in self.model.parameters())
        logger.info(
            f"Model loaded: {param_count:,} params, "
            f"scale={self.config.upscale_factor}x, "
            f"window={self.config.num_input_frames}, "
            f"device={self.device}"
        )

    @torch.no_grad()
    def predict(self, frames: list[np.ndarray], upscale_factor: int = 2) -> np.ndarray:
        """Enhance the central frame of a temporal window.

        Args:
            frames: List of BGR uint8 numpy arrays (temporal window).
            upscale_factor: Must match the model's trained scale factor.

        Returns:
            Enhanced central frame as BGR uint8 numpy array.

        Raises:
            ValueError: If upscale_factor doesn't match the trained model.
        """
        if upscale_factor != self.config.upscale_factor:
            raise ValueError(
                f"Model was trained with {self.config.upscale_factor}x upscale, "
                f"but {upscale_factor}x was requested"
            )

        # Adjust window size to match model expectation
        adjusted_frames = self._adjust_window(frames)

        # Convert BGR uint8 → RGB float32 tensors
        tensors = [to_tensor(f) for f in adjusted_frames]

        # Concatenate along channel dim: (N*3, H, W) then add batch dim
        lr_input = torch.cat(tensors, dim=0).unsqueeze(0).to(self.device)

        # Run inference
        output = self.model(lr_input)  # (1, 3, H*s, W*s)
        output = output.clamp(0.0, 1.0)

        # Convert back to BGR uint8 numpy
        return to_numpy(output.squeeze(0).cpu())

    def _adjust_window(self, frames: list[np.ndarray]) -> list[np.ndarray]:
        """Pad or trim the frame list to match num_input_frames."""
        expected = self.config.num_input_frames
        result = list(frames)

        if len(result) == expected:
            return result

        if len(result) > expected:
            # Take center-aligned subset
            start = (len(result) - expected) // 2
            return result[start : start + expected]

        # Pad by replicating edge frames (same strategy as training)
        while len(result) < expected:
            if len(result) % 2 == 0:
                result.insert(0, result[0])
            else:
                result.append(result[-1])

        return result
