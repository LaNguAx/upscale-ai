"""Video reconstruction from enhanced frames using ffmpeg."""

import logging
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


def find_ffmpeg() -> str:
    """Find the ffmpeg binary path."""
    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path:
        return ffmpeg_path

    # Common Windows installation paths (including winget installs)
    import glob

    common_paths = [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
    ]

    # Search winget installation directory
    winget_pattern = str(
        Path.home()
        / "AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg*/ffmpeg*/bin/ffmpeg.exe"
    )
    winget_matches = glob.glob(winget_pattern)
    common_paths.extend(winget_matches)
    for path in common_paths:
        if Path(path).exists():
            return path

    raise FileNotFoundError(
        "ffmpeg not found. Please install ffmpeg and ensure it is on your PATH. "
        "On Windows: winget install Gyan.FFmpeg or choco install ffmpeg"
    )


def reconstruct_video(
    frame_paths: list[str],
    output_path: str,
    fps: float = 30.0,
) -> str:
    """Reconstruct a video from a sequence of enhanced frames using ffmpeg.

    Uses ffmpeg to produce an H.264 MP4 file that plays in all modern browsers.

    Args:
        frame_paths: Ordered list of enhanced frame file paths.
        output_path: Path for the output video file.
        fps: Frame rate for the output video.

    Returns:
        The output video file path.

    Raises:
        FileNotFoundError: If ffmpeg is not available.
        RuntimeError: If ffmpeg encoding fails.
    """
    if not frame_paths:
        raise ValueError("No frames provided for reconstruction")

    ffmpeg_bin = find_ffmpeg()
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    # ffmpeg expects a pattern like frame_%06d.png
    # All our enhanced frames follow the pattern enhanced_XXXXXX.png
    frame_dir = str(Path(frame_paths[0]).parent)
    frame_pattern = str(Path(frame_dir) / "enhanced_%06d.png")

    cmd = [
        ffmpeg_bin,
        "-y",  # Overwrite output
        "-framerate", str(fps),
        "-i", frame_pattern,
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",  # High quality
        "-pix_fmt", "yuv420p",  # Browser compatibility
        "-movflags", "+faststart",  # Progressive loading
        str(output),
    ]

    logger.info(f"Reconstructing video: {' '.join(cmd)}")

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=600,  # 10 minute timeout
    )

    if result.returncode != 0:
        error_msg = result.stderr[-500:] if result.stderr else "Unknown ffmpeg error"
        raise RuntimeError(f"ffmpeg failed (code {result.returncode}): {error_msg}")

    logger.info(f"Video reconstructed: {output_path}")
    return str(output)
