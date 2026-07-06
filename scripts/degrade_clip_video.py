#!/usr/bin/env python3
"""YouTube-style per-clip degradation for x4 video super-resolution.

Unlike the original training pipeline (`realistic_degrade_frame` in
Model_v3.ipynb / scripts/create_degraded_demo.py), which re-samples degradation
parameters independently for every frame and only models JPEG compression, this
pipeline samples ALL parameters ONCE PER CLIP and ends with a real H.264
encode/decode round-trip of the whole LR clip — producing the macroblocking,
mosquito noise, and temporally correlated artifacts of real YouTube videos.

Per-clip pipeline (each step applied identically to every frame):
  1. Gaussian blur     p=0.70  k in {3,5,7}, sigma ~ U(0.4, 2.0)
  2. Motion blur       p=0.15  horizontal, ksize in {5,7}
  3. Gaussian noise    p=0.50  std ~ U(1, 8)  (per-clip std, fresh noise per frame)
  4. JPEG              p=0.15  quality ~ U{50..85}  (light intra-frame variety)
  5. Downscale x4      always  interpolation in {area, bilinear, bicubic}
  6. H.264 encode @ LR always  libx264, CRF ~ U{23..38}, preset in {veryfast, medium}
  7. Second encode     p=0.30  CRF ~ U{28..40}  (simulates upload -> YouTube re-encode)

The codec round-trip goes PNG frames -> ffmpeg -> PNG frames with NO lossy
intermediate (the mp4v VideoWriter used by create_degraded_demo.py would add
uncontrolled compression on top of the sampled CRF, so it is not used here).

Usage (standalone):
  # Degrade a video file (writes demo/degraded/<stem>_youtube_lr.mp4):
  python scripts/degrade_clip_video.py demo/input/demo3.mp4 --preview

  # Degrade a directory of HR PNG frames (REDS sequence or a processed clip
  # dir containing hr_frames/); writes <out>/hr_frames + <out>/lr_frames[,_2..]:
  python scripts/degrade_clip_video.py path/to/sequence --variants 2 --out path/to/clip_x4

This module is also imported by scripts/finetune_v4_youtube.py to build the
fine-tuning dataset — keep the sampling ranges in sync with that script's docs.

Requires ffmpeg on PATH and the apps/ai Python environment (opencv-python,
numpy) — see `pnpm --filter ai run setup`.
"""

import argparse
import random
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent
DEGRADED_DIR = REPO_ROOT / "demo" / "degraded"

INTERPOLATIONS = {
    "area": cv2.INTER_AREA,
    "bilinear": cv2.INTER_LINEAR,
    "bicubic": cv2.INTER_CUBIC,
}


@dataclass(frozen=True)
class ClipDegradationParams:
    gaussian_blur: "tuple[int, float] | None"  # (ksize, sigma)
    motion_blur_ksize: "int | None"
    noise_std: "float | None"
    jpeg_quality: "int | None"
    downscale_interp: str
    crf: int
    preset: str
    second_crf: "int | None"

    def describe(self) -> str:
        parts = []
        if self.gaussian_blur is not None:
            k, sigma = self.gaussian_blur
            parts.append(f"blur(k={k},sigma={sigma:.2f})")
        if self.motion_blur_ksize is not None:
            parts.append(f"motion(k={self.motion_blur_ksize})")
        if self.noise_std is not None:
            parts.append(f"noise(std={self.noise_std:.1f})")
        if self.jpeg_quality is not None:
            parts.append(f"jpeg(q={self.jpeg_quality})")
        parts.append(f"resize({self.downscale_interp})")
        parts.append(f"h264(crf={self.crf},preset={self.preset})")
        if self.second_crf is not None:
            parts.append(f"h264-2nd(crf={self.second_crf})")
        return " -> ".join(parts)


def sample_clip_params(rng: random.Random) -> ClipDegradationParams:
    """Sample one set of degradation parameters, shared by every frame of a clip."""
    return ClipDegradationParams(
        gaussian_blur=(
            (rng.choice([3, 5, 7]), rng.uniform(0.4, 2.0)) if rng.random() < 0.7 else None
        ),
        motion_blur_ksize=rng.choice([5, 7]) if rng.random() < 0.15 else None,
        noise_std=rng.uniform(1.0, 8.0) if rng.random() < 0.5 else None,
        jpeg_quality=rng.randint(50, 85) if rng.random() < 0.15 else None,
        downscale_interp=rng.choice(["area", "bilinear", "bicubic"]),
        crf=rng.randint(23, 38),
        preset=rng.choice(["veryfast", "medium"]),
        second_crf=rng.randint(28, 40) if rng.random() < 0.3 else None,
    )


def apply_motion_blur(img_bgr, ksize=9):
    kernel = np.zeros((ksize, ksize), dtype=np.float32)
    kernel[ksize // 2, :] = 1.0
    kernel /= kernel.sum()
    return cv2.filter2D(img_bgr, -1, kernel)


def apply_jpeg_compression(img_bgr, quality=50):
    encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)]
    success, enc = cv2.imencode(".jpg", img_bgr, encode_param)
    if not success:
        return img_bgr
    return cv2.imdecode(enc, cv2.IMREAD_COLOR)


def crop_to_multiple(frame_bgr, multiple: int):
    """Crop so both dims are divisible by `multiple` (top-left anchored).

    HR frames are cropped to a multiple of scale*2 so the x4-downscaled LR has
    even dimensions, as required by yuv420p H.264 encoding.
    """
    h, w = frame_bgr.shape[:2]
    new_h = (h // multiple) * multiple
    new_w = (w // multiple) * multiple
    if new_h == 0 or new_w == 0:
        raise ValueError(f"Frame {w}x{h} too small to crop to a multiple of {multiple}")
    if new_h == h and new_w == w:
        return frame_bgr
    return frame_bgr[:new_h, :new_w]


def degrade_frame_pre_codec(
    frame_bgr, params: ClipDegradationParams, scale: int, np_rng: np.random.Generator
):
    """Blur/noise/JPEG + downscale for one frame, with fixed per-clip params.

    Noise std is per-clip but the noise realization is fresh per frame,
    matching how sensor noise behaves in real video.
    """
    out = frame_bgr

    if params.gaussian_blur is not None:
        k, sigma = params.gaussian_blur
        out = cv2.GaussianBlur(out, (k, k), sigma)

    if params.motion_blur_ksize is not None:
        out = apply_motion_blur(out, ksize=params.motion_blur_ksize)

    if params.noise_std is not None:
        noise = np_rng.normal(0.0, params.noise_std, out.shape).astype(np.float32)
        out = np.clip(out.astype(np.float32) + noise, 0, 255).astype(np.uint8)

    if params.jpeg_quality is not None:
        out = apply_jpeg_compression(out, quality=params.jpeg_quality)

    h, w = out.shape[:2]
    interp = INTERPOLATIONS[params.downscale_interp]
    return cv2.resize(out, (w // scale, h // scale), interpolation=interp)


def run_ffmpeg(args: "list[str]") -> None:
    command = ["ffmpeg", "-y", "-loglevel", "error", *args]
    subprocess.run(command, check=True)


def encode_h264(frames_dir: Path, dest: Path, fps: float, crf: int, preset: str) -> None:
    run_ffmpeg(
        [
            "-framerate",
            f"{fps}",
            "-i",
            str(frames_dir / "%05d.png"),
            "-c:v",
            "libx264",
            "-crf",
            str(crf),
            "-preset",
            preset,
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(dest),
        ]
    )


def reencode_h264(src: Path, dest: Path, crf: int, preset: str) -> None:
    run_ffmpeg(
        [
            "-i",
            str(src),
            "-an",
            "-c:v",
            "libx264",
            "-crf",
            str(crf),
            "-preset",
            preset,
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(dest),
        ]
    )


def read_video_frames(path: Path) -> "list[np.ndarray]":
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open video: {path}")
    frames = []
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frames.append(frame)
    cap.release()
    return frames


def encode_lr_clip(
    lr_frames: "list[np.ndarray]", params: ClipDegradationParams, fps: float, dest: Path
) -> None:
    """Encode pre-codec LR frames to the final degraded H.264 clip at `dest`."""
    with tempfile.TemporaryDirectory(prefix="yt_degrade_") as tmp:
        tmp_dir = Path(tmp)
        src_dir = tmp_dir / "src"
        src_dir.mkdir()
        for i, frame in enumerate(lr_frames):
            cv2.imwrite(str(src_dir / f"{i:05d}.png"), frame)

        first_pass = tmp_dir / "pass1.mp4" if params.second_crf is not None else dest
        encode_h264(src_dir, first_pass, fps=fps, crf=params.crf, preset=params.preset)
        if params.second_crf is not None:
            reencode_h264(first_pass, dest, crf=params.second_crf, preset=params.preset)


def youtube_degrade_clip(
    hr_frames: "list[np.ndarray]",
    scale: int,
    rng: random.Random,
    np_rng: np.random.Generator,
    fps: float = 24.0,
) -> "tuple[list[np.ndarray], list[np.ndarray], ClipDegradationParams]":
    """Degrade one clip of HR BGR frames into codec-compressed LR frames.

    Returns (cropped_hr_frames, lr_frames, params). HR frames are cropped to a
    multiple of scale*2 (usually a no-op for REDS 1280x720) — save the returned
    HR frames, not the originals, so LR/HR stay aligned.
    """
    if len(hr_frames) == 0:
        raise ValueError("Empty clip")

    params = sample_clip_params(rng)
    hr_out = [crop_to_multiple(f, scale * 2) for f in hr_frames]
    lr_pre = [degrade_frame_pre_codec(f, params, scale, np_rng) for f in hr_out]

    with tempfile.TemporaryDirectory(prefix="yt_degrade_") as tmp:
        encoded = Path(tmp) / "clip.mp4"
        encode_lr_clip(lr_pre, params, fps=fps, dest=encoded)
        lr_frames = read_video_frames(encoded)

    if len(lr_frames) != len(hr_out):
        raise RuntimeError(
            f"Codec round-trip changed frame count: {len(hr_out)} -> {len(lr_frames)}"
        )
    return hr_out, lr_frames, params


# ── CLI ──────────────────────────────────────────────────────────────────────


def load_hr_frames_from_dir(input_dir: Path) -> "list[Path]":
    """Accept a raw frames dir (PNGs inside) or a processed clip dir (hr_frames/)."""
    hr_subdir = input_dir / "hr_frames"
    frames_dir = hr_subdir if hr_subdir.is_dir() else input_dir
    frame_paths = sorted(frames_dir.glob("*.png"))
    if len(frame_paths) == 0:
        sys.exit(f"No PNG frames found in {frames_dir}")
    return frame_paths


def degrade_frames_dir(input_dir: Path, out_dir: Path, args) -> None:
    rng = random.Random(args.seed)
    np_rng = np.random.default_rng(args.seed)

    frame_paths = load_hr_frames_from_dir(input_dir)
    hr_frames = []
    for p in frame_paths:
        frame = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if frame is None:
            print(f"Skipping unreadable frame: {p}")
            continue
        hr_frames.append(frame)

    for variant in range(1, args.variants + 1):
        lr_dirname = "lr_frames" if variant == 1 else f"lr_frames_{variant}"
        hr_out, lr_frames, params = youtube_degrade_clip(
            hr_frames, scale=args.scale, rng=rng, np_rng=np_rng, fps=args.fps
        )
        if variant == 1:
            hr_dir = out_dir / "hr_frames"
            hr_dir.mkdir(parents=True, exist_ok=True)
            for i, frame in enumerate(hr_out):
                cv2.imwrite(str(hr_dir / f"{i:04d}.png"), frame)
        lr_dir = out_dir / lr_dirname
        lr_dir.mkdir(parents=True, exist_ok=True)
        for i, frame in enumerate(lr_frames):
            cv2.imwrite(str(lr_dir / f"{i:04d}.png"), frame)
        print(f"{out_dir.name}/{lr_dirname}: {len(lr_frames)} frames | {params.describe()}")


def degrade_video_file(input_path: Path, args) -> None:
    rng = random.Random(args.seed)
    np_rng = np.random.default_rng(args.seed)

    hr_frames = read_video_frames(input_path)
    if len(hr_frames) == 0:
        sys.exit(f"Input video has no readable frames: {input_path}")
    cap = cv2.VideoCapture(str(input_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    cap.release()

    params = sample_clip_params(rng)
    hr_frames = [crop_to_multiple(f, args.scale * 2) for f in hr_frames]
    lr_frames = [degrade_frame_pre_codec(f, params, args.scale, np_rng) for f in hr_frames]

    DEGRADED_DIR.mkdir(parents=True, exist_ok=True)
    lr_path = DEGRADED_DIR / f"{input_path.stem}_youtube_lr.mp4"
    encode_lr_clip(lr_frames, params, fps=fps, dest=lr_path)
    print(f"Degraded {len(lr_frames)} frames | {params.describe()}")
    print(f"  Model input (degraded LR): {lr_path.relative_to(REPO_ROOT)}")

    if args.preview:
        preview_path = DEGRADED_DIR / f"{input_path.stem}_youtube_preview_x4.mp4"
        run_ffmpeg(
            [
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
        )
        print(f"  Visual preview (x4 NN):    {preview_path.relative_to(REPO_ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Create YouTube-style degraded LR data (per-clip params + real H.264 "
            "compression) from a video file or a directory of HR PNG frames."
        )
    )
    parser.add_argument("input", help="Input video file, or directory of HR PNG frames")
    parser.add_argument("--out", default=None, help="Output dir (directory mode only)")
    parser.add_argument("--scale", type=int, default=4, help="Downscale factor (default: 4)")
    parser.add_argument("--seed", type=int, default=None, help="Random seed")
    parser.add_argument(
        "--variants",
        type=int,
        default=1,
        help="Degraded variants per clip, directory mode only (default: 1)",
    )
    parser.add_argument(
        "--fps", type=float, default=24.0, help="Encode fps in directory mode (default: 24)"
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Also write a nearest-neighbor x4 preview (video mode only)",
    )
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg not found on PATH. Install ffmpeg and retry.")

    input_path = Path(args.input).resolve()
    if input_path.is_dir():
        out_dir = Path(args.out).resolve() if args.out else input_path.parent / (
            input_path.name + "_youtube_x4"
        )
        degrade_frames_dir(input_path, out_dir, args)
    elif input_path.is_file():
        degrade_video_file(input_path, args)
    else:
        sys.exit(f"Input not found: {input_path}")


if __name__ == "__main__":
    main()
