"""Synthetic degradation pipeline for generating LQ training data.

Takes high-quality video frames and applies a sequence of randomized
degradations to simulate real-world video corruption:
  1. Gaussian blur (focus/motion blur)
  2. Spatial downscaling (low-resolution recording)
  3. Additive Gaussian noise (sensor noise)
  4. JPEG compression artifacts

Degradation order follows Real-ESRGAN conventions for realistic simulation.
"""

import cv2
import numpy as np

from src.ml.config import MLConfig


class SyntheticDegradationPipeline:
    """Applies randomized degradations to a single HQ frame.

    Each call randomizes all degradation parameters within the configured
    ranges, providing built-in data augmentation.

    Args:
        config: MLConfig with degradation parameter ranges.
        rng: Optional numpy random generator for reproducibility.
    """

    def __init__(self, config: MLConfig, rng: np.random.Generator | None = None) -> None:
        self.config = config
        self.rng = rng or np.random.default_rng()

    def __call__(
        self,
        hq_frame: np.ndarray,
        target_size: tuple[int, int],
    ) -> np.ndarray:
        """Degrade a high-quality frame to a low-quality version.

        Args:
            hq_frame: Clean BGR uint8 frame, shape (H, W, 3).
            target_size: Desired output (height, width) for the LR frame.

        Returns:
            Degraded BGR uint8 frame of shape (target_h, target_w, 3).
        """
        img = hq_frame.astype(np.float64)

        # 1. Gaussian blur
        img = self._apply_blur(img)

        # 2. Downscale to target LR resolution
        img = self._apply_downscale(img, target_size)

        # 3. Additive Gaussian noise
        img = self._apply_noise(img)

        # 4. JPEG compression artifacts
        img = np.clip(img, 0, 255).astype(np.uint8)
        img = self._apply_jpeg_compression(img)

        return img

    def _apply_blur(self, img: np.ndarray) -> np.ndarray:
        """Apply Gaussian blur with random kernel size and sigma."""
        kmin, kmax = self.config.blur_kernel_range
        smin, smax = self.config.blur_sigma_range

        # Kernel size must be odd
        kernel_size = int(self.rng.integers(kmin, kmax + 1))
        if kernel_size % 2 == 0:
            kernel_size += 1

        sigma = self.rng.uniform(smin, smax)
        return cv2.GaussianBlur(img, (kernel_size, kernel_size), sigma)

    def _apply_downscale(
        self, img: np.ndarray, target_size: tuple[int, int]
    ) -> np.ndarray:
        """Downscale to target LR resolution using area interpolation."""
        target_h, target_w = target_size
        return cv2.resize(img, (target_w, target_h), interpolation=cv2.INTER_AREA)

    def _apply_noise(self, img: np.ndarray) -> np.ndarray:
        """Add Gaussian noise with random sigma."""
        smin, smax = self.config.noise_sigma_range
        sigma = self.rng.uniform(smin, smax)

        if sigma <= 0:
            return img

        noise = self.rng.normal(0, sigma, img.shape)
        return np.clip(img + noise, 0, 255)

    def _apply_jpeg_compression(self, img: np.ndarray) -> np.ndarray:
        """Apply JPEG compression with random quality factor."""
        qmin, qmax = self.config.jpeg_quality_range
        quality = int(self.rng.integers(qmin, qmax + 1))

        encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), quality]
        _, encoded = cv2.imencode(".jpg", img, encode_param)
        return cv2.imdecode(encoded, cv2.IMREAD_COLOR)
