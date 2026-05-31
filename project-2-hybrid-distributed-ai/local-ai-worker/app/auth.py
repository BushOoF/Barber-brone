"""Shared-secret authentication for the local worker.

The cloud bot (Project 2) talks to this worker across a public tunnel (cloudflared / ngrok), so
every protected request MUST carry the ``X-Worker-Secret`` header. We compare it against
``WORKER_SHARED_SECRET`` using a constant-time comparison and return 401 on mismatch / absence.

Usage (FastAPI dependency)::

    @app.post("/process-voice", dependencies=[Depends(require_worker_secret)])
    async def process_voice(...): ...
"""

from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, status

from .config import get_settings

# Canonical header name. Defined here so route handlers and OpenAPI docs stay in sync.
WORKER_SECRET_HEADER = "X-Worker-Secret"


async def require_worker_secret(
    x_worker_secret: str | None = Header(
        default=None,
        alias=WORKER_SECRET_HEADER,
        description="Shared secret matching WORKER_SHARED_SECRET on the worker.",
    ),
) -> None:
    """FastAPI dependency that enforces a valid shared secret.

    Raises ``HTTPException(401)`` when the header is missing or does not match. Uses
    ``hmac.compare_digest`` to avoid leaking the secret length / content via timing.
    """
    expected = get_settings().WORKER_SHARED_SECRET

    # ``compare_digest`` requires both operands be present; treat a missing header as a mismatch.
    provided = x_worker_secret or ""

    if not hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing worker secret.",
            headers={"WWW-Authenticate": "X-Worker-Secret"},
        )
