"""Upscale AI Processing Service - FastAPI application."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.routes import health, process

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Upscale AI Processing Service",
    description="Video restoration and super-resolution processing pipeline",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(process.router)


@app.on_event("startup")
async def startup_event() -> None:
    settings.ensure_directories()
    logger.info(f"AI Service starting on port {settings.ai_port}")
    logger.info(f"Upload dir: {settings.get_upload_path()}")
    logger.info(f"Result dir: {settings.get_result_path()}")
    logger.info(f"Temp dir: {settings.get_temp_path()}")
    logger.info(f"Max concurrent jobs: {settings.max_concurrent_jobs}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "src.main:app",
        host="0.0.0.0",
        port=settings.ai_port,
        reload=True,
    )
