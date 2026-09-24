.DEFAULT_GOAL := help

.PHONY: help
help: ## Показать доступные цели
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

## --- Установка -------------------------------------------------------------

.env:
	cp .env.example .env

node_modules: package.json package-lock.json
	npm ci
	@touch node_modules

.PHONY: install
install: node_modules ## Установить зависимости (npm ci)

.PHONY: setup
setup: .env install up migrate ## Первый запуск: .env, зависимости, инфраструктура, миграции

## --- Инфраструктура ----------------------------------------------------

.PHONY: up
up: .env ## Поднять Postgres и Redis, дождаться healthy
	docker compose up -d --wait

.PHONY: down
down: ## Остановить Postgres и Redis
	docker compose down

.PHONY: reset-db
reset-db: ## Удалить все данные (volumes) и заново применить миграции
	docker compose down -v
	$(MAKE) up migrate

.PHONY: logs
logs: ## Смотреть логи инфраструктуры
	docker compose logs -f

.PHONY: psql
psql: ## Открыть psql в контейнере Postgres
	docker compose exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

.PHONY: redis-cli
redis-cli: ## Открыть redis-cli в контейнере Redis
	docker compose exec redis redis-cli

## --- База данных ----------------------------------------------------------

.PHONY: migrate
migrate: install ## Применить миграции (сначала сборка)
	npm run migration:run

.PHONY: migrate-revert
migrate-revert: install ## Откатить последнюю миграцию
	npm run migration:revert

## --- Приложение ---------------------------------------------------------------

.PHONY: dev
dev: install ## Запустить в watch-режиме
	npm run start:dev

.PHONY: build
build: install ## Собрать в dist/
	npm run build

.PHONY: start
start: build ## Запустить собранное приложение
	npm run start:prod

## --- Качество -----------------------------------------------------------

.PHONY: format
format: install ## Отформатировать код Prettier
	npm run format

.PHONY: lint
lint: install ## Запустить ESLint
	npm run lint

.PHONY: typecheck
typecheck: install ## Проверить типы без сборки
	npm run typecheck

.PHONY: test
test: install ## Запустить unit-тесты
	npm run test

.PHONY: test-integration
test-integration: install ## Запустить интеграционные тесты (нужен Docker)
	npm run test:integration

.PHONY: check
check: typecheck lint test ## Типы, линтер и unit-тесты (проверка для CI)

.PHONY: clean
clean: ## Удалить результаты сборки и coverage
	rm -rf dist coverage
