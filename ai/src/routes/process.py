import logging
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException

from src.models.job import JobStatus, ProcessRequest, ProcessResponse
from src.services.job_manager import job_manager
from src.services.pipeline import start_pipeline

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/process", response_model=ProcessResponse)
async def start_processing(
    request: ProcessRequest,
    background_tasks: BackgroundTasks,
) -> ProcessResponse:
    """Start processing a video file.

    The backend sends the job_id and the absolute path to the uploaded video.
    Processing runs in the background.
    """
    # Validate input file exists
    input_path = Path(request.input_path)
    if not input_path.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Input file not found: {request.input_path}",
        )

    # Check if job already exists
    existing = job_manager.get_job(request.job_id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Job {request.job_id} already exists",
        )

    # Create the job
    job = job_manager.create_job(
        job_id=request.job_id,
        input_path=request.input_path,
        upscale_factor=request.upscale_factor,
    )

    # Start processing in the background
    background_tasks.add_task(
        start_pipeline,
        job_id=request.job_id,
        input_path=request.input_path,
        upscale_factor=request.upscale_factor,
    )

    logger.info(f"Job {request.job_id} queued for processing")

    return ProcessResponse(
        job_id=job.job_id,
        status=job.status,
    )


@router.get("/status/{job_id}")
async def get_job_status(job_id: str) -> dict:
    """Get the current status and progress of a processing job."""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    return job.model_dump(mode="json")
