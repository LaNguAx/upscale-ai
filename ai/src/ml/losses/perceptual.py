"""VGG-based perceptual loss for super-resolution training.

Computes L1 distance between deep feature representations extracted from
a pretrained VGG19 network. Encourages perceptual similarity beyond
pixel-level accuracy.

Reference: Johnson et al., "Perceptual Losses for Real-Time Style Transfer
and Super-Resolution", ECCV 2016.
"""

from typing import Optional

import torch
import torch.nn as nn
from torch import Tensor
from torchvision import models


# ImageNet normalization constants
_IMAGENET_MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
_IMAGENET_STD = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)

# VGG19 feature extraction layer indices
# relu1_2=2, relu2_2=7, relu3_4=16, relu4_4=25
_DEFAULT_FEATURE_LAYERS = [2, 7, 16, 25]


class VGGPerceptualLoss(nn.Module):
    """Perceptual loss using pretrained VGG19 features.

    Extracts features at multiple VGG19 layers and computes the L1
    distance between predicted and target feature maps.

    The VGG model is frozen (no gradient updates) and kept in eval mode.
    Input images should be in [0, 1] range, RGB format. ImageNet
    normalization is applied internally.

    Args:
        feature_layers: List of VGG19 layer indices to extract features from.
        layer_weights: Optional per-layer weights. Defaults to equal weights.
    """

    def __init__(
        self,
        feature_layers: Optional[list[int]] = None,
        layer_weights: Optional[list[float]] = None,
    ) -> None:
        super().__init__()

        self.feature_layers = feature_layers or _DEFAULT_FEATURE_LAYERS
        self.layer_weights = layer_weights or [1.0] * len(self.feature_layers)

        # Load pretrained VGG19 and extract only the layers we need
        vgg = models.vgg19(weights=models.VGG19_Weights.IMAGENET1K_V1).features
        max_layer = max(self.feature_layers) + 1
        self.vgg_slices = nn.ModuleList()

        prev_idx = 0
        for layer_idx in sorted(self.feature_layers):
            self.vgg_slices.append(nn.Sequential(*list(vgg.children())[prev_idx:layer_idx + 1]))
            prev_idx = layer_idx + 1

        # Freeze all parameters
        for param in self.parameters():
            param.requires_grad = False

        # Register normalization constants as buffers (move with .to(device))
        self.register_buffer("mean", _IMAGENET_MEAN)
        self.register_buffer("std", _IMAGENET_STD)

    def _normalize(self, x: Tensor) -> Tensor:
        """Apply ImageNet normalization."""
        return (x - self.mean) / self.std

    def forward(self, pred: Tensor, target: Tensor) -> Tensor:
        """Compute perceptual loss.

        Args:
            pred: Predicted image tensor, shape (B, 3, H, W), range [0, 1], RGB.
            target: Target image tensor, same shape and range.

        Returns:
            Scalar perceptual loss.
        """
        pred_norm = self._normalize(pred)
        target_norm = self._normalize(target)

        loss = torch.tensor(0.0, device=pred.device)

        pred_features = pred_norm
        target_features = target_norm

        for i, vgg_slice in enumerate(self.vgg_slices):
            pred_features = vgg_slice(pred_features)
            target_features = vgg_slice(target_features)

            layer_loss = nn.functional.l1_loss(pred_features, target_features)
            loss = loss + self.layer_weights[i] * layer_loss

        return loss
