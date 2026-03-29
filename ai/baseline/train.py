"""Training loop, optimizer setup, and result visualization."""

import time
import torch
import torch.nn as nn
import torch.optim as optim
import matplotlib.pyplot as plt
from pathlib import Path
from torch.utils.data import DataLoader

from .config import NUM_EPOCHS, LR, SAVE_DIR, DEVICE
from .metrics import evaluate_patch_loader


def train_one_epoch(
    model: nn.Module,
    loader: DataLoader,
    optimizer: optim.Optimizer,
    criterion: nn.Module,
    device: torch.device,
) -> float:
    """Train model for one epoch. Returns average loss."""
    model.train()
    running_loss = 0.0

    for lr_seq, hr_seq in loader:
        lr_seq = lr_seq.to(device, non_blocking=True)
        hr_seq = hr_seq.to(device, non_blocking=True)

        target = hr_seq[:, hr_seq.shape[1] // 2]

        optimizer.zero_grad(set_to_none=True)
        pred = model(lr_seq)
        loss = criterion(pred, target)
        loss.backward()
        optimizer.step()

        running_loss += loss.item()

    return running_loss / max(len(loader), 1)


def run_training(
    model: nn.Module,
    train_loader: DataLoader,
    val_loader: DataLoader,
    device: torch.device = DEVICE,
    num_epochs: int = NUM_EPOCHS,
    lr: float = LR,
    save_dir: Path = SAVE_DIR,
) -> dict:
    """
    Full training loop with validation, checkpointing, and history tracking.

    Returns a history dict with train_loss, val_loss, val_psnr_patch lists.
    """
    save_dir.mkdir(parents=True, exist_ok=True)
    best_path = save_dir / "vsr_model_best.pth"
    last_path = save_dir / "vsr_model_last.pth"

    criterion = nn.L1Loss()
    optimizer = optim.Adam(model.parameters(), lr=lr)
    scheduler = optim.lr_scheduler.StepLR(optimizer, step_size=5, gamma=0.5)

    history = {
        "train_loss": [],
        "val_loss": [],
        "val_psnr_patch": [],
    }

    best_val_psnr = -1.0

    for epoch in range(1, num_epochs + 1):
        t0 = time.time()

        train_loss = train_one_epoch(model, train_loader, optimizer, criterion, device)
        val_loss, val_psnr_patch = evaluate_patch_loader(model, val_loader, criterion, device)

        scheduler.step()

        history["train_loss"].append(train_loss)
        history["val_loss"].append(val_loss)
        history["val_psnr_patch"].append(val_psnr_patch)

        torch.save(model.state_dict(), last_path)

        best_mark = ""
        if val_psnr_patch > best_val_psnr:
            best_val_psnr = val_psnr_patch
            torch.save(model.state_dict(), best_path)
            best_mark = " <-- best"

        dt = time.time() - t0
        print(
            f"Epoch [{epoch}/{num_epochs}] "
            f"train_loss={train_loss:.4f} "
            f"val_loss={val_loss:.4f} "
            f"val_psnr_patch={val_psnr_patch:.2f} "
            f"time={dt:.1f}s"
            f"{best_mark}"
        )

    print("Training done.")
    return history


def plot_history(history: dict) -> None:
    """Plot training loss and validation PSNR curves."""
    plt.figure(figsize=(12, 4))

    plt.subplot(1, 2, 1)
    plt.plot(history["train_loss"], label="train_loss")
    plt.plot(history["val_loss"], label="val_loss")
    plt.title("Loss")
    plt.legend()

    plt.subplot(1, 2, 2)
    plt.plot(history["val_psnr_patch"], label="val_psnr_patch")
    plt.title("Val PSNR (patch)")
    plt.legend()

    plt.tight_layout()
    plt.show()
