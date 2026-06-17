"""Lightweight unit tests for the AI security helpers.

These import only ``security`` (no torch / FastAPI / GPU), so they run fast in
any environment. Run with ``pytest`` or directly: ``python test_security.py``.
"""

from security import is_valid_job_id, safe_extension, token_matches


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


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for test in tests:
        test()
        print(f"ok: {test.__name__}")
    print(f"All {len(tests)} security tests passed")
