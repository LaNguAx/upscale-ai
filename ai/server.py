"""FastAPI AI service for video super-resolution inference (V3: BasicVSR + SPyNet)."""

import asyncio
import json
import logging
import os
import queue
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from baseline import VSRInferenceEngine, SEQ_LEN, SCALE, InferenceCancelledError

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


@app.get("/health")
def health():
    return {
        "status": "ok",
        "device": DEVICE_NAME,
        "model_loaded": model_loaded,
    }


@app.post("/cancel")
def cancel(req: CancelRequest):
    with active_lock:
        event = active_cancellations.get(req.jobId)
    if event is None:
        raise HTTPException(status_code=404, detail=f"Job {req.jobId} is not active")
    event.set()
    return {"status": "cancelled", "jobId": req.jobId}


@app.post("/process")
async def process(req: ProcessRequest):
    if not model_loaded or engine is None:
        raise HTTPException(status_code=503, detail="No model checkpoint loaded")

    if not os.path.exists(req.inputPath):
        raise HTTPException(status_code=400, detail=f"Input file not found: {req.inputPath}")

    cancel_event = threading.Event()
    with active_lock:
        active_cancellations[req.jobId] = cancel_event

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

    def inference_thread() -> None:
        try:
            result = engine.process_video(
                input_path=req.inputPath,
                output_path=req.outputPath,
                max_height=MAX_INPUT_HEIGHT,
                progress_callback=progress_callback,
                should_cancel=cancel_event.is_set,
            )
            file_size = os.path.getsize(req.outputPath) if os.path.exists(req.outputPath) else 0
            completed_line = json.dumps({
                "status": "completed",
                "jobId": req.jobId,
                "progress": 100,
                "totalFrames": result["frames"],
                "fileSize": file_size,
            })
            progress_queue.put(completed_line)
        except InferenceCancelledError:
            if os.path.exists(req.outputPath):
                os.remove(req.outputPath)
            cancelled_line = json.dumps({
                "status": "cancelled",
                "jobId": req.jobId,
                "progress": max(last_percent[0], 0),
                "error": "Upscaling cancelled by user",
            })
            progress_queue.put(cancelled_line)
        except Exception as e:
            error_line = json.dumps({
                "status": "failed",
                "jobId": req.jobId,
                "error": str(e),
            })
            progress_queue.put(error_line)
        finally:
            with active_lock:
                active_cancellations.pop(req.jobId, None)
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


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
