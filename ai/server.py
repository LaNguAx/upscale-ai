"""FastAPI AI service for video super-resolution inference."""

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

from baseline.model import ResidualVSRModel
from baseline.inference import run_video_vsr
from baseline.config import SEQ_LEN, SCALE

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Configuration ---
CHECKPOINT_PATH = os.environ.get(
    "CHECKPOINT_PATH",
    str(Path(__file__).parent / "checkpoints" / "vsr_model_best.pth"),
)
DEVICE_NAME = os.environ.get("DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
DEVICE = torch.device(DEVICE_NAME)

# --- Global model state ---
model: ResidualVSRModel | None = None
model_loaded = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the model on startup."""
    global model, model_loaded

    if os.path.exists(CHECKPOINT_PATH):
        logger.info(f"Loading model from {CHECKPOINT_PATH} on {DEVICE}...")
        model = ResidualVSRModel(seq_len=SEQ_LEN, scale=SCALE).to(DEVICE)
        model.load_state_dict(torch.load(CHECKPOINT_PATH, map_location=DEVICE))
        model.eval()
        model_loaded = True
        params = sum(p.numel() for p in model.parameters())
        logger.info(f"Model loaded ({params:,} parameters)")
    else:
        logger.warning(f"No checkpoint found at {CHECKPOINT_PATH} — model not loaded")
        model = None
        model_loaded = False

    yield


app = FastAPI(title="Upscale AI Service", lifespan=lifespan)


class ProcessRequest(BaseModel):
    inputPath: str
    outputPath: str
    scale: int = SCALE
    seqLen: int = SEQ_LEN
    simulateLq: bool = True
    maxFrames: int | None = None


@app.get("/health")
def health():
    return {
        "status": "ok",
        "device": DEVICE_NAME,
        "model_loaded": model_loaded,
    }


@app.post("/process")
async def process(req: ProcessRequest):
    if not model_loaded or model is None:
        raise HTTPException(status_code=503, detail="No model checkpoint loaded")

    if not os.path.exists(req.inputPath):
        raise HTTPException(status_code=400, detail=f"Input file not found: {req.inputPath}")

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
            result = run_video_vsr(
                input_path=req.inputPath,
                output_path=req.outputPath,
                model=model,
                device=DEVICE,
                seq_len=req.seqLen,
                scale=req.scale,
                simulate_lq=req.simulateLq,
                max_frames=req.maxFrames,
                progress_callback=progress_callback,
            )
            completed_line = json.dumps({
                "status": "completed",
                "progress": 100,
                "totalFrames": result["total_frames"],
                "fileSize": result["file_size"],
            })
            progress_queue.put(completed_line)
        except Exception as e:
            error_line = json.dumps({
                "status": "failed",
                "error": str(e),
            })
            progress_queue.put(error_line)
        finally:
            progress_queue.put(None)  # Sentinel

    async def stream_progress():
        thread = threading.Thread(target=inference_thread, daemon=True)
        thread.start()

        while True:
            try:
                line = progress_queue.get_nowait()
            except queue.Empty:
                await asyncio.sleep(0.1)
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
