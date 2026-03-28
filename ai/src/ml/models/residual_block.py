"""EDSR-style residual block for super-resolution networks.

No batch normalization — BN removes range flexibility and hurts SR
performance (Lim et al., "Enhanced Deep Residual Networks for Single
Image Super-Resolution", CVPRW 2017).
"""

import torch.nn as nn
from torch import Tensor


class ResidualBlock(nn.Module):
    """Residual block with two 3x3 convolutions and a skip connection.

    Architecture:
        x → Conv2d → LeakyReLU → Conv2d → (+x) → out
    """

    def __init__(self, num_features: int = 64) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(num_features, num_features, kernel_size=3, padding=1)
        self.relu = nn.LeakyReLU(negative_slope=0.2, inplace=True)
        self.conv2 = nn.Conv2d(num_features, num_features, kernel_size=3, padding=1)

    def forward(self, x: Tensor) -> Tensor:
        residual = x
        out = self.relu(self.conv1(x))
        out = self.conv2(out)
        return out + residual
