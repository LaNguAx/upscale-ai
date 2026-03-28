"""Video processing pipeline orchestrator."""

import asyncio
import logging
import shutil
from pathlib import Path

from src.config import settings
from src.services.frame_extractor import extract_frames
from src.services.frame_processor import process_all_frames
from src.services.job_manager import job_manager
from src.models.job import JobStatus

logger = logging.getLogger(__name__)


def _run_pipeline(job_id: str, input_path: str, upscale_factor: int) -> None:
    """Execute the full video processing pipeline synchronously.

    This runs in a background thread. It:
    1. Extracts frames from the input video (0-10% progress)
    2. Processes frames through the model stub (10-90% progress)
    3. Reconstructs the output video (90-100% progress)
    """
    job_temp_dir = str(Path(settings.get_temp_path()) / job_id)
    frames_dir = str(Path(job_temp_dir) / "input_frames")
    enhanced_dir = str(Path(job_temp_dir) / "enhanced_frames")

    try:
        # Acquire a processing slot (limits concurrency)
        if not job_manager.acquire_slot():
            # Wait for a slot to become available
            job_manager._semaphore.acquire(blocking=True)

        job_manager.update_status(job_id, JobStatus.PROCESSING)
        job_manager.update_progress(job_id, 1)

        # Step 1: Extract frames (0-10%)
        logger.info(f"[{job_id}] Extracting frames from {input_path}")
        frame_paths, metadata = extract_frames(input_path, frames_dir)
        total_frames = len(frame_paths)

        job_manager.update_progress(
            job_id,
            progress=10,
            total_frames=total_frames,
        )

        logger.info(
            f"[{job_id}] Extracted {total_frames} frames "
            f"({metadata.width}x{metadata.height} @ {metadata.fps:.1f}fps)"
        )

        # Step 2: Process frames (10-90%)
        def on_frame_progress(processed: int, total: int) -> None:
            pct = 10 + int((processed / total) * 80)
            job_manager.update_progress(
                job_id,
                progress=pct,
                processed_frames=processed,
                total_frames=total,
            )

        logger.info(f"[{job_id}] Processing frames with {upscale_factor}x upscale")
        enhanced_paths = process_all_frames(
            frame_paths=frame_paths,
            output_dir=enhanced_dir,
            upscale_factor=upscale_factor,
            window_size=settings.temporal_window_size,
            on_progress=on_frame_progress,
        )

        job_manager.update_progress(job_id, progress=90)

        # Step 3: Reconstruct video (90-100%)
        output_filename = f"{job_id}.mp4"
        output_path = str(Path(settings.get_result_path()) / output_filename)

        logger.info(f"[{job_id}] Reconstructing video to {output_path}")

        from src.services.video_reconstructor import reconstruct_video

        reconstruct_video(
            frame_paths=enhanced_paths,
            output_path=output_path,
            fps=metadata.fps,
        )

        # Done
        job_manager.complete_job(job_id, output_path)
        logger.info(f"[{job_id}] Processing complete: {output_path}")

    except Exception as e:
        logger.exception(f"[{job_id}] Pipeline failed: {e}")
        job_manager.fail_job(job_id, str(e))

    finally:
        job_manager.release_slot()

        # Cleanup temp directory
        try:
            if Path(job_temp_dir).exists():
                shutil.rmtree(job_temp_dir)
                logger.info(f"[{job_id}] Cleaned up temp directory")
        except Exception as cleanup_err:
            logger.warning(f"[{job_id}] Failed to cleanup temp: {cleanup_err}")


async def start_pipeline(job_id: str, input_path: str, upscale_factor: int) -> None:
    """Start the processing pipeline in a background thread."""
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _run_pipeline, job_id, input_path, upscale_factor)
