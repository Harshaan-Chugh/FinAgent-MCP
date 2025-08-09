.PHONY: up down logs dev-setup install-deps db-migrate db-reset test lint build

# Infrastructure commands
up:
	docker compose up -d
	@echo "Waiting for services to be ready..."
	@sleep 5
	@$(MAKE) db-migrate

down:
	docker compose down

logs:
	docker compose logs -f

# Development setup
dev-setup: up install-deps
	@echo "Development environment ready!"

install-deps:
	pnpm install
	cd services/ingest && go mod download

# Database commands
db-migrate:
	@echo "Running database migrations..."
	psql postgres://postgres:postgres@localhost:5432/finagent -f ../db/migrations/0001_init.sql

db-reset:
	docker compose down -v
	$(MAKE) up

# Go service commands
go-run:
	cd services/ingest && go run cmd/ingest/main.go

go-build:
	cd services/ingest && go build -o bin/ingest cmd/ingest/main.go

go-test:
	cd services/ingest && go test ./...

# Node/TypeScript commands
mcp-dev:
	pnpm -C apps/mcp dev

web-dev:
	pnpm -C apps/web dev

# Testing and quality
test:
	pnpm test
	cd services/ingest && go test ./...

lint:
	pnpm lint
	cd services/ingest && go fmt ./...

build:
	pnpm build
	$(MAKE) go-build

# Evaluation
eval:
	pnpm -C tests/eval test

# Complete development workflow
dev: dev-setup
	@echo "Starting all services..."
	@echo "1. Go ingestion service: make go-run"
	@echo "2. MCP server: make mcp-dev"
	@echo "3. Web UI: make web-dev"