"""Combined loss function for video super-resolution training.

Aggregates reconstruction and perceptual losses with configurable weights.
Returns a dictionary of individual loss components for logging.
"""

import torch
import torch.nn as nn
from torch import Tensor

from src.ml.config import MLConfig
from src.ml.losses.reconstruction import CharbonnierLoss
from src.ml.losses.perceptual import VGGPerceptualLoss


class CombinedLoss(nn.Module):
    """Weighted combination of reconstruction and perceptual losses.

    total = l1_weight * charbonnier_loss + perceptual_weight * vgg_loss

    The perceptual loss component is only instantiated if its weight > 0,
    avoiding unnecessary VGG model loading.

    Args:
        config: MLConfig with loss weights and epsilon.
    """

    def __init__(self, config: MLConfig) -> None:
        super().__init__()
        self.l1_weight = config.l1_weight
        self.perceptual_weight = config.perceptual_weight

        self.reconstruction_loss = CharbonnierLoss(epsilon=config.charbonnier_epsilon)

        self.perceptual_loss: VGGPerceptualLoss | None = None
        if config.perceptual_weight > 0:
            self.perceptual_loss = VGGPerceptualLoss()

    def forward(self, pred: Tensor, target: Tensor) -> dict[str, Tensor]:
        """Compute combined loss.

        Args:
            pred: Predicted HR image, shape (B, 3, H, W), range [0, 1].
            target: Ground-truth HR image, same shape and range.

        Returns:
            Dictionary with keys: "l1", "perceptual" (if enabled), "total".
        """
        losses: dict[str, Tensor] = {}
        total = torch.tensor(0.0, device=pred.device)

        # Reconstruction loss (Charbonnier)
        l1 = self.reconstruction_loss(pred, target)
        losses["l1"] = l1
        total = total + self.l1_weight * l1

        # Perceptual loss (VGG features)
        if self.perceptual_loss is not None:
            perc = self.perceptual_loss(pred, target)
            losses["perceptual"] = perc
            total = total + self.perceptual_weight * perc

        losses["total"] = total
        return losses
