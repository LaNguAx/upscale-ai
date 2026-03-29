"""Video dataset, transforms, and data loading utilities."""

import random
import cv2
import numpy as np
import torch
from pathlib import Path
from torch.utils.data import Dataset, DataLoader

from .config import SEQ_LEN, SCALE, PATCH_SIZE, BATCH_SIZE, PIN_MEMORY, SPLIT_ROOT


def img_to_tensor(img: np.ndarray) -> torch.Tensor:
    """Convert HWC uint8 image to CHW float32 tensor in [0, 1]."""
    img = img.astype(np.float32) / 255.0
    img = np.transpose(img, (2, 0, 1))
    return torch.from_numpy(img)


def tensor_to_img(tensor: torch.Tensor) -> np.ndarray:
    """Convert CHW float tensor to HWC uint8 image."""
    img = tensor.detach().cpu().clamp(0, 1).numpy()
    img = np.transpose(img, (1, 2, 0))
    img = (img * 255.0).round().astype(np.uint8)
    return img


def add_light_degradation(img: np.ndarray) -> np.ndarray:
    """Apply random light blur and/or noise for training augmentation."""
    out = img.copy()

    if random.random() < 0.3:
        out = cv2.GaussianBlur(out, (3, 3), 0)

    if random.random() < 0.3:
        noise = np.random.normal(0, 2.0, out.shape).astype(np.float32)
        out = np.clip(out.astype(np.float32) + noise, 0, 255).astype(np.uint8)

    return out


class CustomVideoDataset(Dataset):
    """
    Dataset of LR/HR frame sequence pairs for video super-resolution.

    Each sample is a temporal window of `seq_len` consecutive frames.
    Training mode uses random crops and augmentation.
    Evaluation mode uses center crops (or full frames if `return_full_frame=True`).
    """

    def __init__(
        self,
        split_root: Path | str = SPLIT_ROOT,
        split: str = "train",
        seq_len: int = SEQ_LEN,
        scale: int = SCALE,
        patch_size: int = PATCH_SIZE,
        return_full_frame: bool = False,
    ):
        self.split_root = Path(split_root)
        self.split = split
        self.seq_len = seq_len
        self.scale = scale
        self.patch_size = patch_size
        self.return_full_frame = return_full_frame
        self.use_augmentation = split == "train"
        self.samples: list[dict] = []

        split_dir = self.split_root / split
        clip_dirs = sorted([p for p in split_dir.iterdir() if p.is_dir()])

        for clip_dir in clip_dirs:
            hr_frames = sorted((clip_dir / "hr_frames").glob("*.png"))
            lr_frames = sorted((clip_dir / "lr_frames").glob("*.png"))

            if len(hr_frames) != len(lr_frames):
                print(f"Skipping {clip_dir.name}: HR/LR mismatch")
                continue

            if len(hr_frames) < seq_len:
                print(f"Skipping {clip_dir.name}: too short")
                continue

            for i in range(len(hr_frames) - seq_len + 1):
                self.samples.append({
                    "clip_name": clip_dir.name,
                    "hr": hr_frames[i : i + seq_len],
                    "lr": lr_frames[i : i + seq_len],
                    "start_idx": i,
                })

        print(f"{split}: loaded {len(self.samples)} samples")

    def __len__(self) -> int:
        return len(self.samples)

    def _read_img(self, path: Path) -> np.ndarray:
        img = cv2.imread(str(path))
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        return img

    def _deterministic_crop(self, h: int, w: int, lp: int, idx: int):
        top = max((h - lp) // 2, 0)
        left = max((w - lp) // 2, 0)
        return top, left

    def __getitem__(self, idx: int):
        sample = self.samples[idx]
        hr_frames = [self._read_img(p) for p in sample["hr"]]
        lr_frames = [self._read_img(p) for p in sample["lr"]]

        if self.return_full_frame:
            lr_tensors = torch.stack([img_to_tensor(img) for img in lr_frames], dim=0)
            hr_tensors = torch.stack([img_to_tensor(img) for img in hr_frames], dim=0)
            return lr_tensors, hr_tensors, sample["clip_name"], sample["start_idx"]

        lp = self.patch_size
        hp = lp * self.scale
        h, w = lr_frames[0].shape[:2]

        if h < lp or w < lp:
            raise ValueError(f"Patch size {lp} too large for LR frame size {(h, w)}")

        if self.split == "train":
            top = random.randint(0, h - lp)
            left = random.randint(0, w - lp)
        else:
            top, left = self._deterministic_crop(h, w, lp, idx)

        lr_patches = [f[top : top + lp, left : left + lp] for f in lr_frames]
        hr_patches = [
            f[
                top * self.scale : top * self.scale + hp,
                left * self.scale : left * self.scale + hp,
            ]
            for f in hr_frames
        ]

        if self.use_augmentation:
            if random.random() < 0.5:
                lr_patches = [np.fliplr(img).copy() for img in lr_patches]
                hr_patches = [np.fliplr(img).copy() for img in hr_patches]

            if random.random() < 0.5:
                lr_patches = [np.flipud(img).copy() for img in lr_patches]
                hr_patches = [np.flipud(img).copy() for img in hr_patches]

            if random.random() < 0.3:
                lr_patches = [add_light_degradation(img) for img in lr_patches]

        lr_tensors = torch.stack([img_to_tensor(img) for img in lr_patches], dim=0)
        hr_tensors = torch.stack([img_to_tensor(img) for img in hr_patches], dim=0)

        return lr_tensors, hr_tensors


def create_loaders(
    split_root: Path | str = SPLIT_ROOT,
    seq_len: int = SEQ_LEN,
    scale: int = SCALE,
    patch_size: int = PATCH_SIZE,
    batch_size: int = BATCH_SIZE,
) -> dict[str, DataLoader]:
    """Create all data loaders for training, validation, and testing."""
    train_ds = CustomVideoDataset(split_root, "train", seq_len, scale, patch_size)
    val_ds = CustomVideoDataset(split_root, "val", seq_len, scale, patch_size)
    test_ds = CustomVideoDataset(split_root, "test", seq_len, scale, patch_size)
    val_full_ds = CustomVideoDataset(split_root, "val", seq_len, scale, patch_size, return_full_frame=True)
    test_full_ds = CustomVideoDataset(split_root, "test", seq_len, scale, patch_size, return_full_frame=True)

    return {
        "train": DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=0, pin_memory=PIN_MEMORY),
        "val": DataLoader(val_ds, batch_size=1, shuffle=False, num_workers=0, pin_memory=PIN_MEMORY),
        "test": DataLoader(test_ds, batch_size=1, shuffle=False, num_workers=0, pin_memory=PIN_MEMORY),
        "val_full": DataLoader(val_full_ds, batch_size=1, shuffle=False, num_workers=0, pin_memory=PIN_MEMORY),
        "test_full": DataLoader(test_full_ds, batch_size=1, shuffle=False, num_workers=0, pin_memory=PIN_MEMORY),
    }
