"""Model checkpoint save/load utilities.

Checkpoints include model weights, optimizer state, scheduler state,
epoch number, best metric, and the full MLConfig — enabling complete
reconstruction at inference time.
"""

import logging
from pathlib import Path
from typing import Any, Optional

import torch
import torch.nn as nn
from torch.optim import Optimizer
from torch.optim.lr_scheduler import LRScheduler

from src.ml.config import MLConfig

logger = logging.getLogger(__name__)


def save_checkpoint(
    path: str,
    model: nn.Module,
    optimizer: Optimizer,
    scheduler: LRScheduler,
    epoch: int,
    best_psnr: float,
    config: MLConfig,
) -> None:
    """Save a training checkpoint.

    Args:
        path: File path for the checkpoint (.pth).
        model: The model to save.
        optimizer: Current optimizer state.
        scheduler: Current LR scheduler state.
        epoch: Current epoch number.
        best_psnr: Best validation PSNR achieved so far.
        config: MLConfig used for this training run.
    """
    Path(path).parent.mkdir(parents=True, exist_ok=True)

    checkpoint = {
        "model_state_dict": model.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "scheduler_state_dict": scheduler.state_dict(),
        "epoch": epoch,
        "best_psnr": best_psnr,
        "config": config.to_dict(),
    }

    torch.save(checkpoint, path)
    logger.info(f"Checkpoint saved: {path} (epoch {epoch}, PSNR {best_psnr:.2f} dB)")


def load_checkpoint(
    path: str,
    model: nn.Module,
    optimizer: Optional[Optimizer] = None,
    scheduler: Optional[LRScheduler] = None,
) -> dict[str, Any]:
    """Load a training checkpoint.

    Args:
        path: Path to the checkpoint file.
        model: Model to load weights into.
        optimizer: Optional optimizer to restore state.
        scheduler: Optional scheduler to restore state.

    Returns:
        Dictionary with checkpoint metadata (epoch, best_psnr, config).
    """
    checkpoint = torch.load(path, map_location="cpu", weights_only=False)

    model.load_state_dict(checkpoint["model_state_dict"])
    logger.info(f"Model weights loaded from {path}")

    if optimizer is not None and "optimizer_state_dict" in checkpoint:
        optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
        logger.info("Optimizer state restored")

    if scheduler is not None and "scheduler_state_dict" in checkpoint:
        scheduler.load_state_dict(checkpoint["scheduler_state_dict"])
        logger.info("Scheduler state restored")

    return {
        "epoch": checkpoint.get("epoch", 0),
        "best_psnr": checkpoint.get("best_psnr", 0.0),
        "config": checkpoint.get("config", {}),
    }
