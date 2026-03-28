from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class FrameMetadata(BaseModel):
    fps: float
    total_frames: int
    width: int
    height: int
    codec: str = ""


class JobState(BaseModel):
    job_id: str
    status: JobStatus = JobStatus.QUEUED
    progress: int = 0
    input_path: str
    output_path: Optional[str] = None
    upscale_factor: int = 2
    total_frames: int = 0
    processed_frames: int = 0
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ProcessRequest(BaseModel):
    job_id: str
    input_path: str
    upscale_factor: int = 2


class ProcessResponse(BaseModel):
    job_id: str
    status: JobStatus
