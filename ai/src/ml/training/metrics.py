"""Image quality metrics for evaluating super-resolution results."""

import torch
import torch.nn.functional as F
from torch import Tensor


def compute_psnr(pred: Tensor, target: Tensor, max_val: float = 1.0) -> float:
    """Compute Peak Signal-to-Noise Ratio (PSNR) between two images.

    Higher is better. Typical values for good SR: 28-35 dB.

    Args:
        pred: Predicted image tensor, shape (C, H, W) or (B, C, H, W), range [0, max_val].
        target: Ground-truth image tensor, same shape.
        max_val: Maximum pixel value (1.0 for normalized tensors).

    Returns:
        PSNR value in dB.
    """
    mse = F.mse_loss(pred, target).item()
    if mse == 0:
        return float("inf")
    return 10.0 * torch.log10(torch.tensor(max_val ** 2 / mse)).item()


def compute_ssim(
    pred: Tensor,
    target: Tensor,
    window_size: int = 11,
    sigma: float = 1.5,
) -> float:
    """Compute Structural Similarity Index (SSIM) between two images.

    Higher is better. Range [0, 1]. Typical good SR: 0.85-0.95.

    Uses 11x11 Gaussian window with sigma=1.5, following the original
    Wang et al. 2004 paper.

    Args:
        pred: Predicted image, shape (C, H, W) or (B, C, H, W), range [0, 1].
        target: Ground-truth image, same shape.
        window_size: Size of the Gaussian window.
        sigma: Standard deviation of the Gaussian window.

    Returns:
        Mean SSIM value.
    """
    if pred.dim() == 3:
        pred = pred.unsqueeze(0)
        target = target.unsqueeze(0)

    channels = pred.size(1)
    window = _gaussian_window(window_size, sigma, channels, pred.device)

    C1 = 0.01 ** 2
    C2 = 0.03 ** 2

    mu_pred = F.conv2d(pred, window, padding=window_size // 2, groups=channels)
    mu_target = F.conv2d(target, window, padding=window_size // 2, groups=channels)

    mu_pred_sq = mu_pred ** 2
    mu_target_sq = mu_target ** 2
    mu_pred_target = mu_pred * mu_target

    sigma_pred_sq = F.conv2d(pred ** 2, window, padding=window_size // 2, groups=channels) - mu_pred_sq
    sigma_target_sq = F.conv2d(target ** 2, window, padding=window_size // 2, groups=channels) - mu_target_sq
    sigma_pred_target = F.conv2d(pred * target, window, padding=window_size // 2, groups=channels) - mu_pred_target

    numerator = (2 * mu_pred_target + C1) * (2 * sigma_pred_target + C2)
    denominator = (mu_pred_sq + mu_target_sq + C1) * (sigma_pred_sq + sigma_target_sq + C2)

    ssim_map = numerator / denominator
    return ssim_map.mean().item()


def _gaussian_window(size: int, sigma: float, channels: int, device: torch.device) -> Tensor:
    """Create a Gaussian window for SSIM computation."""
    coords = torch.arange(size, dtype=torch.float32, device=device) - size // 2
    g = torch.exp(-coords ** 2 / (2 * sigma ** 2))
    g = g / g.sum()

    window_2d = g.unsqueeze(1) @ g.unsqueeze(0)  # outer product
    window = window_2d.unsqueeze(0).unsqueeze(0).expand(channels, 1, size, size).contiguous()
    return window
