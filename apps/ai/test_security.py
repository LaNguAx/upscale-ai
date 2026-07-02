"""Lightweight unit tests for the AI security helpers.

These import only ``security`` (no torch / FastAPI / GPU), so they run fast in
any environment. Run with ``pytest`` or directly: ``python test_security.py``.
"""

from pathlib import Path

from security import (
    is_valid_frame_index,
    is_valid_job_id,
    is_valid_preview_file_key,
    resolve_preview_path,
    safe_extension,
    token_matches,
)


def test_valid_job_id_accepts_uuid_like():
    assert is_valid_job_id("abc-123_DEF")
    assert is_valid_job_id("550e8400-e29b-41d4-a716-446655440000")


def test_invalid_job_id_blocks_traversal():
    assert not is_valid_job_id("../etc/passwd")
    assert not is_valid_job_id("a/b")
    assert not is_valid_job_id("a\\b")
    assert not is_valid_job_id("a.b")
    assert not is_valid_job_id("")
    assert not is_valid_job_id("x" * 129)


def test_safe_extension_allowlist():
    assert safe_extension("video.mp4") == ".mp4"
    assert safe_extension("clip.MOV") == ".mov"
    assert safe_extension("payload.exe") == ".mp4"
    assert safe_extension("noext") == ".mp4"
    assert safe_extension(None) == ".mp4"


def test_token_matches():
    # Empty token disables auth — any request passes.
    assert token_matches(None, "") is True
    assert token_matches("Bearer anything", "") is True
    # With a token, only an exact "Bearer <token>" header passes.
    assert token_matches("Bearer secret", "secret") is True
    assert token_matches("Bearer wrong", "secret") is False
    assert token_matches(None, "secret") is False
    assert token_matches("Basic secret", "secret") is False


def test_valid_frame_index():
    assert is_valid_frame_index("1")
    assert is_valid_frame_index("0")
    assert is_valid_frame_index("999999999")


def test_invalid_frame_index():
    assert not is_valid_frame_index("")
    assert not is_valid_frame_index("-1")
    assert not is_valid_frame_index("1.5")
    assert not is_valid_frame_index("1" * 10)
    assert not is_valid_frame_index("latest")
    assert not is_valid_frame_index("../1")


def test_resolve_preview_path_valid_frame():
    base = Path("previews")
    resolved = resolve_preview_path(base, "job-1", "42")
    assert resolved == (base / "job-1" / "42.jpg").resolve()


def test_resolve_preview_path_latest():
    base = Path("previews")
    resolved = resolve_preview_path(base, "job-1", "latest")
    assert resolved == (base / "job-1" / "latest.jpg").resolve()


def test_resolve_preview_path_rejects_unsafe_input():
    base = Path("previews")
    assert resolve_preview_path(base, "../evil", "1") is None
    assert resolve_preview_path(base, "a/b", "latest") is None
    assert resolve_preview_path(base, "a.b", "latest") is None
    assert resolve_preview_path(base, "job-1", "..") is None
    assert resolve_preview_path(base, "job-1", "1/2") is None
    assert resolve_preview_path(base, "job-1", "") is None


def test_valid_preview_file_key_accepts_original_variants():
    assert is_valid_preview_file_key("42")
    assert is_valid_preview_file_key("42_in")
    assert is_valid_preview_file_key("latest")
    assert is_valid_preview_file_key("latest_in")


def test_invalid_preview_file_key():
    assert not is_valid_preview_file_key("")
    assert not is_valid_preview_file_key("_in")
    assert not is_valid_preview_file_key("42_out")
    assert not is_valid_preview_file_key("42_in_in")
    assert not is_valid_preview_file_key("latest_")
    assert not is_valid_preview_file_key("../1_in")
    assert not is_valid_preview_file_key("1" * 10 + "_in")


def test_resolve_preview_path_original_variants():
    base = Path("previews")
    assert resolve_preview_path(base, "job-1", "42_in") == (
        base / "job-1" / "42_in.jpg"
    ).resolve()
    assert resolve_preview_path(base, "job-1", "latest_in") == (
        base / "job-1" / "latest_in.jpg"
    ).resolve()
    assert resolve_preview_path(base, "job-1", "42_out") is None


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for test in tests:
        test()
        print(f"ok: {test.__name__}")
    print(f"All {len(tests)} security tests passed")
