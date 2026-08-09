# UPscale AI service

Python FastAPI inference service for video super-resolution, built on PyTorch BasicVSR + SPyNet (V3 checkpoint: 4x scale, 15-frame sequences). The NestJS backend calls it over HTTP and consumes an NDJSON progress stream.

Part of the UPscale monorepo — see the root [README](../../README.md) and [AGENTS.md](AGENTS.md) for the full picture.

## Quick start

```bash
pnpm --filter ai setup  # python -m pip install -r requirements.txt
pnpm --filter ai dev    # uvicorn with reload on http://localhost:8000
```

Or directly: `python -m uvicorn server:app --reload --port 8000` from this directory.

### Model checkpoint

Two checkpoints ship in `checkpoints/` (~21 MB each, committed): `vsr_model_v4_best_codec_psnr.pth` (V4 codec-degradation fine-tune, the default) and `vsr_model_best.pth` (V3, the original baseline). The default load path is the V4 file — set `CHECKPOINT_PATH` to select another checkpoint. Without a checkpoint the server still boots, but `/health` reports `model_loaded: false` and `/process` returns 503. `/health` also reports the loaded checkpoint filename (`checkpoint`), so you can verify which weights a deployment runs.

On first model load, SPyNet pretrained weights are downloaded from OpenMMLab — network access is required once.

## Endpoints

| Method | Path       | Purpose                                             |
| ------ | ---------- | --------------------------------------------------- |
| GET    | `/health`  | `{ status, device, model_loaded, checkpoint }`      |
| POST   | `/process` | Run inference; streams NDJSON progress lines        |
| POST   | `/cancel`  | Cancel an active job (404 if the job is not active) |

The exact NDJSON message shapes are documented in [AGENTS.md](AGENTS.md).

## Configuration

| Variable           | Default                            | Purpose                                          |
| ------------------ | ---------------------------------- | ------------------------------------------------ |
| `CHECKPOINT_PATH`  | `./checkpoints/vsr_model_v4_best_codec_psnr.pth` | Model weights                      |
| `DEVICE`           | auto (`cuda` if available)         | PyTorch device                                   |
| `MAX_INPUT_HEIGHT` | `480`                              | Maximum supported input height                   |
| `HIGH_RES_POLICY`  | `reject`                           | Taller input: `reject`, `downscale`, or `native` |
| `HOST` / `PORT`    | `0.0.0.0` / `8000`                 | Bind address (when run as `__main__`)            |

## Requirements

- Python with the deps from `requirements.txt` (torch, opencv-python, fastapi, uvicorn, ...).
- **ffmpeg** on PATH — used as a decode fallback when OpenCV cannot read a video.
- CUDA GPU optional but recommended (~8 GB VRAM for 720p output); CPU works but is slow.
- The backend exchanges absolute file paths with this service — both must share a filesystem.

## Notes

- Frames are streamed: only a rolling window of `seq_len` (15) frames is held in memory, so RAM does not grow with video length.
- Input taller than `MAX_INPUT_HEIGHT` is **rejected** by default (the job fails with a message naming the resolution). Set `HIGH_RES_POLICY=downscale` to downscale it automatically instead, or `native` to run at full resolution (VRAM-hungry — a 1080p input yields a 4320p output).
- `apps/ai/baseline/` (model architecture and inference engine) is frozen baseline code — do not modify it without an explicit request.
