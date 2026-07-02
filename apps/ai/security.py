"""Pure, dependency-free security helpers for the AI service.

These have no heavy runtime dependencies (no torch / FastAPI) so they can be
unit-tested in isolation. ``server.py`` wraps them into FastAPI dependencies and
HTTP responses.
"""

import hmac
import re
from pathlib import Path

ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mkv", ".mov", ".wmv", ".webm"}
DEFAULT_EXTENSION = ".mp4"
JOB_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def is_valid_job_id(job_id: str) -> bool:
    """True only for ids that cannot be used for path traversal."""
    return bool(JOB_ID_PATTERN.fullmatch(job_id))


FRAME_INDEX_PATTERN = re.compile(r"^\d{1,9}$")
LATEST_FRAME_KEY = "latest"


def is_valid_frame_index(frame_key: str) -> bool:
    """True only for plain decimal frame indexes (no signs, dots, or paths)."""
    return bool(FRAME_INDEX_PATTERN.fullmatch(frame_key))


def resolve_preview_path(preview_dir: Path, job_id: str, frame_key: str) -> Path | None:
    """Return the absolute path of a preview JPEG, or ``None`` if unsafe.

    ``frame_key`` is either ``"latest"`` or a decimal frame index. The result
    is guaranteed to stay inside ``preview_dir`` — callers never supply paths.
    """
    if not is_valid_job_id(job_id):
        return None
    if frame_key != LATEST_FRAME_KEY and not is_valid_frame_index(frame_key):
        return None
    base = preview_dir.resolve()
    candidate = (base / job_id / f"{frame_key}.jpg").resolve()
    if base not in candidate.parents:
        return None
    return candidate


def safe_extension(filename: str | None) -> str:
    """Return an allow-listed extension for an uploaded file (defaults to .mp4)."""
    ext = Path(filename or "").suffix.lower()
    return ext if ext in ALLOWED_EXTENSIONS else DEFAULT_EXTENSION


def token_matches(authorization: str | None, token: str) -> bool:
    """Constant-time check of an ``Authorization`` header against the token.

    An empty ``token`` means auth is disabled (local dev) and every request
    passes. Never logs or returns the token itself.
    """
    if not token:
        return True
    if authorization is None:
        return False
    return hmac.compare_digest(authorization, f"Bearer {token}")
