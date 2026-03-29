"""Evaluation metrics and model evaluation utilities."""

import math
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader


def psnr_torch(pred: torch.Tensor, target: torch.Tensor, max_val: float = 1.0) -> float:
    """Compute PSNR between predicted and target tensors, handling size mismatches."""
    h = min(pred.shape[-2], target.shape[-2])
    w = min(pred.shape[-1], target.shape[-1])

    pred = pred[..., :h, :w]
    target = target[..., :h, :w]

    mse = F.mse_loss(pred, target)
    if mse.item() == 0:
        return 99.0
    return 20 * math.log10(max_val) - 10 * math.log10(mse.item())


@torch.no_grad()
def evaluate_patch_loader(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.Module,
    device: torch.device,
) -> tuple[float, float]:
    """Evaluate model on patch-based loader. Returns (avg_loss, avg_psnr)."""
    model.eval()
    running_loss = 0.0
    running_psnr = 0.0

    for lr_seq, hr_seq in loader:
        lr_seq = lr_seq.to(device, non_blocking=True)
        hr_seq = hr_seq.to(device, non_blocking=True)

        target = hr_seq[:, hr_seq.shape[1] // 2]
        pred = model(lr_seq)

        loss = criterion(pred, target)
        psnr = psnr_torch(pred, target)

        running_loss += loss.item()
        running_psnr += psnr

    avg_loss = running_loss / max(len(loader), 1)
    avg_psnr = running_psnr / max(len(loader), 1)
    return avg_loss, avg_psnr


@torch.no_grad()
def evaluate_full_frame_loader(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
) -> float:
    """Evaluate model on full-frame loader. Returns average PSNR."""
    model.eval()
    psnrs = []

    for lr_seq, hr_seq, clip_name, start_idx in loader:
        lr_seq = lr_seq.to(device, non_blocking=True)
        hr_seq = hr_seq.to(device, non_blocking=True)

        target = hr_seq[:, hr_seq.shape[1] // 2]
        pred = model(lr_seq)

        psnrs.append(psnr_torch(pred, target))

    return float(np.mean(psnrs)) if len(psnrs) > 0 else 0.0


@torch.no_grad()
def evaluate_bicubic_full_frame(
    loader: DataLoader,
    scale: int = 4,
) -> float:
    """Evaluate bicubic interpolation baseline on full-frame loader. Returns average PSNR."""
    psnrs = []

    for lr_seq, hr_seq, clip_name, start_idx in loader:
        lr_mid = lr_seq[:, lr_seq.shape[1] // 2]
        hr_mid = hr_seq[:, hr_seq.shape[1] // 2]

        bicubic = F.interpolate(
            lr_mid,
            scale_factor=scale,
            mode="bicubic",
            align_corners=False,
        )

        h = min(bicubic.shape[-2], hr_mid.shape[-2])
        w = min(bicubic.shape[-1], hr_mid.shape[-1])

        bicubic = bicubic[..., :h, :w]
        hr_mid = hr_mid[..., :h, :w]

        psnrs.append(psnr_torch(bicubic, hr_mid))

    return float(np.mean(psnrs)) if len(psnrs) > 0 else 0.0
