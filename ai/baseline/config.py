"""Baseline VSR configuration constants and reproducibility setup."""

import random
import numpy as np
import torch
from pathlib import Path

# --- Model & Training Config ---
SEQ_LEN = 5
SCALE = 4
PATCH_SIZE = 64
BATCH_SIZE = 4
NUM_EPOCHS = 30
LR = 2e-4

# --- Extraction Config ---
FRAMES_PER_CLIP = 160

# --- Paths (override via environment or CLI for non-Colab usage) ---
DEFAULT_DATA_DIR = Path("data")
RAW_VIDEO_DIR = DEFAULT_DATA_DIR / "raw_videos"
SPLIT_ROOT = DEFAULT_DATA_DIR / "splits"
SAVE_DIR = DEFAULT_DATA_DIR / "checkpoints"
RESULTS_DIR = DEFAULT_DATA_DIR / "results"

# --- Device ---
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
PIN_MEMORY = torch.cuda.is_available()

# --- Reproducibility ---
SEED = 42


def setup_seed(seed: int = SEED) -> None:
    """Set seeds for all RNG sources for reproducibility."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def ensure_dirs(*dirs: Path) -> None:
    """Create directories if they don't exist."""
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
