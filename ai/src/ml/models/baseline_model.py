"""TemporalSRNet — Early-fusion multi-frame super-resolution network.

Baseline model for the Upscale video restoration project. Takes N consecutive
low-resolution frames concatenated along the channel dimension and outputs a
single high-resolution enhanced frame (the central frame of the window).

Architecture follows EDSR design principles:
- No batch normalization
- Global residual learning
- PixelShuffle (sub-pixel convolution) for learned upsampling
- ICNR initialization for PixelShuffle to avoid checkerboard artifacts
"""

import math

import torch
import torch.nn as nn
from torch import Tensor

from src.ml.config import MLConfig
from src.ml.models.residual_block import ResidualBlock


class TemporalSRNet(nn.Module):
    """Early-fusion temporal super-resolution network.

    Args:
        config: MLConfig with model hyperparameters.

    Input shape:  (B, num_input_frames * 3, H, W)
    Output shape: (B, 3, H * upscale_factor, W * upscale_factor)
    """

    def __init__(self, config: MLConfig) -> None:
        super().__init__()

        in_channels = config.num_input_frames * config.num_channels
        nf = config.num_features
        scale = config.upscale_factor

        if scale not in (2, 4):
            raise ValueError(f"Upscale factor must be 2 or 4, got {scale}")

        # ── Head: fuse temporal frames into shared feature space ──
        self.head = nn.Sequential(
            nn.Conv2d(in_channels, nf, kernel_size=3, padding=1),
            nn.LeakyReLU(negative_slope=0.2, inplace=True),
        )

        # ── Body: residual feature extraction ──
        body_layers: list[nn.Module] = [
            ResidualBlock(nf) for _ in range(config.num_residual_blocks)
        ]
        body_layers.append(nn.Conv2d(nf, nf, kernel_size=3, padding=1))
        self.body = nn.Sequential(*body_layers)

        # ── Upsampler: PixelShuffle blocks (one per 2x step) ──
        num_upsample_steps = int(math.log2(scale))
        upsample_layers: list[nn.Module] = []
        for _ in range(num_upsample_steps):
            upsample_layers.extend([
                nn.Conv2d(nf, nf * 4, kernel_size=3, padding=1),
                nn.PixelShuffle(upscale_factor=2),
                nn.LeakyReLU(negative_slope=0.2, inplace=True),
            ])
        self.upsampler = nn.Sequential(*upsample_layers)

        # ── Tail: reconstruct RGB output ──
        self.tail = nn.Conv2d(nf, config.num_channels, kernel_size=3, padding=1)

        # Initialize weights
        self._initialize_weights()

    def forward(self, x: Tensor) -> Tensor:
        """Forward pass.

        Args:
            x: Low-resolution input tensor of shape (B, N*3, H, W)
               where N = num_input_frames.

        Returns:
            High-resolution output tensor of shape (B, 3, H*scale, W*scale).
        """
        head_out = self.head(x)
        body_out = self.body(head_out)
        features = head_out + body_out  # Global residual connection
        upscaled = self.upsampler(features)
        return self.tail(upscaled)

    def _initialize_weights(self) -> None:
        """Initialize network weights using best practices for SR.

        - Kaiming uniform for standard Conv2d layers
        - ICNR initialization for PixelShuffle Conv2d layers
        """
        for m in self.modules():
            if isinstance(m, nn.Conv2d):
                nn.init.kaiming_uniform_(m.weight, a=0.2, nonlinearity="leaky_relu")
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

        # Apply ICNR initialization to PixelShuffle conv layers
        for i, layer in enumerate(self.upsampler):
            if isinstance(layer, nn.Conv2d):
                _icnr_init(layer.weight, upscale_factor=2)


def _icnr_init(weight: Tensor, upscale_factor: int = 2) -> None:
    """ICNR (Initialized to Convolution NN Resize) initialization.

    Initializes Conv2d weight before PixelShuffle so that each sub-pixel
    filter starts with the same kernel, avoiding checkerboard artifacts.

    Reference: Aitken et al., "Checkerboard artifact free sub-pixel
    convolution", arXiv 2017.
    """
    out_channels, in_channels, kh, kw = weight.shape
    sub_channels = out_channels // (upscale_factor ** 2)

    # Initialize a smaller kernel
    sub_kernel = torch.empty(sub_channels, in_channels, kh, kw)
    nn.init.kaiming_uniform_(sub_kernel, a=0.2, nonlinearity="leaky_relu")

    # Repeat for each sub-pixel position
    weight.data.copy_(sub_kernel.repeat(upscale_factor ** 2, 1, 1, 1))
