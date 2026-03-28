from datetime import datetime, timezone

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health_check() -> dict:
    return {
        "ok": True,
        "service": "ai",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
