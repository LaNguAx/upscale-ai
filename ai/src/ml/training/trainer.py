"""Training loop for the TemporalSRNet video super-resolution model.

Usage:
    python -m src.ml.training.trainer --data-root /path/to/data --epochs 200

The trainer handles:
- Model construction and weight initialization
- Loss computation (Charbonnier + optional perceptual)
- Adam optimizer with cosine/step LR scheduling
- Gradient clipping
- Validation with PSNR/SSIM metrics
- TensorBoard logging
- Best-model and periodic checkpointing
- Reproducibility seeding
"""

import argparse
import logging
import os
from collections import defaultdict

import numpy as np
import torch
import torch.nn as nn
from torch.optim import Adam
from torch.optim.lr_scheduler import CosineAnnealingLR, StepLR

from src.ml.config import MLConfig
from src.ml.models.baseline_model import TemporalSRNet
from src.ml.losses.combined import CombinedLoss
from src.ml.data.dataset import create_dataloaders
from src.ml.training.metrics import compute_psnr, compute_ssim
from src.ml.training.checkpoint import save_checkpoint, load_checkpoint

logger = logging.getLogger(__name__)


class Trainer:
    """Orchestrates the complete training pipeline.

    Args:
        config: MLConfig with all hyperparameters.
    """

    def __init__(self, config: MLConfig) -> None:
        self.config = config
        self.device = self._resolve_device()

        # Reproducibility
        torch.manual_seed(42)
        np.random.seed(42)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(42)
            torch.backends.cudnn.deterministic = True
            torch.backends.cudnn.benchmark = False

        # Model
        self.model = TemporalSRNet(config).to(self.device)
        param_count = sum(p.numel() for p in self.model.parameters())
        logger.info(f"Model parameters: {param_count:,}")

        # Loss
        self.criterion = CombinedLoss(config).to(self.device)

        # Optimizer
        self.optimizer = Adam(
            self.model.parameters(),
            lr=config.learning_rate,
            weight_decay=config.weight_decay,
            betas=(0.9, 0.999),
        )

        # LR Scheduler
        if config.lr_scheduler == "cosine":
            self.scheduler = CosineAnnealingLR(
                self.optimizer, T_max=config.num_epochs, eta_min=1e-7
            )
        else:
            self.scheduler = StepLR(
                self.optimizer,
                step_size=config.step_lr_step_size,
                gamma=config.step_lr_gamma,
            )

        # Data
        self.train_loader, self.val_loader, self.test_loader = create_dataloaders(config)

        # TensorBoard (lazy import to avoid hard dependency)
        self.writer = None
        try:
            from torch.utils.tensorboard import SummaryWriter
            os.makedirs(config.log_dir, exist_ok=True)
            self.writer = SummaryWriter(config.log_dir)
        except ImportError:
            logger.warning("TensorBoard not available — logging to console only")

        # Tracking
        self.best_psnr = 0.0
        self.start_epoch = 0

    def _resolve_device(self) -> torch.device:
        if self.config.device == "auto":
            return torch.device("cuda" if torch.cuda.is_available() else "cpu")
        return torch.device(self.config.device)

    def train_epoch(self, epoch: int) -> dict[str, float]:
        """Run one training epoch."""
        self.model.train()
        epoch_losses: dict[str, float] = defaultdict(float)

        for lr_seq, hr_target in self.train_loader:
            lr_seq = lr_seq.to(self.device)
            hr_target = hr_target.to(self.device)

            self.optimizer.zero_grad()

            prediction = self.model(lr_seq)
            losses = self.criterion(prediction, hr_target)
            losses["total"].backward()

            # Gradient clipping
            nn.utils.clip_grad_norm_(
                self.model.parameters(), self.config.gradient_clip_norm
            )

            self.optimizer.step()

            for key, val in losses.items():
                epoch_losses[key] += val.item()

        num_batches = len(self.train_loader)
        return {k: v / max(num_batches, 1) for k, v in epoch_losses.items()}

    @torch.no_grad()
    def validate(self) -> tuple[dict[str, float], float, float]:
        """Run validation and compute quality metrics."""
        self.model.eval()
        val_losses: dict[str, float] = defaultdict(float)
        total_psnr = 0.0
        total_ssim = 0.0
        count = 0

        for lr_seq, hr_target in self.val_loader:
            lr_seq = lr_seq.to(self.device)
            hr_target = hr_target.to(self.device)

            prediction = self.model(lr_seq).clamp(0.0, 1.0)
            losses = self.criterion(prediction, hr_target)

            for key, val in losses.items():
                val_losses[key] += val.item()

            # Per-image metrics
            for i in range(prediction.size(0)):
                total_psnr += compute_psnr(prediction[i], hr_target[i])
                total_ssim += compute_ssim(prediction[i], hr_target[i])
                count += 1

        num_batches = len(self.val_loader)
        avg_losses = {k: v / max(num_batches, 1) for k, v in val_losses.items()}
        avg_psnr = total_psnr / max(count, 1)
        avg_ssim = total_ssim / max(count, 1)

        return avg_losses, avg_psnr, avg_ssim

    def train(self) -> None:
        """Execute the full training loop."""
        logger.info(
            f"Starting training: {self.config.num_epochs} epochs, "
            f"device={self.device}, batch_size={self.config.batch_size}"
        )

        os.makedirs(self.config.checkpoint_dir, exist_ok=True)

        for epoch in range(self.start_epoch, self.config.num_epochs):
            # Train
            train_losses = self.train_epoch(epoch)

            # Validate
            val_losses, val_psnr, val_ssim = self.validate()

            # Step scheduler
            self.scheduler.step()

            current_lr = self.optimizer.param_groups[0]["lr"]

            # TensorBoard logging
            if self.writer is not None:
                for key, val in train_losses.items():
                    self.writer.add_scalar(f"train/{key}", val, epoch)
                for key, val in val_losses.items():
                    self.writer.add_scalar(f"val/{key}", val, epoch)
                self.writer.add_scalar("val/psnr", val_psnr, epoch)
                self.writer.add_scalar("val/ssim", val_ssim, epoch)
                self.writer.add_scalar("lr", current_lr, epoch)

            # Console logging
            logger.info(
                f"Epoch {epoch + 1}/{self.config.num_epochs} | "
                f"Train Loss: {train_losses.get('total', 0):.4f} | "
                f"Val PSNR: {val_psnr:.2f} dB | Val SSIM: {val_ssim:.4f} | "
                f"LR: {current_lr:.2e}"
            )

            # Save best model
            if val_psnr > self.best_psnr:
                self.best_psnr = val_psnr
                save_checkpoint(
                    path=os.path.join(self.config.checkpoint_dir, "best_model.pth"),
                    model=self.model,
                    optimizer=self.optimizer,
                    scheduler=self.scheduler,
                    epoch=epoch,
                    best_psnr=self.best_psnr,
                    config=self.config,
                )

            # Periodic checkpoint
            if (epoch + 1) % self.config.save_every_n_epochs == 0:
                save_checkpoint(
                    path=os.path.join(
                        self.config.checkpoint_dir, f"epoch_{epoch + 1}.pth"
                    ),
                    model=self.model,
                    optimizer=self.optimizer,
                    scheduler=self.scheduler,
                    epoch=epoch,
                    best_psnr=self.best_psnr,
                    config=self.config,
                )

        if self.writer is not None:
            self.writer.close()

        logger.info(
            f"Training complete. Best Val PSNR: {self.best_psnr:.2f} dB"
        )


def main() -> None:
    """CLI entry point for training."""
    parser = argparse.ArgumentParser(description="Train TemporalSRNet")
    parser.add_argument("--data-root", required=True, help="Path to video frame dataset")
    parser.add_argument("--epochs", type=int, default=200, help="Number of training epochs")
    parser.add_argument("--batch-size", type=int, default=8, help="Training batch size")
    parser.add_argument("--lr", type=float, default=2e-4, help="Learning rate")
    parser.add_argument("--upscale-factor", type=int, default=2, choices=[2, 4], help="Upscale factor")
    parser.add_argument("--patch-size", type=int, default=64, help="LR patch size")
    parser.add_argument("--num-features", type=int, default=64, help="Number of feature channels")
    parser.add_argument("--num-blocks", type=int, default=10, help="Number of residual blocks")
    parser.add_argument("--perceptual-weight", type=float, default=0.0, help="Perceptual loss weight")
    parser.add_argument("--resume", type=str, default=None, help="Path to checkpoint to resume from")
    parser.add_argument("--checkpoint-dir", default="checkpoints", help="Directory for checkpoints")
    parser.add_argument("--log-dir", default="logs", help="TensorBoard log directory")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    config = MLConfig(
        data_root=args.data_root,
        num_epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        upscale_factor=args.upscale_factor,
        patch_size=args.patch_size,
        num_features=args.num_features,
        num_residual_blocks=args.num_blocks,
        perceptual_weight=args.perceptual_weight,
        checkpoint_dir=args.checkpoint_dir,
        log_dir=args.log_dir,
    )

    trainer = Trainer(config)

    if args.resume:
        meta = load_checkpoint(
            args.resume, trainer.model, trainer.optimizer, trainer.scheduler
        )
        trainer.start_epoch = meta["epoch"] + 1
        trainer.best_psnr = meta["best_psnr"]
        logger.info(f"Resumed from epoch {trainer.start_epoch}, best PSNR: {trainer.best_psnr:.2f}")

    trainer.train()


if __name__ == "__main__":
    main()
