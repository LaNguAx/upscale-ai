"""Tensor/numpy conversion and spatial augmentation utilities.

All augmentations are applied identically to all LR frames AND the HR
target to maintain spatial correspondence — critical for temporal SR.
"""

import random

import numpy as np
import torch
from torch import Tensor


def to_tensor(img: np.ndarray) -> Tensor:
    """Convert a BGR uint8 HWC numpy image to an RGB float32 CHW tensor in [0, 1].

    Args:
        img: NumPy array of shape (H, W, 3), dtype uint8, BGR channel order.

    Returns:
        Tensor of shape (3, H, W), dtype float32, range [0, 1], RGB order.
    """
    # BGR → RGB
    rgb = img[:, :, ::-1].copy()
    # HWC → CHW, uint8 → float32 [0, 1]
    tensor = torch.from_numpy(rgb.transpose(2, 0, 1)).float() / 255.0
    return tensor


def to_numpy(tensor: Tensor) -> np.ndarray:
    """Convert an RGB float32 CHW tensor to a BGR uint8 HWC numpy image.

    Args:
        tensor: Tensor of shape (3, H, W), dtype float32, range [0, 1], RGB.

    Returns:
        NumPy array of shape (H, W, 3), dtype uint8, BGR channel order.
    """
    img = tensor.clamp(0.0, 1.0).cpu().numpy()
    # CHW → HWC
    img = img.transpose(1, 2, 0)
    # RGB → BGR
    img = img[:, :, ::-1].copy()
    # float32 [0, 1] → uint8 [0, 255]
    return (img * 255.0).round().astype(np.uint8)


def random_crop_pair(
    lr_frames: list[np.ndarray],
    hr_frame: np.ndarray,
    lr_patch_size: int,
    scale: int,
) -> tuple[list[np.ndarray], np.ndarray]:
    """Randomly crop spatially aligned patches from LR frames and HR frame.

    The same spatial location is cropped from all LR frames (temporal
    consistency) and the corresponding HR region.

    Args:
        lr_frames: List of LR frames, each (lr_H, lr_W, 3).
        hr_frame: HR frame of shape (hr_H, hr_W, 3) where hr_H = lr_H * scale.
        lr_patch_size: Size of the LR crop (square).
        scale: Upscale factor.

    Returns:
        (cropped_lr_frames, cropped_hr_frame).
    """
    lr_h, lr_w = lr_frames[0].shape[:2]
    hr_patch_size = lr_patch_size * scale

    # Random top-left corner in LR space
    top = random.randint(0, lr_h - lr_patch_size)
    left = random.randint(0, lr_w - lr_patch_size)

    # Crop LR frames
    cropped_lr = [
        f[top : top + lr_patch_size, left : left + lr_patch_size]
        for f in lr_frames
    ]

    # Corresponding HR crop
    hr_top = top * scale
    hr_left = left * scale
    cropped_hr = hr_frame[hr_top : hr_top + hr_patch_size, hr_left : hr_left + hr_patch_size]

    return cropped_lr, cropped_hr


def random_flip_and_rotate(
    lr_frames: list[np.ndarray],
    hr_frame: np.ndarray,
) -> tuple[list[np.ndarray], np.ndarray]:
    """Apply random horizontal flip, vertical flip, and 90-degree rotation.

    All transformations are applied identically to every frame.

    Args:
        lr_frames: List of LR numpy frames.
        hr_frame: HR numpy frame.

    Returns:
        (augmented_lr_frames, augmented_hr_frame).
    """
    # Horizontal flip
    if random.random() < 0.5:
        lr_frames = [np.fliplr(f).copy() for f in lr_frames]
        hr_frame = np.fliplr(hr_frame).copy()

    # Vertical flip
    if random.random() < 0.5:
        lr_frames = [np.flipud(f).copy() for f in lr_frames]
        hr_frame = np.flipud(hr_frame).copy()

    # Random 90-degree rotation (0, 1, 2, or 3 times)
    k = random.randint(0, 3)
    if k > 0:
        lr_frames = [np.rot90(f, k).copy() for f in lr_frames]
        hr_frame = np.rot90(hr_frame, k).copy()

    return lr_frames, hr_frame
