import threading
from datetime import datetime, timezone
from typing import Optional

from src.config import settings
from src.models.job import JobState, JobStatus


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, JobState] = {}
        self._lock = threading.Lock()
        self._semaphore = threading.Semaphore(settings.max_concurrent_jobs)

    def create_job(self, job_id: str, input_path: str, upscale_factor: int = 2) -> JobState:
        with self._lock:
            job = JobState(
                job_id=job_id,
                input_path=input_path,
                upscale_factor=upscale_factor,
            )
            self._jobs[job_id] = job
            return job.model_copy()

    def get_job(self, job_id: str) -> Optional[JobState]:
        with self._lock:
            job = self._jobs.get(job_id)
            return job.model_copy() if job else None

    def get_all_jobs(self) -> list[JobState]:
        with self._lock:
            return [job.model_copy() for job in self._jobs.values()]

    def update_status(self, job_id: str, status: JobStatus) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = status
                job.updated_at = datetime.now(timezone.utc)

    def update_progress(
        self,
        job_id: str,
        progress: int,
        processed_frames: int = 0,
        total_frames: int = 0,
    ) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.progress = min(progress, 100)
                if processed_frames:
                    job.processed_frames = processed_frames
                if total_frames:
                    job.total_frames = total_frames
                job.updated_at = datetime.now(timezone.utc)

    def complete_job(self, job_id: str, output_path: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.COMPLETED
                job.progress = 100
                job.output_path = output_path
                job.updated_at = datetime.now(timezone.utc)

    def fail_job(self, job_id: str, error: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = JobStatus.FAILED
                job.error = error
                job.updated_at = datetime.now(timezone.utc)

    def acquire_slot(self) -> bool:
        return self._semaphore.acquire(blocking=False)

    def release_slot(self) -> None:
        self._semaphore.release()


job_manager = JobManager()
