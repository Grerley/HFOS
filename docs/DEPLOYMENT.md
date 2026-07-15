# HFOS deployment guide

## 1. Environments & secrets

Copy `.env.example` → `.env` and set real values. **Never commit `.env`.**

| Variable | Purpose | Production requirement |
|---|---|---|
| `DATABASE_URL` | DB DSN | Managed PostgreSQL, e.g. `postgresql+psycopg://user:pass@host:5432/hfos` |
| `HFOS_SECRET_KEY` | JWT signing | 48+ random bytes: `python -c "import secrets;print(secrets.token_urlsafe(48))"` |
| `HFOS_ENCRYPTION_KEY` | Field encryption (Fernet) | `python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"` |
| `HFOS_ACCESS_TOKEN_MINUTES` | Token lifetime | e.g. 60–720 |
| `HFOS_CORS_ORIGINS` | Allowed web origins | your frontend URL(s), comma-separated |
| `HFOS_AUTO_CREATE_TABLES` | Startup `create_all` | `false` in prod — use Alembic migrations |
| `NEXT_PUBLIC_API_BASE_URL` | Frontend → API URL | public API URL |

Store secrets in your platform's secret manager (AWS Secrets Manager, GCP Secret Manager,
Azure Key Vault, Kubernetes secrets) — not in the image or repo.

## 2. Container deployment (recommended)

Both services ship with a `Dockerfile`. Build and push to your registry:

```bash
docker build -t <registry>/hfos-backend:<tag> ./backend
docker build -t <registry>/hfos-frontend:<tag> ./frontend
```

Run behind a TLS-terminating reverse proxy / load balancer (nginx, ALB, Cloud Run, etc.).
The provided `docker-compose.yml` is a working reference for the full stack topology.

### Minimum production topology

```
[users] ──HTTPS──> [CDN / LB / TLS] ──> frontend (Next.js)  ──> backend (FastAPI, N replicas)
                                                                     │
                                                             managed PostgreSQL (+ backups)
```

## 3. Database

1. Provision managed PostgreSQL; enable automated daily backups + PITR.
2. Apply migrations (see `docs/DATA_MODEL.md`): `alembic upgrade head`.
3. Set `HFOS_AUTO_CREATE_TABLES=false` so schema is migration-controlled.
4. (Optional first environment) seed a demo household: `python -m app.scripts.seed_db`.

## 4. Backend process

Run under a production ASGI server with multiple workers:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
# or: gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 4 -b 0.0.0.0:8000
```

Put HTTPS termination and rate limiting at the proxy layer.

## 5. Frontend

```bash
cd frontend
npm ci
NEXT_PUBLIC_API_BASE_URL=https://api.example.com npm run build
npm start            # or deploy to Vercel / a Node host / static+SSR platform
```

## 6. Operational checklist

- [ ] TLS everywhere (1.2+); HSTS at the proxy.
- [ ] `HFOS_SECRET_KEY` and `HFOS_ENCRYPTION_KEY` set from the secret manager, rotated on a schedule.
- [ ] `HFOS_CORS_ORIGINS` restricted to known origins.
- [ ] DB backups verified with a test restore.
- [ ] Structured logs shipped to a log store; alert on 5xx and auth failures.
- [ ] Audit events (`/audit`-backed `AuditEvent`) retained per your compliance policy.
- [ ] Least-privilege DB credentials; no superuser at runtime.
- [ ] Dependency and image scanning in CI.

## 7. POPIA / GDPR posture

The architecture supports these controls (see `docs/KNOWN_LIMITATIONS.md` for what is scaffolded
vs implemented): field encryption helper, audit logging, tenant isolation, role-based access,
and a clear path to data export/erasure endpoints. Complete a DPIA before processing real
household data, and wire export/erasure to your retention policy.
