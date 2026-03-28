"""Video frame dataset for temporal super-resolution training.

Loads consecutive HQ frames from a directory structure, applies synthetic
degradation to produce LQ-HQ pairs, and returns properly shaped tensors
for the TemporalSRNet model.

Expected directory structure:
    data_root/
      video_001/
        frame_000000.png
        frame_000001.png
        ...
      video_002/
        ...
"""

import logging
from pathlib import Path

import cv2
import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader

from src.ml.config import MLConfig
from src.ml.data.degradation import SyntheticDegradationPipeline
from src.ml.data.transforms import (
    random_crop_pair,
    random_flip_and_rotate,
    to_tensor,
)

logger = logging.getLogger(__name__)


class VideoFrameDataset(Dataset):
    """PyTorch dataset that yields (LR_sequence, HR_center) tensor pairs.

    Each sample:
    1. Loads N consecutive HQ frames centered on a target frame.
    2. Degrades each HQ frame independently to produce LR frames.
    3. Randomly crops spatially aligned LR/HR patches.
    4. Applies geometric augmentations identically to all frames.
    5. Converts to tensors and concatenates LR frames along channel dim.

    Split is done by **video** (not by frame) to prevent data leakage.

    Args:
        config: MLConfig with data and degradation parameters.
        split: One of "train", "val", "test".
        video_dirs: Pre-computed list of video directories for this split.
    """

    def __init__(
        self,
        config: MLConfig,
        split: str,
        video_dirs: list[Path],
    ) -> None:
        super().__init__()
        self.config = config
        self.split = split
        self.is_train = split == "train"

        self.degradation = SyntheticDegradationPipeline(config)
        self.num_frames = config.num_input_frames
        self.scale = config.upscale_factor
        self.patch_size = config.patch_size
        self.half_window = self.num_frames // 2

        # Build index: list of (video_dir, center_frame_index)
        self.samples: list[tuple[Path, int]] = []
        self.frame_lists: dict[str, list[str]] = {}

        for video_dir in sorted(video_dirs):
            frames = sorted(
                [str(f) for f in video_dir.iterdir() if f.suffix.lower() in (".png", ".jpg", ".jpeg")]
            )
            if len(frames) < self.num_frames:
                continue

            self.frame_lists[str(video_dir)] = frames

            # Every frame can be a center frame (edge padding handles boundaries)
            for center_idx in range(len(frames)):
                self.samples.append((video_dir, center_idx))

        logger.info(
            f"VideoFrameDataset [{split}]: {len(video_dirs)} videos, "
            f"{len(self.samples)} samples"
        )

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        video_dir, center_idx = self.samples[idx]
        frames = self.frame_lists[str(video_dir)]
        total_frames = len(frames)

        # Load N consecutive HQ frames with boundary replication
        hq_frames: list[np.ndarray] = []
        for offset in range(-self.half_window, self.half_window + 1):
            frame_idx = max(0, min(total_frames - 1, center_idx + offset))
            img = cv2.imread(frames[frame_idx])
            if img is None:
                raise ValueError(f"Cannot read frame: {frames[frame_idx]}")
            hq_frames.append(img)

        # The center HQ frame is the ground-truth target
        hr_frame = hq_frames[self.half_window].copy()

        # Apply synthetic degradation to each frame independently
        h, w = hr_frame.shape[:2]
        lr_h, lr_w = h // self.scale, w // self.scale
        lr_frames = [
            self.degradation(f, (lr_h, lr_w)) for f in hq_frames
        ]

        # Random spatial crop (training only)
        if self.is_train:
            lr_frames, hr_frame = random_crop_pair(
                lr_frames, hr_frame, self.patch_size, self.scale
            )

        # Geometric augmentations (training only)
        if self.is_train:
            lr_frames, hr_frame = random_flip_and_rotate(lr_frames, hr_frame)

        # Convert to tensors: BGR uint8 → RGB float32 [0, 1]
        lr_tensors = [to_tensor(f) for f in lr_frames]
        hr_tensor = to_tensor(hr_frame)

        # Concatenate LR frames along channel dim: (N*3, H, W)
        lr_sequence = torch.cat(lr_tensors, dim=0)

        return lr_sequence, hr_tensor


def _split_videos(data_root: Path, config: MLConfig) -> tuple[list[Path], list[Path], list[Path]]:
    """Split video directories into train/val/test sets."""
    video_dirs = sorted([d for d in data_root.iterdir() if d.is_dir()])
    total = len(video_dirs)

    if total == 0:
        raise ValueError(f"No video directories found in {data_root}")

    n_train = max(1, int(total * config.train_split))
    n_val = max(1, int(total * config.val_split))

    train_dirs = video_dirs[:n_train]
    val_dirs = video_dirs[n_train : n_train + n_val]
    test_dirs = video_dirs[n_train + n_val :]

    # Ensure test has at least one video if available
    if not test_dirs and len(val_dirs) > 1:
        test_dirs = [val_dirs.pop()]

    logger.info(
        f"Data split: {len(train_dirs)} train, {len(val_dirs)} val, "
        f"{len(test_dirs)} test videos"
    )

    return train_dirs, val_dirs, test_dirs


def create_dataloaders(
    config: MLConfig,
) -> tuple[DataLoader, DataLoader, DataLoader]:
    """Create train, validation, and test DataLoaders.

    Args:
        config: MLConfig with data_root, split ratios, batch_size, etc.

    Returns:
        (train_loader, val_loader, test_loader).
    """
    data_root = Path(config.data_root)
    train_dirs, val_dirs, test_dirs = _split_videos(data_root, config)

    train_dataset = VideoFrameDataset(config, "train", train_dirs)
    val_dataset = VideoFrameDataset(config, "val", val_dirs)
    test_dataset = VideoFrameDataset(config, "test", test_dirs)

    pin_memory = torch.cuda.is_available()

    train_loader = DataLoader(
        train_dataset,
        batch_size=config.batch_size,
        shuffle=True,
        num_workers=config.num_workers,
        pin_memory=pin_memory,
        drop_last=True,
    )

    val_loader = DataLoader(
        val_dataset,
        batch_size=config.batch_size,
        shuffle=False,
        num_workers=config.num_workers,
        pin_memory=pin_memory,
    )

    test_loader = DataLoader(
        test_dataset,
        batch_size=config.batch_size,
        shuffle=False,
        num_workers=config.num_workers,
        pin_memory=pin_memory,
    )

    return train_loader, val_loader, test_loader
