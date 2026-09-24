# Майлстоуны

План реализации. После каждого этапа проект собирается и запускается.

## M0. Документация и инфраструктура ✅

- [x] ТЗ, архитектура, ADR
- [x] `docker-compose.yml` (Postgres + Redis), `.env.example`, `.nvmrc`

## M1. Каркас и база данных ✅

Цель: `npm run migration:run` поднимает схему и фикстуру, сервер стартует.

- [x] Nest-проект: TypeScript, ESLint/Prettier, Vitest, npm-скрипты из README
- [x] Валидация env при старте
- [x] TypeORM: сущности, `bigint.transformer`, миграция схемы, сид `id = 1`
- [x] Redis-клиент
- [x] `main.ts`: helmet, CORS, `ValidationPipe`, Swagger, логгер
- [x] Rate limit (`@nestjs/throttler`)
- [x] Интеграционный тест схемы (Testcontainers): сид, ограничения, `down`

Nest 12 распространяется только как ESM, поэтому проект — ESM
(`"type": "module"`), а тесты — на Vitest вместо Jest: Jest с ESM требует
экспериментального `--experimental-vm-modules`.

## M2. Списание баланса ✅

Цель: `POST /users/:id/debit` работает по [потоку запроса](architecture.md#поток-запроса-post-usersiddebit).

- [x] DTO и валидация `:id`, `amount`, `Idempotency-Key`
- [x] Exception filter с единым форматом ошибок
- [x] Транзакция с `FOR UPDATE`, идемпотентность, проверка средств
- [x] Запись в леджер, пересчёт через `SUM` и сверка с `balance_after`
- [x] Интеграционный тест: параллельные списания, идемпотентность, инвариант ADR-0004
- [x] E2E (supertest + Testcontainers): контракт ошибок из
  [таблицы](architecture.md#обработка-ошибок) — `400` на `:id`, `amount`,
  `Idempotency-Key` и битый JSON, `404`, `409`, `422`, `503`, неизвестный
  маршрут; happy path `200`

Шаг 9 потока (`DEL balance:{id}`) — в M3 вместе с кэшем.

## M3. Чтение баланса и кэш ✅

Цель: `GET /users/:id/balance` с Redis-кэшем, работает и без Redis.

- [x] Cache-aside с TTL, инвалидация после `debit`
- [x] Fallback на БД при ошибках Redis

## M4. Тесты и финализация ✅

Цель: тесты зелёные, README соответствует коду.

- [x] Интеграционные и e2e для `GET /users/:id/balance` и кэша
- [x] `Dockerfile` и сервис `app` в `docker-compose.yml`: запуск одной командой `docker compose up`
- [x] Ручная проверка по README: запуск, `curl`, Swagger

Миграции в Docker применяет отдельный сервис `migrate`: `app` зависит от его
успешного завершения, поэтому не стартует на неприменённой схеме.
