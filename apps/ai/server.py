"""FastAPI AI service for video super-resolution inference (V3: BasicVSR + SPyNet).

Two backend transports are supported:
- ``/process``        path-based: backend sends absolute filesystem paths
                      (same machine or shared volume — local/dev).
- ``/process-upload`` remote: backend uploads the video over multipart HTTP and
                      later downloads the result from ``/result/{jobId}``
                      (two-server deployments with no shared storage).

All mutating/result endpoints (``/process``, ``/process-upload``, ``/result``,
``/cancel``) require ``Authorization: Bearer <AI_INTERNAL_TOKEN>`` when that
env var is set (a no-op for local dev when it is empty). Only ``/health`` stays
unauthenticated.
"""

import asyncio
import json
import logging
import os
import queue
import shutil
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import cv2
import numpy as np
import torch
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from baseline import VSRInferenceEngine, SEQ_LEN, SCALE, InferenceCancelledError
from security import (
    LATEST_FRAME_KEY,
    is_valid_job_id,
    resolve_preview_path,
    safe_extension,
    token_matches,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Configuration ---
CHECKPOINT_PATH = os.environ.get(
    "CHECKPOINT_PATH",
    str(Path(__file__).parent / "checkpoints" / "vsr_model_best.pth"),
)
DEVICE_NAME = os.environ.get("DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
DEVICE = torch.device(DEVICE_NAME)
MAX_INPUT_HEIGHT = int(os.environ.get("MAX_INPUT_HEIGHT", "480"))

# Shared secret for internal backend-to-AI calls. Empty disables auth (dev only).
AI_INTERNAL_TOKEN = os.environ.get("AI_INTERNAL_TOKEN", "")

UPLOAD_CHUNK_SIZE = 1024 * 1024


def _resolve_work_dir(env_value: str) -> Path:
    """Resolve a work directory; relative paths are anchored at this file's dir."""
    path = Path(env_value)
    if not path.is_absolute():
        path = Path(__file__).parent / path
    return path.resolve()


# Local working directories used by the remote (upload/download) transport.
WORK_UPLOAD_DIR = _resolve_work_dir(
    os.environ.get("WORK_UPLOAD_DIR", "../../storage/ai/uploads")
)
WORK_RESULT_DIR = _resolve_work_dir(
    os.environ.get("WORK_RESULT_DIR", "../../storage/ai/results")
)
WORK_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
WORK_RESULT_DIR.mkdir(parents=True, exist_ok=True)


def _env_flag(name: str, default: str = "true") -> bool:
    """Parse a boolean-ish env var ("false"/"0"/"no"/"off" disable)."""
    return os.environ.get(name, default).strip().lower() not in {"0", "false", "no", "off"}


# Progressive preview generation (sampled enhanced JPEG frames during inference).
PREVIEW_ENABLED = _env_flag("PREVIEW_ENABLED")
PREVIEW_EVERY_N_FRAMES = max(1, int(os.environ.get("PREVIEW_EVERY_N_FRAMES", "15")))
PREVIEW_MAX_WIDTH = int(os.environ.get("PREVIEW_MAX_WIDTH", "640"))
PREVIEW_JPEG_QUALITY = int(os.environ.get("PREVIEW_JPEG_QUALITY", "80"))
WORK_PREVIEW_DIR = _resolve_work_dir(
    os.environ.get("WORK_PREVIEW_DIR", "../../storage/ai/previews")
)
WORK_PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

# --- Global model state ---
engine: VSRInferenceEngine | None = None
model_loaded = False
active_cancellations: dict[str, threading.Event] = {}
active_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the model on startup."""
    global engine, model_loaded

    if os.path.exists(CHECKPOINT_PATH):
        logger.info(f"Loading V3 model from {CHECKPOINT_PATH} on {DEVICE}...")
        engine = VSRInferenceEngine(
            checkpoint_path=CHECKPOINT_PATH,
            device=DEVICE_NAME,
            seq_len=SEQ_LEN,
            scale=SCALE,
        )
        model_loaded = True
        params = sum(p.numel() for p in engine.model.parameters())
        logger.info(f"Model loaded ({params:,} parameters)")
    else:
        logger.warning(f"No checkpoint found at {CHECKPOINT_PATH} — model not loaded")
        engine = None
        model_loaded = False

    yield


app = FastAPI(title="Upscale AI Service", lifespan=lifespan)


class ProcessRequest(BaseModel):
    jobId: str
    inputPath: str
    outputPath: str
    scale: int = SCALE
    seqLen: int = SEQ_LEN
    simulateLq: bool = True
    maxFrames: int | None = None


class CancelRequest(BaseModel):
    jobId: str


# --- Security / validation helpers ---


def require_token(authorization: str | None = Header(default=None)) -> None:
    """Validate the internal bearer token when ``AI_INTERNAL_TOKEN`` is set.

    No-op when the token is empty (local dev). Uses a constant-time comparison
    and never logs or returns the token.
    """
    if not token_matches(authorization, AI_INTERNAL_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing internal token")


def validate_job_id(job_id: str) -> str:
    """Reject job ids that could be used for path traversal."""
    if not is_valid_job_id(job_id):
        raise HTTPException(status_code=400, detail="Invalid jobId")
    return job_id


def _ensure_model_ready() -> None:
    if not model_loaded or engine is None:
        raise HTTPException(status_code=503, detail="No model checkpoint loaded")


# --- Inference streaming (shared by /process and /process-upload) ---


def _write_preview_files(
    job_id: str, frame_index: int, frame_bgr: np.ndarray
) -> tuple[int, int] | None:
    """Write ``{frameIndex}.jpg`` and ``latest.jpg`` atomically.

    Downscales to ``PREVIEW_MAX_WIDTH`` (aspect preserved, never upscales) and
    returns the written (width, height), or ``None`` if encoding failed.
    """
    height, width = frame_bgr.shape[:2]
    if width > PREVIEW_MAX_WIDTH:
        scale = PREVIEW_MAX_WIDTH / width
        width = PREVIEW_MAX_WIDTH
        height = max(1, round(height * scale))
        frame_bgr = cv2.resize(frame_bgr, (width, height), interpolation=cv2.INTER_AREA)

    ok, encoded = cv2.imencode(
        ".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, PREVIEW_JPEG_QUALITY]
    )
    if not ok:
        return None

    job_dir = WORK_PREVIEW_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    data = encoded.tobytes()
    for name in (f"{frame_index}.jpg", f"{LATEST_FRAME_KEY}.jpg"):
        tmp_path = job_dir / f".{name}.tmp"
        tmp_path.write_bytes(data)
        os.replace(tmp_path, job_dir / name)
    return width, height


def run_inference_stream(
    job_id: str,
    input_path: str,
    output_path: str,
    result_download_url: str | None = None,
) -> StreamingResponse:
    """Run inference in a background thread and stream NDJSON progress lines.

    When ``result_download_url`` is provided (remote transport), it is attached
    to the terminal ``completed`` line so the backend knows where to fetch the
    enhanced file.
    """
    cancel_event = threading.Event()
    with active_lock:
        active_cancellations[job_id] = cancel_event

    progress_queue: queue.Queue[str | None] = queue.Queue()
    last_percent = [-1]

    def progress_callback(current_frame: int, total_frames: int) -> None:
        if total_frames <= 0:
            return
        percent = min(int((current_frame / total_frames) * 100), 100)
        if percent != last_percent[0]:
            last_percent[0] = percent
            line = json.dumps({
                "status": "processing",
                "progress": percent,
                "currentFrame": current_frame,
                "totalFrames": total_frames,
            })
            progress_queue.put(line)

    preview_active = PREVIEW_ENABLED and is_valid_job_id(job_id)

    def preview_callback(current_frame: int, total_frames: int, frame_bgr: np.ndarray) -> None:
        if current_frame != 1 and current_frame % PREVIEW_EVERY_N_FRAMES != 0:
            return
        try:
            size = _write_preview_files(job_id, current_frame, frame_bgr)
            if size is None:
                return
            width, height = size
            progress_queue.put(json.dumps({
                "status": "processing",
                "progress": max(last_percent[0], 0),
                "currentFrame": current_frame,
                "totalFrames": total_frames,
                "preview": {
                    "frameIndex": current_frame,
                    "width": width,
                    "height": height,
                    "downloadUrl": f"/preview/{job_id}/{current_frame}",
                },
            }))
        except Exception as e:  # previews must never fail inference
            logger.warning(
                f"Preview generation failed for job {job_id} frame {current_frame}: {e}"
            )

    def inference_thread() -> None:
        try:
            result = engine.process_video(
                input_path=input_path,
                output_path=output_path,
                max_height=MAX_INPUT_HEIGHT,
                progress_callback=progress_callback,
                should_cancel=cancel_event.is_set,
                preview_callback=preview_callback if preview_active else None,
            )
            file_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
            completed: dict[str, object] = {
                "status": "completed",
                "jobId": job_id,
                "progress": 100,
                "totalFrames": result["frames"],
                "fileSize": file_size,
            }
            if result_download_url is not None:
                completed["resultDownloadUrl"] = result_download_url
            progress_queue.put(json.dumps(completed))
        except InferenceCancelledError:
            if os.path.exists(output_path):
                os.remove(output_path)
            if preview_active:
                shutil.rmtree(WORK_PREVIEW_DIR / job_id, ignore_errors=True)
            cancelled_line = json.dumps({
                "status": "cancelled",
                "jobId": job_id,
                "progress": max(last_percent[0], 0),
                "error": "Upscaling cancelled by user",
            })
            progress_queue.put(cancelled_line)
        except Exception as e:
            error_line = json.dumps({
                "status": "failed",
                "jobId": job_id,
                "error": str(e),
            })
            progress_queue.put(error_line)
        finally:
            with active_lock:
                active_cancellations.pop(job_id, None)
            progress_queue.put(None)  # Sentinel

    async def stream_progress():
        thread = threading.Thread(target=inference_thread, daemon=True)
        thread.start()

        while True:
            try:
                line = progress_queue.get_nowait()
            except queue.Empty:
                await asyncio.sleep(0.03)
                continue

            if line is None:
                break
            yield line + "\n"

    return StreamingResponse(
        stream_progress(),
        media_type="application/x-ndjson",
    )


@app.get("/health")
def health():
    return {
        "status": "ok",
        "device": DEVICE_NAME,
        "model_loaded": model_loaded,
    }


@app.post("/cancel", dependencies=[Depends(require_token)])
def cancel(req: CancelRequest):
    with active_lock:
        event = active_cancellations.get(req.jobId)
    if event is None:
        raise HTTPException(status_code=404, detail=f"Job {req.jobId} is not active")
    event.set()
    return {"status": "cancelled", "jobId": req.jobId}


@app.post("/process", dependencies=[Depends(require_token)])
async def process(req: ProcessRequest):
    """Path-based transport: backend supplies absolute filesystem paths.

    Guarded by the same optional bearer token as the other internal endpoints:
    a no-op when ``AI_INTERNAL_TOKEN`` is empty (local dev), enforced when set.
    """
    _ensure_model_ready()

    if not os.path.exists(req.inputPath):
        raise HTTPException(status_code=400, detail=f"Input file not found: {req.inputPath}")

    return run_inference_stream(req.jobId, req.inputPath, req.outputPath)


@app.post("/process-upload", dependencies=[Depends(require_token)])
async def process_upload(
    jobId: str = Form(...),
    video: UploadFile = File(...),
):
    """Remote transport: receive the video over multipart and stream progress."""
    _ensure_model_ready()

    job_id = validate_job_id(jobId)
    ext = safe_extension(video.filename)
    input_path = str(WORK_UPLOAD_DIR / f"{job_id}{ext}")
    output_path = str(WORK_RESULT_DIR / f"{job_id}_enhanced{ext}")

    try:
        with open(input_path, "wb") as buffer:
            while chunk := await video.read(UPLOAD_CHUNK_SIZE):
                buffer.write(chunk)
    finally:
        await video.close()

    return run_inference_stream(
        job_id,
        input_path,
        output_path,
        result_download_url=f"/result/{job_id}",
    )


@app.get("/result/{job_id}", dependencies=[Depends(require_token)])
def get_result(job_id: str):
    """Serve only enhanced results from ``WORK_RESULT_DIR``; no path input."""
    job_id = validate_job_id(job_id)

    matches = sorted(WORK_RESULT_DIR.glob(f"{job_id}_enhanced.*"))
    if not matches:
        raise HTTPException(status_code=404, detail="Result not found")

    result_path = matches[0].resolve()
    # Defense in depth: never serve a file outside the work result directory.
    if WORK_RESULT_DIR not in result_path.parents:
        raise HTTPException(status_code=404, detail="Result not found")

    return FileResponse(
        path=str(result_path),
        media_type="application/octet-stream",
        filename=result_path.name,
    )


def _serve_preview(job_id: str, frame_key: str) -> FileResponse:
    """Serve one preview JPEG from ``WORK_PREVIEW_DIR``; no path input accepted."""
    preview_path = resolve_preview_path(WORK_PREVIEW_DIR, job_id, frame_key)
    if preview_path is None:
        raise HTTPException(status_code=400, detail="Invalid preview request")
    if not preview_path.exists():
        raise HTTPException(status_code=404, detail="Preview not found")
    return FileResponse(path=str(preview_path), media_type="image/jpeg")


@app.get("/preview/{job_id}/latest", dependencies=[Depends(require_token)])
def get_preview_latest(job_id: str):
    return _serve_preview(job_id, LATEST_FRAME_KEY)


@app.get("/preview/{job_id}/{frame_index}", dependencies=[Depends(require_token)])
def get_preview_frame(job_id: str, frame_index: str):
    return _serve_preview(job_id, frame_index)


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
