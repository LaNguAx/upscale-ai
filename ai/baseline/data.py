"""Video data sourcing, split planning, and frame extraction."""

import cv2
import urllib.request
from pathlib import Path

from .config import SPLIT_ROOT, RAW_VIDEO_DIR, FRAMES_PER_CLIP, SCALE

# --- Public video sources for training data ---
VIDEO_SOURCES = {
    "tears": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
    "bunny": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "sintel": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
    "dream": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
}

# Each source video belongs to exactly one split (no data leakage)
# Format: (split, video_key, clip_name, start_ms)
SPLIT_PLAN = [
    # TRAIN
    ("train", "tears", "clip1", 60000),
    ("train", "tears", "clip2", 180000),
    ("train", "tears", "clip3", 300000),
    ("train", "bunny", "clip1", 30000),
    ("train", "bunny", "clip2", 120000),
    # VAL
    ("val", "dream", "clip1", 20000),
    ("val", "dream", "clip2", 120000),
    # TEST
    ("test", "sintel", "clip1", 20000),
    ("test", "sintel", "clip2", 120000),
]


def make_clip_name(video_key: str, clip_name: str) -> str:
    return f"{video_key}_{clip_name}"


def download_videos(raw_video_dir: Path = RAW_VIDEO_DIR) -> None:
    """Download all source videos if they don't already exist."""
    raw_video_dir.mkdir(parents=True, exist_ok=True)
    for name, url in VIDEO_SOURCES.items():
        out_path = raw_video_dir / f"{name}.mp4"
        if not out_path.exists():
            print(f"Downloading {name}...")
            urllib.request.urlretrieve(url, out_path)
        else:
            print(f"Exists: {out_path}")
    print("All videos ready.")


def create_split_directories(split_root: Path = SPLIT_ROOT) -> None:
    """Create HR/LR frame directories for each clip in the split plan."""
    for split, video_key, clip_name, _ in SPLIT_PLAN:
        clip_dir = split_root / split / make_clip_name(video_key, clip_name)
        (clip_dir / "hr_frames").mkdir(parents=True, exist_ok=True)
        (clip_dir / "lr_frames").mkdir(parents=True, exist_ok=True)
    print("Split directories created.")


def delete_old_frames(split_root: Path = SPLIT_ROOT) -> int:
    """Delete all existing .png frames from the split directories."""
    deleted = 0
    for p in split_root.rglob("*.png"):
        p.unlink()
        deleted += 1
    print(f"Deleted {deleted} old frame files.")
    return deleted


def extract_segment(
    video_path: Path,
    start_ms: int,
    split_name: str,
    clip_name: str,
    num_frames: int = FRAMES_PER_CLIP,
    scale: int = SCALE,
    split_root: Path = SPLIT_ROOT,
) -> int:
    """Extract HR frames from a video segment and generate LR versions."""
    cap = cv2.VideoCapture(str(video_path))
    cap.set(cv2.CAP_PROP_POS_MSEC, start_ms)

    hr_dir = split_root / split_name / clip_name / "hr_frames"
    lr_dir = split_root / split_name / clip_name / "lr_frames"

    count = 0
    while count < num_frames:
        ret, frame = cap.read()
        if not ret:
            break

        cv2.imwrite(str(hr_dir / f"{count:04d}.png"), frame)

        lr_frame = cv2.resize(
            frame,
            (frame.shape[1] // scale, frame.shape[0] // scale),
            interpolation=cv2.INTER_CUBIC,
        )
        cv2.imwrite(str(lr_dir / f"{count:04d}.png"), lr_frame)

        count += 1

    cap.release()
    print(f"Finished {split_name}/{clip_name} from {video_path.name} with {count} frames")
    return count


def extract_all_segments(
    raw_video_dir: Path = RAW_VIDEO_DIR,
    split_root: Path = SPLIT_ROOT,
    num_frames: int = FRAMES_PER_CLIP,
    scale: int = SCALE,
) -> None:
    """Run frame extraction for all clips in the split plan."""
    for split_name, video_key, short_clip_name, start_ms in SPLIT_PLAN:
        clip_name = make_clip_name(video_key, short_clip_name)
        extract_segment(
            raw_video_dir / f"{video_key}.mp4",
            start_ms,
            split_name,
            clip_name,
            num_frames=num_frames,
            scale=scale,
            split_root=split_root,
        )


def print_split_stats(split_root: Path = SPLIT_ROOT) -> None:
    """Print frame counts per split."""
    for split in ["train", "val", "test"]:
        hr_count = len(list((split_root / split).rglob("hr_frames/*.png")))
        lr_count = len(list((split_root / split).rglob("lr_frames/*.png")))
        print(f"{split} — HR: {hr_count}, LR: {lr_count}")
