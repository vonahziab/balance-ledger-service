# Майлстоуны

План реализации. После каждого этапа проект собирается и запускается.

## M0. Документация и инфраструктура ✅

- [x] ТЗ, архитектура, ADR
- [x] `docker-compose.yml` (Postgres + Redis), `.env.example`, `.nvmrc`

## M1. Каркас и база данных

Цель: `npm run migration:run` поднимает схему и фикстуру, сервер стартует.

- [ ] Nest-проект: TypeScript, ESLint/Prettier, Jest, npm-скрипты из README
- [ ] Валидация env при старте
- [ ] TypeORM: сущности, `bigint.transformer`, миграция схемы, сид `id = 1`
- [ ] Redis-клиент
- [ ] `main.ts`: helmet, CORS, `ValidationPipe`, Swagger, логгер
- [ ] Rate limit (`@nestjs/throttler`)

## M2. Списание баланса

Цель: `POST /users/:id/debit` работает по [потоку запроса](architecture.md#поток-запроса-post-usersiddebit).

- [ ] DTO и валидация `:id`, `amount`, `Idempotency-Key`
- [ ] Exception filter с единым форматом ошибок
- [ ] Транзакция с `FOR UPDATE`, идемпотентность, проверка средств
- [ ] Запись в леджер, пересчёт через `SUM` и сверка с `balance_after`

## M3. Чтение баланса и кэш

Цель: `GET /users/:id/balance` с Redis-кэшем, работает и без Redis.

- [ ] Cache-aside с TTL, инвалидация после `debit`
- [ ] Fallback на БД при ошибках Redis

## M4. Тесты и финализация

Цель: тесты зелёные, README соответствует коду.

- [ ] Unit: `bigint.transformer`, ветки `UsersService.debit`
- [ ] Интеграционные (Testcontainers): сценарии из [решений](architecture.md#решения)
- [ ] `Dockerfile` и сервис `app` в `docker-compose.yml`: запуск одной командой `docker compose up`
- [ ] Ручная проверка по README: запуск, `curl`, Swagger
