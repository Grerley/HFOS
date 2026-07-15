# HFOS convenience targets. Run backend commands from a venv (see README).
.PHONY: help backend-install backend-seed backend-run backend-test frontend-install frontend-dev sample docker

help:
	@echo "Targets:"
	@echo "  backend-install   pip install backend requirements (activate a venv first)"
	@echo "  backend-seed      create SQLite DB + demo data"
	@echo "  backend-run       run the API (uvicorn, reload)"
	@echo "  backend-test      run pytest"
	@echo "  frontend-install  npm install"
	@echo "  frontend-dev      run Next.js dev server"
	@echo "  sample            regenerate the synthetic sample workbook"
	@echo "  docker            docker compose up --build"

backend-install:
	cd backend && pip install -r requirements.txt

backend-seed:
	cd backend && python -m app.scripts.seed_db

backend-run:
	cd backend && uvicorn app.main:app --reload --port 8000

backend-test:
	cd backend && python -m pytest

frontend-install:
	cd frontend && npm install

frontend-dev:
	cd frontend && npm run dev

sample:
	cd backend && python -m app.scripts.gen_sample_workbook

docker:
	docker compose up --build
