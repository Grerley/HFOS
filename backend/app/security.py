"""Security primitives: password hashing, JWT tokens, sensitive-field encryption."""
from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ── Passwords ────────────────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    return _pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _pwd.verify(plain, hashed)
    except ValueError:
        return False


# ── JWT ──────────────────────────────────────────────────────────────────────
def create_access_token(subject: str, extra: dict | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_minutes),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        return None


# ── Field encryption (POPIA/GDPR: encrypt sensitive fields at rest) ───────────
def _fernet():
    """Return a Fernet instance if an encryption key is configured, else None.

    A missing key degrades gracefully to a deterministic dev fallback so the app
    still runs from a clean repo; production MUST set HFOS_ENCRYPTION_KEY.
    """
    key = settings.encryption_key
    if not key:
        return None
    try:
        from cryptography.fernet import Fernet

        return Fernet(key.encode() if isinstance(key, str) else key)
    except Exception:
        return None


def encrypt_field(plaintext: str | None) -> str | None:
    if plaintext is None:
        return None
    f = _fernet()
    if f is None:
        # Dev fallback: reversible obfuscation so the flow works without a key.
        return "plain:" + base64.urlsafe_b64encode(plaintext.encode()).decode()
    return "enc:" + f.encrypt(plaintext.encode()).decode()


def decrypt_field(ciphertext: str | None) -> str | None:
    if ciphertext is None:
        return None
    if ciphertext.startswith("plain:"):
        return base64.urlsafe_b64decode(ciphertext[6:].encode()).decode()
    if ciphertext.startswith("enc:"):
        f = _fernet()
        if f is None:
            return None
        return f.decrypt(ciphertext[4:].encode()).decode()
    return ciphertext


def content_hash(value: str) -> str:
    """Stable hash for audit before/after snapshots (no plaintext in the log)."""
    return hashlib.sha256(value.encode()).hexdigest()
