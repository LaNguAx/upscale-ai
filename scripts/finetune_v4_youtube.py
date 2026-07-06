#!/usr/bin/env python3
"""Fine-tune the V3 BasicVSR+SPyNet checkpoint on YouTube-style codec degradation.

This is the V4 training entrypoint. It is a standalone script (the V3 pipeline in
apps/ai/baseline/Model_v3.ipynb is intentionally left untouched) that:

  1. Builds a NEW split tree at <workspace>/splits from the V3 processed splits,
     WITHOUT modifying them: hr_frames are symlinked from V3, and new
     codec-compressed LR frames are generated per clip with
     scripts/degrade_clip_video.py (per-clip params + real H.264 round-trip).
     A replay subset keeps the old V3 LR frames (symlinked) to prevent
     catastrophic forgetting, and two val sets are built:
       val_old   — V3 degradation (proves no forgetting)
       val_codec — new degradation (proves adaptation)
  2. Loads the V3 checkpoint, freezes SPyNet, and fine-tunes at a low LR
     (default 2.5e-5) with the same Charbonnier + Sobel-edge + VGG loss.
  3. Checkpoints on the best COMBINED val loss (mean of old + codec), so the
     model never silently trades one domain for the other. All outputs go to
     <workspace> (default vsr_workspace/experiments/model_v4_finetune_youtube)
     — nothing under the V3 experiment dir is written.

Run in the training environment (same one that ran Model_v3.ipynb), with
model_architecture.py (from apps/ai/baseline/) and degrade_clip_video.py
next to this file or importable:

  # Build the degraded data only, on a small subset, and inspect it first:
  python finetune_v4_youtube.py --data-only --max-clips 5

  # Full run:
  python finetune_v4_youtube.py

Requires: torch, torchvision, opencv-python, numpy, tqdm, ffmpeg on PATH;
scikit-image optional (SSIM).
"""

import argparse
import hashlib
import json
import math
import random
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim
import torchvision.models as models
from torch.utils.data import ConcatDataset, DataLoader, Dataset
from tqdm import tqdm

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR.parent / "apps" / "ai" / "baseline"))

from degrade_clip_video import youtube_degrade_clip  # noqa: E402
from model_architecture import BasicVSRRecurrentSeq  # noqa: E402

try:
    from skimage.metrics import structural_similarity as ssim_metric

    SKIMAGE_AVAILABLE = True
except ImportError:
    SKIMAGE_AVAILABLE = False


# ── data preparation ─────────────────────────────────────────────────────────


def clip_seed(base_seed: int, key: str) -> int:
    digest = hashlib.sha256(f"{base_seed}:{key}".encode()).hexdigest()
    return int(digest[:8], 16)


def link_or_copy(src: Path, dest: Path) -> None:
    if dest.exists() or dest.is_symlink():
        return
    try:
        dest.symlink_to(src, target_is_directory=True)
    except OSError:
        shutil.copytree(src, dest)


def read_frames(frames_dir: Path):
    frames = []
    for p in sorted(frames_dir.glob("*.png")):
        frame = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if frame is not None:
            frames.append(frame)
    if len(frames) == 0:
        raise RuntimeError(f"No readable PNG frames in {frames_dir}")
    return frames


def build_codec_clip(v3_clip: Path, dest_clip: Path, seed_key: str, base_seed: int) -> None:
    """One degraded view of a V3 clip: symlinked hr_frames + new codec LR frames."""
    done_marker = dest_clip / "done.txt"
    if done_marker.exists():
        return

    dest_clip.mkdir(parents=True, exist_ok=True)
    link_or_copy(v3_clip / "hr_frames", dest_clip / "hr_frames")

    seed = clip_seed(base_seed, seed_key)
    rng = random.Random(seed)
    np_rng = np.random.default_rng(seed)

    hr_frames = read_frames(v3_clip / "hr_frames")
    hr_out, lr_frames, params = youtube_degrade_clip(hr_frames, scale=4, rng=rng, np_rng=np_rng)
    if len(hr_out) != len(hr_frames) or hr_out[0].shape != hr_frames[0].shape:
        # HR needed cropping to codec-safe dims; the symlinked hr_frames would
        # be misaligned with the LR frames, so materialize the cropped HR.
        hr_link = dest_clip / "hr_frames"
        if hr_link.is_symlink():
            hr_link.unlink()
        else:
            shutil.rmtree(hr_link)
        hr_dir = dest_clip / "hr_frames"
        hr_dir.mkdir()
        for i, frame in enumerate(hr_out):
            cv2.imwrite(str(hr_dir / f"{i:04d}.png"), frame)

    lr_dir = dest_clip / "lr_frames"
    if lr_dir.exists():
        shutil.rmtree(lr_dir)
    lr_dir.mkdir()
    for i, frame in enumerate(lr_frames):
        cv2.imwrite(str(lr_dir / f"{i:04d}.png"), frame)

    done_marker.write_text(params.describe() + "\n")
    print(f"  built {dest_clip.parent.name}/{dest_clip.name}: {params.describe()}", flush=True)


def build_replay_clip(v3_clip: Path, dest_clip: Path) -> None:
    """Replay view: both hr_frames and the OLD V3 lr_frames, symlinked."""
    done_marker = dest_clip / "done.txt"
    if done_marker.exists():
        return
    dest_clip.mkdir(parents=True, exist_ok=True)
    link_or_copy(v3_clip / "hr_frames", dest_clip / "hr_frames")
    link_or_copy(v3_clip / "lr_frames", dest_clip / "lr_frames")
    done_marker.write_text("replay: V3 lr_frames (old per-frame degradation)\n")


def list_clip_dirs(root: Path):
    return sorted([p for p in root.iterdir() if p.is_dir()]) if root.exists() else []


def build_v4_splits(args) -> Path:
    v3_splits = Path(args.v3_splits).resolve()
    v4_splits = Path(args.workspace).resolve() / "splits"

    train_clips = list_clip_dirs(v3_splits / "train")
    val_clips = list_clip_dirs(v3_splits / "val")
    if len(train_clips) == 0 or len(val_clips) == 0:
        sys.exit(
            f"V3 processed splits not found under {v3_splits} — "
            "run the Model_v3.ipynb data cells first (they build hr_frames/lr_frames)."
        )
    if args.max_clips is not None:
        train_clips = train_clips[: args.max_clips]
        val_clips = val_clips[: max(1, args.max_clips // 2)]

    print(f"Building V4 splits at {v4_splits}")
    print(f"  from {len(train_clips)} train / {len(val_clips)} val V3 clips")

    for clip in train_clips:
        for variant in range(1, args.variants + 1):
            build_codec_clip(
                clip,
                v4_splits / "train" / f"{clip.name}__codec{variant}",
                seed_key=f"train/{clip.name}/v{variant}",
                base_seed=args.seed,
            )

    # Replay subset: replay/(replay+codec) == replay_ratio of the train data.
    codec_count = len(train_clips) * args.variants
    replay_count = round(args.replay_ratio / (1.0 - args.replay_ratio) * codec_count)
    replay_count = min(replay_count, len(train_clips))
    replay_rng = random.Random(clip_seed(args.seed, "replay-selection"))
    for clip in replay_rng.sample(train_clips, replay_count):
        build_replay_clip(clip, v4_splits / "train" / f"{clip.name}__replay")
    print(f"  replay clips: {replay_count} (target ratio {args.replay_ratio})")

    for clip in val_clips:
        build_codec_clip(
            clip,
            v4_splits / "val_codec" / clip.name,
            seed_key=f"val/{clip.name}",
            base_seed=args.seed,
        )
        build_replay_clip(clip, v4_splits / "val_old" / clip.name)

    return v4_splits


# ── dataset (ported unchanged from Model_v3.ipynb cell 7) ────────────────────


def random_augment_sequences(lr_seq, hr_seq):
    if random.random() < 0.5:
        lr_seq = [np.ascontiguousarray(img[:, ::-1, :]) for img in lr_seq]
        hr_seq = [np.ascontiguousarray(img[:, ::-1, :]) for img in hr_seq]
    if random.random() < 0.5:
        lr_seq = [np.ascontiguousarray(img[::-1, :, :]) for img in lr_seq]
        hr_seq = [np.ascontiguousarray(img[::-1, :, :]) for img in hr_seq]
    if random.random() < 0.5:
        lr_seq = [np.ascontiguousarray(np.rot90(img)) for img in lr_seq]
        hr_seq = [np.ascontiguousarray(np.rot90(img)) for img in hr_seq]
    return lr_seq, hr_seq


def img_to_tensor_rgb(img_rgb):
    return torch.from_numpy(img_rgb.transpose(2, 0, 1)).float() / 255.0


class CustomVideoDataset(Dataset):
    def __init__(self, split_root, seq_len=15, patch_size=64, training=True, scale=4):
        self.split_root = Path(split_root)
        self.seq_len = seq_len
        self.patch_size = patch_size
        self.training = training
        self.scale = scale
        self.half = seq_len // 2

        self.samples = []
        self.clips = []

        for clip_dir in sorted([p for p in self.split_root.iterdir() if p.is_dir()]):
            hr_frames = sorted((clip_dir / "hr_frames").glob("*.png"))
            lr_frames = sorted((clip_dir / "lr_frames").glob("*.png"))
            if len(hr_frames) == 0 or len(hr_frames) != len(lr_frames):
                continue
            if len(hr_frames) < self.seq_len:
                continue
            self.clips.append(clip_dir)
            for center_idx in range(self.half, len(hr_frames) - self.half):
                self.samples.append(
                    {
                        "lr_seq_paths": lr_frames[center_idx - self.half : center_idx + self.half + 1],
                        "hr_seq_paths": hr_frames[center_idx - self.half : center_idx + self.half + 1],
                        "clip_name": clip_dir.name,
                        "center_idx": center_idx,
                    }
                )

        if len(self.samples) == 0:
            raise RuntimeError(f"No valid samples found in {self.split_root}")
        print(f"{self.split_root.name}: {len(self.samples)} samples from {len(self.clips)} clips")

    def __len__(self):
        return len(self.samples)

    def _read_image(self, path):
        img = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if img is None:
            raise RuntimeError(f"Failed to read image: {path}")
        return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    def _random_crop_sequences(self, lr_seq, hr_seq):
        h_lr, w_lr = lr_seq[0].shape[:2]
        lr_crop = self.patch_size
        hr_crop = self.patch_size * self.scale
        if h_lr < lr_crop or w_lr < lr_crop:
            raise RuntimeError(f"LR frame too small for crop: {(h_lr, w_lr)}")
        top = random.randint(0, h_lr - lr_crop)
        left = random.randint(0, w_lr - lr_crop)
        lr_out = [img[top : top + lr_crop, left : left + lr_crop, :] for img in lr_seq]
        hr_top, hr_left = top * self.scale, left * self.scale
        hr_out = [img[hr_top : hr_top + hr_crop, hr_left : hr_left + hr_crop, :] for img in hr_seq]
        return lr_out, hr_out

    def _center_crop_sequences(self, lr_seq, hr_seq):
        h_lr, w_lr = lr_seq[0].shape[:2]
        lr_crop = min(self.patch_size, h_lr, w_lr)
        hr_crop = lr_crop * self.scale
        top = (h_lr - lr_crop) // 2
        left = (w_lr - lr_crop) // 2
        lr_out = [img[top : top + lr_crop, left : left + lr_crop, :] for img in lr_seq]
        hr_top, hr_left = top * self.scale, left * self.scale
        hr_out = [img[hr_top : hr_top + hr_crop, hr_left : hr_left + hr_crop, :] for img in hr_seq]
        return lr_out, hr_out

    def __getitem__(self, idx):
        sample = self.samples[idx]
        lr_seq = [self._read_image(p) for p in sample["lr_seq_paths"]]
        hr_seq = [self._read_image(p) for p in sample["hr_seq_paths"]]

        if self.training:
            lr_seq, hr_seq = self._random_crop_sequences(lr_seq, hr_seq)
            lr_seq, hr_seq = random_augment_sequences(lr_seq, hr_seq)
        else:
            lr_seq, hr_seq = self._center_crop_sequences(lr_seq, hr_seq)

        lr_seq = torch.stack([img_to_tensor_rgb(img) for img in lr_seq], dim=0)
        hr_seq = torch.stack([img_to_tensor_rgb(img) for img in hr_seq], dim=0)
        return lr_seq, hr_seq, {"clip_name": sample["clip_name"], "center_idx": sample["center_idx"]}


def seed_worker(worker_id):
    worker_seed = torch.initial_seed() % 2**32
    np.random.seed(worker_seed)
    random.seed(worker_seed)


def eval_collate_fn(batch):
    lr_list, hr_list, meta_list = zip(*batch)
    return torch.stack(lr_list, dim=0), torch.stack(hr_list, dim=0), list(meta_list)


def make_loader(dataset, batch_size, shuffle, args, generator=None):
    return DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=shuffle,
        num_workers=args.num_workers,
        pin_memory=True,
        worker_init_fn=seed_worker if args.num_workers > 0 else None,
        generator=generator,
        collate_fn=eval_collate_fn,
        multiprocessing_context="fork" if args.num_workers > 0 and sys.platform.startswith("linux") else None,
    )


# ── losses (ported unchanged from Model_v3.ipynb cell 9) ─────────────────────


class CharbonnierLoss(nn.Module):
    def __init__(self, eps=1e-6):
        super().__init__()
        self.eps = eps

    def forward(self, pred, target):
        diff = pred - target
        return torch.sqrt(diff * diff + self.eps * self.eps).mean()


class SobelEdgeLoss(nn.Module):
    def __init__(self):
        super().__init__()
        sobel_x = torch.tensor([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=torch.float32).view(1, 1, 3, 3)
        sobel_y = torch.tensor([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], dtype=torch.float32).view(1, 1, 3, 3)
        self.register_buffer("sobel_x", sobel_x)
        self.register_buffer("sobel_y", sobel_y)

    def _grad(self, x):
        sobel_x = self.sobel_x.to(device=x.device, dtype=x.dtype)
        sobel_y = self.sobel_y.to(device=x.device, dtype=x.dtype)
        grads = []
        for c in range(x.shape[1]):
            xc = x[:, c : c + 1]
            gx = F.conv2d(xc, sobel_x, padding=1)
            gy = F.conv2d(xc, sobel_y, padding=1)
            grads.append(torch.sqrt(gx * gx + gy * gy + 1e-6))
        return torch.cat(grads, dim=1)

    def forward(self, pred, target):
        return F.l1_loss(self._grad(pred), self._grad(target))


class VGGPerceptualLoss(nn.Module):
    def __init__(self):
        super().__init__()
        vgg = models.vgg19(weights=models.VGG19_Weights.IMAGENET1K_V1).features
        self.slice1 = nn.Sequential(*[vgg[i] for i in range(9)])
        self.slice2 = nn.Sequential(*[vgg[i] for i in range(9, 27)])
        for param in self.parameters():
            param.requires_grad = False
        self.register_buffer("mean", torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1))

    def forward(self, pred, target):
        pred = (pred - self.mean) / self.std
        target = (target - self.mean) / self.std
        pred_f1 = self.slice1(pred)
        target_f1 = self.slice1(target)
        pred_f2 = self.slice2(pred_f1)
        target_f2 = self.slice2(target_f1)
        return F.l1_loss(pred_f1, target_f1) + F.l1_loss(pred_f2, target_f2)


class CombinedRestorationLoss(nn.Module):
    def __init__(self, charbonnier_weight=1.0, edge_weight=0.05, perceptual_weight=0.1):
        super().__init__()
        self.charb = CharbonnierLoss(eps=1e-6)
        self.edge = SobelEdgeLoss()
        self.perceptual = VGGPerceptualLoss()
        self.charbonnier_weight = charbonnier_weight
        self.edge_weight = edge_weight
        self.perceptual_weight = perceptual_weight

    def forward(self, pred, target):
        charb_loss = self.charbonnier_weight * self.charb(pred, target)
        if pred.dim() == 5:
            b, t, c, h, w = pred.shape
            pred_4d = pred.reshape(b * t, c, h, w)
            target_4d = target.reshape(b * t, c, h, w)
        else:
            pred_4d, target_4d = pred, target
        edge_loss = self.edge_weight * self.edge(pred_4d, target_4d)
        perceptual_loss = self.perceptual_weight * self.perceptual(pred_4d, target_4d)
        return charb_loss + edge_loss + perceptual_loss


# ── metrics / eval (ported from Model_v3.ipynb cells 4 and 10) ───────────────


def tensor_to_img(t):
    img = t.detach().cpu().float().numpy().transpose(1, 2, 0)
    img = np.nan_to_num(img, nan=0.0, posinf=1.0, neginf=0.0)
    return (np.clip(img, 0, 1) * 255.0).astype(np.uint8)


def shave_tensor_border(x, border):
    if border <= 0:
        return x
    return x[..., border:-border, border:-border]


def calc_psnr(pred, target, max_val=1.0, shave_border=0):
    if not torch.isfinite(pred).all() or not torch.isfinite(target).all():
        return float("nan")
    pred = shave_tensor_border(pred, shave_border)
    target = shave_tensor_border(target, shave_border)
    mse = F.mse_loss(pred, target).item()
    if not math.isfinite(mse):
        return float("nan")
    if mse == 0:
        return 100.0
    return 20 * math.log10(max_val / math.sqrt(mse))


def calc_ssim(pred, target, shave_border=0):
    if not SKIMAGE_AVAILABLE:
        return None
    if not torch.isfinite(pred).all() or not torch.isfinite(target).all():
        return None
    pred = shave_tensor_border(pred, shave_border)
    target = shave_tensor_border(target, shave_border)
    try:
        return ssim_metric(
            tensor_to_img(pred.squeeze(0)), tensor_to_img(target.squeeze(0)), channel_axis=2, data_range=255
        )
    except Exception:
        return None


def calc_ssim_sequence(pred_seq, target_seq, shave_border=0):
    vals = []
    for i in range(pred_seq.shape[1]):
        s = calc_ssim(pred_seq[:, i], target_seq[:, i], shave_border=shave_border)
        if s is not None:
            vals.append(s)
    return float(np.mean(vals)) if len(vals) > 0 else None


def bicubic_upsample_sequence(lr_seq, scale):
    b, t, c, h, w = lr_seq.shape
    x = lr_seq.reshape(b * t, c, h, w)
    up = F.interpolate(x, scale_factor=scale, mode="bicubic", align_corners=False)
    up = torch.clamp(up, 0.0, 1.0)
    up = torch.nan_to_num(up, nan=0.0, posinf=1.0, neginf=0.0)
    return up.view(b, t, c, h * scale, w * scale)


@torch.no_grad()
def evaluate_model(model, loader, criterion, device, scale=4, shave_border=4, compute_ssim=True):
    model.eval()
    total_loss = total_psnr = total_bicubic_psnr = 0.0
    total_ssim = 0.0
    count = ssim_count = 0

    for lr_seq, hr_seq, _ in loader:
        lr_seq = lr_seq.to(device, non_blocking=True)
        hr_seq = hr_seq.to(device, non_blocking=True)
        if not torch.isfinite(lr_seq).all() or not torch.isfinite(hr_seq).all():
            continue
        pred = model(lr_seq)
        if not torch.isfinite(pred).all():
            continue
        loss = criterion(pred, hr_seq)
        if not torch.isfinite(loss):
            continue

        pred_psnr = calc_psnr(pred, hr_seq, shave_border=shave_border)
        bicubic = bicubic_upsample_sequence(lr_seq, scale=scale)
        bicubic_psnr = calc_psnr(bicubic, hr_seq, shave_border=shave_border)
        if not math.isfinite(pred_psnr) or not math.isfinite(bicubic_psnr):
            continue

        total_loss += loss.item()
        total_psnr += pred_psnr
        total_bicubic_psnr += bicubic_psnr
        if compute_ssim:
            pred_ssim = calc_ssim_sequence(pred, hr_seq, shave_border=shave_border)
            if pred_ssim is not None:
                total_ssim += pred_ssim
                ssim_count += 1
        count += 1

    if count == 0:
        return {"loss": float("nan"), "psnr": float("nan"), "ssim": None, "bicubic_psnr": float("nan")}
    return {
        "loss": total_loss / count,
        "psnr": total_psnr / count,
        "ssim": (total_ssim / ssim_count) if ssim_count > 0 else None,
        "bicubic_psnr": total_bicubic_psnr / count,
    }


def train_one_epoch(model, loader, optimizer, criterion, device, grad_clip_norm=1.0):
    model.train()
    running_loss = 0.0
    valid_batches = 0
    skipped_batches = 0

    for lr_seq, hr_seq, _ in tqdm(loader, desc="Train", leave=False):
        lr_seq = lr_seq.to(device, non_blocking=True)
        hr_seq = hr_seq.to(device, non_blocking=True)
        if not torch.isfinite(lr_seq).all() or not torch.isfinite(hr_seq).all():
            skipped_batches += 1
            continue

        optimizer.zero_grad(set_to_none=True)
        pred = model(lr_seq)
        if not torch.isfinite(pred).all():
            skipped_batches += 1
            continue
        loss = criterion(pred, hr_seq)
        if not torch.isfinite(loss):
            skipped_batches += 1
            continue

        loss.backward()
        if grad_clip_norm is not None:
            torch.nn.utils.clip_grad_norm_(model.parameters(), grad_clip_norm)
        optimizer.step()

        running_loss += loss.item()
        valid_batches += 1

    if skipped_batches > 0:
        print(f"Skipped {skipped_batches} non-finite train batches")
    return running_loss / valid_batches if valid_batches > 0 else float("nan")


# ── main ─────────────────────────────────────────────────────────────────────


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--v3-splits",
        default="vsr_workspace/experiments/model_v3_seq15/splits",
        help="V3 processed splits (read-only; hr_frames are symlinked from here)",
    )
    parser.add_argument(
        "--workspace",
        default="vsr_workspace/experiments/model_v4_finetune_youtube",
        help="V4 output root for splits, checkpoints, and logs (created fresh)",
    )
    parser.add_argument(
        "--init-weights",
        default="vsr_workspace/experiments/model_v3_seq15/checkpoints/vsr_model_best_psnr.pth",
        help="V3 checkpoint to fine-tune from (weights-only state_dict works)",
    )
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--lr", type=float, default=2.5e-5, help="Fine-tune LR (V3 trained at 2e-4)")
    parser.add_argument("--seq-len", type=int, default=15)
    parser.add_argument("--patch-size", type=int, default=64)
    parser.add_argument("--scale", type=int, default=4)
    parser.add_argument("--variants", type=int, default=2, help="Codec-degraded variants per train clip")
    parser.add_argument("--replay-ratio", type=float, default=0.25, help="Fraction of train data using old V3 LR")
    parser.add_argument("--num-workers", type=int, default=8)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-clips", type=int, default=None, help="Subset of train clips (smoke tests)")
    parser.add_argument("--data-only", action="store_true", help="Build the V4 splits and exit (no training)")
    parser.add_argument(
        "--unfreeze-spynet",
        action="store_true",
        help="Also fine-tune SPyNet at lr*0.1 (default: frozen — cheapest forgetting insurance)",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
        torch.backends.cudnn.benchmark = True

    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg not found on PATH — required for codec degradation.")

    workspace = Path(args.workspace).resolve()
    save_dir = workspace / "checkpoints"
    logs_dir = workspace / "logs"
    save_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    v4_splits = build_v4_splits(args)
    if args.data_only:
        print("Data build complete (--data-only). Inspect lr_frames before training.")
        return

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print("device:", device)

    g = torch.Generator()
    g.manual_seed(args.seed)
    train_dataset = CustomVideoDataset(
        v4_splits / "train", seq_len=args.seq_len, patch_size=args.patch_size, training=True, scale=args.scale
    )
    val_codec_dataset = CustomVideoDataset(
        v4_splits / "val_codec", seq_len=args.seq_len, patch_size=args.patch_size, training=False, scale=args.scale
    )
    val_old_dataset = CustomVideoDataset(
        v4_splits / "val_old", seq_len=args.seq_len, patch_size=args.patch_size, training=False, scale=args.scale
    )
    train_loader = make_loader(train_dataset, args.batch_size, shuffle=True, args=args, generator=g)
    val_codec_loader = make_loader(val_codec_dataset, 1, shuffle=False, args=args)
    val_old_loader = make_loader(val_old_dataset, 1, shuffle=False, args=args)

    model = BasicVSRRecurrentSeq(
        seq_len=args.seq_len, scale=args.scale, num_feats=64, num_extract_blocks=5, num_prop_blocks=20, num_recon_blocks=5
    )
    init_weights = Path(args.init_weights).resolve()
    if not init_weights.exists():
        sys.exit(f"Init checkpoint not found: {init_weights}")
    state_dict = torch.load(init_weights, map_location="cpu")
    if "model_state_dict" in state_dict:
        state_dict = state_dict["model_state_dict"]
    model.load_state_dict(state_dict)
    model.to(device)
    print(f"Loaded V3 weights from {init_weights}")

    if args.unfreeze_spynet:
        spynet_params = list(model.flow_estimator.parameters())
        spynet_ids = {id(p) for p in spynet_params}
        other_params = [p for p in model.parameters() if id(p) not in spynet_ids]
        optimizer = optim.AdamW(
            [{"params": other_params, "lr": args.lr}, {"params": spynet_params, "lr": args.lr * 0.1}],
            weight_decay=1e-4,
        )
        print(f"SPyNet UNFROZEN at lr {args.lr * 0.1:.2e}")
    else:
        model.flow_estimator.requires_grad_(False)
        trainable = [p for p in model.parameters() if p.requires_grad]
        optimizer = optim.AdamW(trainable, lr=args.lr, weight_decay=1e-4)
        print("SPyNet frozen")

    criterion = CombinedRestorationLoss(charbonnier_weight=1.0, edge_weight=0.05, perceptual_weight=0.1).to(device)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=3, min_lr=1e-6)

    best_path = save_dir / "vsr_model_v4_best_combined.pth"
    best_codec_psnr_path = save_dir / "vsr_model_v4_best_codec_psnr.pth"
    last_path = save_dir / "vsr_model_v4_last.pth"
    state_path = save_dir / "training_state.pth"
    history_path = logs_dir / "history.json"

    history = {
        "train_loss": [],
        "val_old_loss": [],
        "val_old_psnr": [],
        "val_old_ssim": [],
        "val_codec_loss": [],
        "val_codec_psnr": [],
        "val_codec_ssim": [],
        "val_codec_bicubic_psnr": [],
        "combined_loss": [],
        "lr": [],
    }
    start_epoch = 0
    best_combined = float("inf")
    best_codec_psnr = -float("inf")
    baseline = None

    if state_path.exists():
        print(f"Resuming from {state_path}")
        state = torch.load(state_path, map_location=device)
        model.load_state_dict(state["model_state_dict"])
        optimizer.load_state_dict(state["optimizer_state_dict"])
        scheduler.load_state_dict(state["scheduler_state_dict"])
        start_epoch = int(state["epoch_completed"])
        best_combined = float(state["best_combined"])
        best_codec_psnr = float(state["best_codec_psnr"])
        history = state["history"]
        baseline = state.get("baseline")

    if baseline is None:
        # Baseline: the untouched V3 checkpoint on both val sets. The whole point
        # of fine-tuning is codec-psnr going up while old-psnr stays put.
        print("Evaluating V3 baseline on both val sets...")
        base_old = evaluate_model(model, val_old_loader, criterion, device, scale=args.scale, shave_border=args.scale)
        base_codec = evaluate_model(model, val_codec_loader, criterion, device, scale=args.scale, shave_border=args.scale)
        baseline = {"old": base_old, "codec": base_codec}
        print(
            f"  baseline old: psnr={base_old['psnr']:.2f} loss={base_old['loss']:.4f} | "
            f"codec: psnr={base_codec['psnr']:.2f} (bicubic {base_codec['bicubic_psnr']:.2f}) loss={base_codec['loss']:.4f}"
        )

    for epoch in range(start_epoch, args.epochs):
        current_epoch = epoch + 1
        current_lr = optimizer.param_groups[0]["lr"]

        train_loss = train_one_epoch(model, train_loader, optimizer, criterion, device, grad_clip_norm=1.0)
        val_old = evaluate_model(model, val_old_loader, criterion, device, scale=args.scale, shave_border=args.scale)
        val_codec = evaluate_model(model, val_codec_loader, criterion, device, scale=args.scale, shave_border=args.scale)
        combined = 0.5 * (val_old["loss"] + val_codec["loss"])

        history["train_loss"].append(train_loss)
        history["val_old_loss"].append(val_old["loss"])
        history["val_old_psnr"].append(val_old["psnr"])
        history["val_old_ssim"].append(val_old["ssim"])
        history["val_codec_loss"].append(val_codec["loss"])
        history["val_codec_psnr"].append(val_codec["psnr"])
        history["val_codec_ssim"].append(val_codec["ssim"])
        history["val_codec_bicubic_psnr"].append(val_codec["bicubic_psnr"])
        history["combined_loss"].append(combined)
        history["lr"].append(current_lr)

        old_drop = baseline["old"]["psnr"] - val_old["psnr"]
        print(
            f"Epoch {current_epoch:03d}/{args.epochs} | lr={current_lr:.2e} | train={train_loss:.4f} | "
            f"old: psnr={val_old['psnr']:.2f} ({-old_drop:+.2f} vs V3) | "
            f"codec: psnr={val_codec['psnr']:.2f} ({val_codec['psnr'] - baseline['codec']['psnr']:+.2f} vs V3) | "
            f"combined={combined:.4f}",
            flush=True,
        )
        if old_drop > 0.3:
            print(f"  WARNING: old-val PSNR dropped {old_drop:.2f} dB vs V3 — forgetting; consider more replay / lower lr")

        if not math.isfinite(train_loss) or not math.isfinite(combined):
            print(f"Non-finite metric at epoch {current_epoch}. Stopping.")
            break

        scheduler.step(combined)

        if combined < best_combined:
            best_combined = combined
            torch.save(model.state_dict(), best_path)
            print(f"  saved best-combined -> {best_path.name}")
        if val_codec["psnr"] > best_codec_psnr:
            best_codec_psnr = val_codec["psnr"]
            torch.save(model.state_dict(), best_codec_psnr_path)
            print(f"  saved best-codec-psnr -> {best_codec_psnr_path.name}")
        torch.save(model.state_dict(), last_path)

        torch.save(
            {
                "epoch_completed": current_epoch,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "scheduler_state_dict": scheduler.state_dict(),
                "best_combined": best_combined,
                "best_codec_psnr": best_codec_psnr,
                "history": history,
                "baseline": baseline,
                "config": vars(args),
            },
            state_path,
        )
        with open(history_path, "w") as f:
            json.dump({"baseline": baseline, "history": history}, f, indent=2)

        if current_epoch % 5 == 0:
            torch.save(model.state_dict(), save_dir / f"epoch_{current_epoch:03d}.pth")

    print(f"\nDone. Best combined val loss: {best_combined:.4f}, best codec PSNR: {best_codec_psnr:.2f}")
    print(f"Deploy candidate: {best_path}")
    print("To use in the app: copy it to apps/ai/checkpoints/ and point CHECKPOINT_PATH at it.")


if __name__ == "__main__":
    main()
