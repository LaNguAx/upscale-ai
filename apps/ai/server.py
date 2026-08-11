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
import subprocess
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import cv2
import numpy as np
import torch
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from baseline import (
    VSRInferenceEngine,
    SEQ_LEN,
    SCALE,
    InferenceCancelledError,
    ResolutionTooHighError,
)
from security import (
    LATEST_FRAME_KEY,
    ORIGINAL_KEY_SUFFIX,
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
    str(Path(__file__).parent / "checkpoints" / "vsr_model_v4_best_codec_psnr.pth"),
)
DEVICE_NAME = os.environ.get("DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
DEVICE = torch.device(DEVICE_NAME)
# Input taller than this is rejected — never auto-downscaled.
MAX_INPUT_HEIGHT = int(os.environ.get("MAX_INPUT_HEIGHT", "480"))

# Machine-readable reason on the `failed` line, so clients can render their own
# copy instead of the raw exception text.
INPUT_RESOLUTION_TOO_HIGH = "INPUT_RESOLUTION_TOO_HIGH"
INPUT_RESOLUTION_TOO_HIGH_MESSAGE = (
    "Unfortunately, our current version supports input videos up to 480p. "
    "Please upload a lower-resolution video and try again."
)

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
PREVIEW_EVERY_N_FRAMES = max(1, int(os.environ.get("PREVIEW_EVERY_N_FRAMES", "2")))
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
        logger.info(f"Loading model from {CHECKPOINT_PATH} on {DEVICE}...")
        engine = VSRInferenceEngine(
            checkpoint_path=CHECKPOINT_PATH,
            device=DEVICE_NAME,
            seq_len=SEQ_LEN,
            scale=SCALE,
        )
        model_loaded = True
        params = sum(p.numel() for p in engine.model.parameters())
        logger.info(
            f"Model loaded ({params:,} parameters), "
            f"max input height: {MAX_INPUT_HEIGHT}px"
        )
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
    job_id: str, frame_index: int, frame_bgr: np.ndarray, suffix: str = ""
) -> tuple[int, int] | None:
    """Write ``{frameIndex}{suffix}.jpg`` and ``latest{suffix}.jpg`` atomically.

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
    for name in (f"{frame_index}{suffix}.jpg", f"{LATEST_FRAME_KEY}{suffix}.jpg"):
        tmp_path = job_dir / f".{name}.tmp"
        tmp_path.write_bytes(data)
        os.replace(tmp_path, job_dir / name)
    return width, height


def _probe_fps(input_path: str) -> float:
    """Best-effort source-fps probe for preview pacing (never raises).

    The engine also reads fps, but only returns it after inference finishes —
    preview lines are emitted during inference, so the server probes it itself
    (same 30.0 fallback the engine uses for broken metadata).
    """
    try:
        cap = cv2.VideoCapture(input_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        cap.release()
    except Exception:
        fps = 0.0
    return fps if fps and fps > 0 else 30.0


def _cleanup_previews(job_id: str) -> None:
    """Delete a job's cached preview frames — useless once the job is terminal."""
    shutil.rmtree(WORK_PREVIEW_DIR / job_id, ignore_errors=True)


def _transcode_to_h264(
    src: str,
    dest: str,
    scale: tuple[int, int] | None = None,
    audio_source: str | None = None,
) -> bool:
    """Re-encode a video to browser-safe H.264/yuv420p MP4 (atomic replace).

    When ``audio_source`` is given, its first audio stream is muxed into the
    output as AAC (optional-mapped, so inputs without audio still succeed;
    ``-shortest`` handles audio/video length mismatch). Returns True on
    success; on failure logs a warning and leaves ``dest`` untouched. Same
    proven video args as the engine's OpenCV decode fallback.
    """
    tmp_dest = f"{dest}.transcode.tmp.mp4"
    command = ["ffmpeg", "-y", "-i", src]
    if audio_source is not None:
        command += [
            "-i", audio_source,
            "-map", "0:v:0", "-map", "1:a:0?",
            "-c:a", "aac", "-shortest",
        ]
    else:
        command += ["-an"]
    command += ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
    if scale is not None:
        command += ["-vf", f"scale={scale[0]}:{scale[1]}"]
    command += ["-movflags", "+faststart", tmp_dest]
    try:
        result = subprocess.run(command, capture_output=True, text=True)
    except OSError as e:
        logger.warning(f"ffmpeg not runnable for {src}: {e}")
        return False
    if result.returncode != 0:
        logger.warning(
            f"H.264 transcode failed for {src}: "
            f"{(result.stderr or result.stdout).strip()[-500:]}"
        )
        Path(tmp_dest).unlink(missing_ok=True)
        return False
    os.replace(tmp_dest, dest)
    return True


def _original_video_path(output_path: str) -> str:
    """Derive `{jobId}_original.mp4` next to the enhanced output path."""
    stem = Path(output_path).stem
    if stem.endswith("_enhanced"):
        stem = stem[: -len("_enhanced")]
    return str(Path(output_path).with_name(f"{stem}_original.mp4"))


def _finalize_outputs(
    job_id: str, input_path: str, output_path: str, input_res: tuple[int, int]
) -> None:
    """Make the browser-facing artifacts playable everywhere.

    1. Re-encodes the raw OpenCV ``mp4v`` output to H.264 in place (browsers
       cannot decode mp4v), muxing in the original input's audio track (the
       OpenCV writer is video-only). On failure the raw file is kept
       (degraded).
    2. Encodes a browser-safe original-comparison video at the inference input
       resolution (``{jobId}_original.mp4``). Best-effort — the job completes
       without it. Stays audio-free: it plays muted under the comparison
       divider, and audio there would double-play against the enhanced video.
    """
    if _transcode_to_h264(output_path, output_path, audio_source=input_path):
        logger.info(f"Job {job_id}: enhanced output re-encoded to H.264")

    original_path = _original_video_path(output_path)
    if _transcode_to_h264(input_path, original_path, scale=input_res):
        logger.info(f"Job {job_id}: original comparison video written")


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
    source_fps = _probe_fps(input_path) if preview_active else 30.0

    def preview_callback(
        current_frame: int,
        total_frames: int,
        frame_bgr: np.ndarray,
        input_bgr: np.ndarray,
    ) -> None:
        if current_frame != 1 and current_frame % PREVIEW_EVERY_N_FRAMES != 0:
            return
        try:
            size = _write_preview_files(job_id, current_frame, frame_bgr)
            if size is None:
                return
            width, height = size
            preview: dict[str, object] = {
                "frameIndex": current_frame,
                "width": width,
                "height": height,
                "downloadUrl": f"/preview/{job_id}/{current_frame}",
                "fps": source_fps,
                "stride": PREVIEW_EVERY_N_FRAMES,
            }
            # Matching original (input) frame — best-effort; the enhanced
            # preview still ships if this write fails.
            original_size = _write_preview_files(
                job_id, current_frame, input_bgr, suffix=ORIGINAL_KEY_SUFFIX
            )
            if original_size is not None:
                preview["originalDownloadUrl"] = (
                    f"/preview/{job_id}/{current_frame}{ORIGINAL_KEY_SUFFIX}"
                )
            progress_queue.put(json.dumps({
                "status": "processing",
                "progress": max(last_percent[0], 0),
                "currentFrame": current_frame,
                "totalFrames": total_frames,
                "preview": preview,
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
            _finalize_outputs(job_id, input_path, output_path, result["input_res"])
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
                if os.path.exists(_original_video_path(output_path)):
                    completed["originalDownloadUrl"] = f"/result/{job_id}/original"
            progress_queue.put(json.dumps(completed))
            # Preview frames are useless once the final video exists. Cleaning
            # after the completed line is queued gives in-flight backend proxy
            # fetches a wider window; a racing fetch just gets a harmless 404.
            if preview_active:
                _cleanup_previews(job_id)
        except InferenceCancelledError:
            if os.path.exists(output_path):
                os.remove(output_path)
            Path(_original_video_path(output_path)).unlink(missing_ok=True)
            if preview_active:
                _cleanup_previews(job_id)
            cancelled_line = json.dumps({
                "status": "cancelled",
                "jobId": job_id,
                "progress": max(last_percent[0], 0),
                "error": "Upscaling cancelled by user",
            })
            progress_queue.put(cancelled_line)
        except ResolutionTooHighError as e:
            # Expected rejection, not a crash: keep the technical detail in the
            # logs and hand the client a code it can render its own copy for.
            if preview_active:
                _cleanup_previews(job_id)
            logger.info(f"Job {job_id}: rejected — {e}")
            progress_queue.put(json.dumps({
                "status": "failed",
                "jobId": job_id,
                "errorCode": INPUT_RESOLUTION_TOO_HIGH,
                "message": INPUT_RESOLUTION_TOO_HIGH_MESSAGE,
            }))
        except Exception as e:
            if preview_active:
                _cleanup_previews(job_id)
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
        "checkpoint": Path(CHECKPOINT_PATH).name if model_loaded else None,
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
    # Always .mp4: the writer produces a valid mp4v/.mp4 intermediate which the
    # finalize step re-encodes to H.264 in place for browser playback.
    output_path = str(WORK_RESULT_DIR / f"{job_id}_enhanced.mp4")

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


def _serve_result_file(job_id: str, glob_pattern: str) -> FileResponse:
    """Serve one file from ``WORK_RESULT_DIR`` by job-scoped pattern; no path input."""
    matches = sorted(WORK_RESULT_DIR.glob(glob_pattern))
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


@app.get("/result/{job_id}/original", dependencies=[Depends(require_token)])
def get_result_original(job_id: str):
    """Serve the browser-safe original-comparison video for a job."""
    job_id = validate_job_id(job_id)
    return _serve_result_file(job_id, f"{job_id}_original.mp4")


@app.get("/result/{job_id}", dependencies=[Depends(require_token)])
def get_result(job_id: str):
    """Serve only enhanced results from ``WORK_RESULT_DIR``; no path input."""
    job_id = validate_job_id(job_id)
    return _serve_result_file(job_id, f"{job_id}_enhanced.*")


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
