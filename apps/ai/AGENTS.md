# ai agent guide

Python FastAPI inference service for video super-resolution. Port 8000. PyTorch BasicVSR + SPyNet (V3 checkpoint, 4x scale, seq_len 15).

## Structure

- `server.py` — FastAPI app: `GET /health`, `POST /process` (NDJSON progress stream), `POST /cancel`.
- `baseline/model_architecture.py` — model definition. Do not modify without an explicit request.
- `baseline/vsr_inference.py` — `VSRInferenceEngine` (frame loop, cancellation, progress callbacks).
- `checkpoints/` — model weights (`vsr_model_best.pth`, gitignored, ~21 MB).

## Conventions

- Python deps live in `requirements.txt`; the `package.json` exists only to wire uvicorn into Turborepo (`pnpm --filter ai dev`).
- The engine owns inference parameters (sequence length, degradation simulation). The backend sends only `jobId`, `inputPath`, `outputPath`, `scale`.
- Env vars: `CHECKPOINT_PATH`, `DEVICE`, `MAX_INPUT_HEIGHT`, `HOST`, `PORT` (see `.env.development.example`).

## Setup

```
pnpm --filter ai setup   # pip install -r requirements.txt
pnpm --filter ai dev     # uvicorn with reload
```
