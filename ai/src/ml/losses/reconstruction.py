"""Pixel-wise reconstruction losses for super-resolution training."""

import torch
import torch.nn as nn
from torch import Tensor


class L1ReconstructionLoss(nn.Module):
    """Standard L1 (mean absolute error) loss.

    Measures per-pixel absolute difference between prediction and target.
    Stable and robust; preserves sharp edges better than L2.
    """

    def __init__(self) -> None:
        super().__init__()
        self.loss = nn.L1Loss()

    def forward(self, pred: Tensor, target: Tensor) -> Tensor:
        return self.loss(pred, target)


class CharbonnierLoss(nn.Module):
    """Charbonnier loss — differentiable approximation of L1.

    L(x, y) = sqrt((x - y)^2 + epsilon^2)

    Smoother than L1 at zero, leading to more stable gradients early in
    training. Widely used in video SR papers (EDVR, BasicVSR, etc.).

    Args:
        epsilon: Smoothing constant. Default 1e-6.
    """

    def __init__(self, epsilon: float = 1e-6) -> None:
        super().__init__()
        self.epsilon_sq = epsilon ** 2

    def forward(self, pred: Tensor, target: Tensor) -> Tensor:
        diff = pred - target
        return torch.mean(torch.sqrt(diff * diff + self.epsilon_sq))
