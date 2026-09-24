.DEFAULT_GOAL := help

.PHONY: help
help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

## --- Setup -------------------------------------------------------------

.env:
	cp .env.example .env

node_modules: package.json package-lock.json
	npm ci
	@touch node_modules

.PHONY: install
install: node_modules ## Install dependencies (npm ci)

.PHONY: setup
setup: .env install up migrate ## First run: .env, deps, infra, migrations

## --- Infrastructure ----------------------------------------------------

.PHONY: up
up: .env ## Start Postgres and Redis, wait until healthy
	docker compose up -d --wait

.PHONY: down
down: ## Stop Postgres and Redis
	docker compose down

.PHONY: reset-db
reset-db: ## Drop all data (volumes) and re-run migrations
	docker compose down -v
	$(MAKE) up migrate

.PHONY: logs
logs: ## Follow infrastructure logs
	docker compose logs -f

.PHONY: psql
psql: ## Open psql in the Postgres container
	docker compose exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

.PHONY: redis-cli
redis-cli: ## Open redis-cli in the Redis container
	docker compose exec redis redis-cli

## --- Database ----------------------------------------------------------

.PHONY: migrate
migrate: install ## Run migrations (builds first)
	npm run migration:run

.PHONY: migrate-revert
migrate-revert: install ## Revert the last migration
	npm run migration:revert

## --- App ---------------------------------------------------------------

.PHONY: dev
dev: install ## Start in watch mode
	npm run start:dev

.PHONY: build
build: install ## Compile to dist/
	npm run build

.PHONY: start
start: build ## Run the compiled app
	npm run start:prod

## --- Quality -----------------------------------------------------------

.PHONY: format
format: install ## Format sources with Prettier
	npm run format

.PHONY: lint
lint: install ## Run ESLint
	npm run lint

.PHONY: typecheck
typecheck: install ## Type-check without emitting
	npm run typecheck

.PHONY: test
test: install ## Run unit tests
	npm run test

.PHONY: test-integration
test-integration: install ## Run integration tests (needs Docker)
	npm run test:integration

.PHONY: check
check: typecheck lint test ## Typecheck, lint and unit tests (CI gate)

.PHONY: clean
clean: ## Remove build output and coverage
	rm -rf dist coverage
