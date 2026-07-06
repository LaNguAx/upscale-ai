#!/usr/bin/env python3
"""Create a degraded LR demo video for x4 super-resolution, plus a nearest-neighbor
upscaled preview for visual comparison.

The degradation applied here is the exact per-frame pipeline used to build training
pairs in apps/ai/baseline/Model_v3.ipynb (`realistic_degrade_frame`), so the demo
input matches the degradation distribution the model was trained on: probabilistic
Gaussian blur, motion blur, additive Gaussian noise, and JPEG compression, applied at
full resolution, with the 4x downscale done last via INTER_AREA.

Requires ffmpeg on PATH (final H.264 encode) and the apps/ai Python environment
(opencv-python, numpy) — see `pnpm --filter ai run setup`.
"""

import argparse
import random
import shutil
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = REPO_ROOT / "demo" / "input" / "demo1.mp4"
DEGRADED_DIR = REPO_ROOT / "demo" / "degraded"


def apply_jpeg_compression(img_bgr, quality=50):
    encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)]
    success, enc = cv2.imencode(".jpg", img_bgr, encode_param)
    if not success:
        return img_bgr
    return cv2.imdecode(enc, cv2.IMREAD_COLOR)


def apply_motion_blur(img_bgr, ksize=9):
    kernel = np.zeros((ksize, ksize), dtype=np.float32)
    kernel[ksize // 2, :] = 1.0
    kernel /= kernel.sum()
    return cv2.filter2D(img_bgr, -1, kernel)


def realistic_degrade_frame(
    frame_bgr,
    scale=4,
    blur_prob=0.6,
    motion_blur_prob=0.15,
    noise_prob=0.6,
    jpeg_prob=0.6,
    min_jpeg_quality=35,
    max_jpeg_quality=75,
    min_noise_std=1.0,
    max_noise_std=10.0,
):
    """Verbatim port of the training-time degradation in Model_v3.ipynb (cell 4).

    Keep this in sync with the notebook — if the training degradation changes,
    update this function to match.
    """
    out = frame_bgr.copy()

    if random.random() < blur_prob:
        k = random.choice([3, 5])
        sigma = random.uniform(0.5, 1.6)
        out = cv2.GaussianBlur(out, (k, k), sigma)

    if random.random() < motion_blur_prob:
        ksize = random.choice([5, 7])
        out = apply_motion_blur(out, ksize=ksize)

    if random.random() < noise_prob:
        noise_std = random.uniform(min_noise_std, max_noise_std)
        noise = np.random.normal(0, noise_std, out.shape).astype(np.float32)
        out = np.clip(out.astype(np.float32) + noise, 0, 255).astype(np.uint8)

    if random.random() < jpeg_prob:
        quality = random.randint(min_jpeg_quality, max_jpeg_quality)
        out = apply_jpeg_compression(out, quality=quality)

    h, w = out.shape[:2]
    lr = cv2.resize(out, (w // scale, h // scale), interpolation=cv2.INTER_AREA)
    return lr


def build_output_paths(input_path: Path) -> tuple[Path, Path]:
    stem = input_path.stem
    lr_path = DEGRADED_DIR / f"{stem}_dirty_lr.mp4"
    preview_path = DEGRADED_DIR / f"{stem}_dirty_preview_x4.mp4"
    return lr_path, preview_path


def transcode_to_h264(src: Path, dest: Path) -> None:
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(dest),
    ]
    print(f"$ {' '.join(command)}")
    subprocess.run(command, check=True)


def degrade_video(input_path: Path, lr_path: Path, scale: int) -> None:
    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        sys.exit(f"Failed to open input video: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    ret, first_frame = cap.read()
    if not ret:
        sys.exit(f"Input video has no readable frames: {input_path}")
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    h, w = first_frame.shape[:2]
    lr_w, lr_h = w // scale, h // scale

    raw_path = lr_path.with_suffix(".raw.mp4")
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(raw_path), fourcc, fps, (lr_w, lr_h))
    if not writer.isOpened():
        cap.release()
        sys.exit(f"Failed to open VideoWriter for: {raw_path}")

    count = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        lr_frame = realistic_degrade_frame(frame, scale=scale)
        writer.write(lr_frame)
        count += 1
    cap.release()
    writer.release()
    print(f"Degraded {count} frames -> {raw_path.name}")

    transcode_to_h264(raw_path, lr_path)
    raw_path.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Create a degraded LR demo video for x4 super-resolution, using the "
            "same per-frame degradation pipeline as training (Model_v3.ipynb)."
        )
    )
    parser.add_argument(
        "input",
        nargs="?",
        default=str(DEFAULT_INPUT),
        help=f"Input (HR) video path (default: {DEFAULT_INPUT.relative_to(REPO_ROOT)})",
    )
    parser.add_argument(
        "--scale",
        type=int,
        default=4,
        help="Downscale factor, matching the model's SCALE (default: 4)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Optional random seed for reproducible degradation (training itself is unseeded)",
    )
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.is_file():
        sys.exit(f"Input video not found: {input_path}")

    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg not found on PATH. Install ffmpeg and retry.")

    if args.seed is not None:
        random.seed(args.seed)
        np.random.seed(args.seed)

    DEGRADED_DIR.mkdir(parents=True, exist_ok=True)
    lr_path, preview_path = build_output_paths(input_path)

    # Model input: same realistic_degrade_frame pipeline used to build training pairs.
    degrade_video(input_path, lr_path, scale=args.scale)

    # Visual-only preview: nearest-neighbor upscale the degraded LR back to x4, so
    # differences are inspectable without additional smoothing. Not part of the
    # training-time pipeline — display aid only.
    run_ffmpeg_preview = [
        "ffmpeg",
        "-y",
        "-i",
        str(lr_path),
        "-vf",
        f"scale=iw*{args.scale}:ih*{args.scale}:flags=neighbor",
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        str(preview_path),
    ]
    print(f"$ {' '.join(run_ffmpeg_preview)}")
    subprocess.run(run_ffmpeg_preview, check=True)

    print()
    print("Done.")
    print(f"  Model input (degraded LR):  {lr_path.relative_to(REPO_ROOT)}")
    print(f"  Visual preview (x4 NN):     {preview_path.relative_to(REPO_ROOT)}")
    print()
    print("Re-run with a different input:")
    print("  python scripts/create_degraded_demo.py path/to/video.mp4")


if __name__ == "__main__":
    main()
