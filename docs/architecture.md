# Архитектура

Здесь — *как* устроен сервис. Ключевые решения с альтернативами — в
[ADR](adr/README.md).

## Стек

- **NestJS** (TypeScript) — HTTP-слой, DI, структура модулей.
- **PostgreSQL** + **TypeORM** — хранение данных, миграции.
- **Redis** + **ioredis** — кэш для `GET /users/:id/balance` (свой
  cache-aside в `UsersService`, без `cache-manager`).
- **class-validator** — валидация запросов.
- **@nestjs/swagger** — API-документация на `/docs`.
- **helmet**, **@nestjs/throttler** — HTTP-заголовки безопасности и rate limit.

## Модули

```
src/
  main.ts                   # bootstrap: helmet, CORS, ValidationPipe, filter, Swagger
  app.module.ts             # config, TypeORM, Redis, throttler, users
  users/
    users.controller.ts     # POST /users/:id/debit, GET /users/:id/balance
    users.service.ts        # транзакция, блокировка, пересчёт, кэш
    entities/               # User, BalanceLedger
    dto/debit.dto.ts
  database/
    data-source.ts          # DataSource для TypeORM CLI
    migrations/             # схема + сид пользователя id = 1
    bigint.transformer.ts   # bigint <-> number (ADR-0001)
  common/
    redis/                  # ioredis-клиент и провайдер для кэша
    filters/                # единый формат ошибок
    middleware/             # логирование HTTP-запросов
  config/                   # валидация env
```

## Модель данных

```sql
CREATE TYPE ledger_action AS ENUM ('debit', 'credit');

-- users
  id          serial PK
  balance     bigint not null default 0 check (balance >= 0)
  created_at  timestamptz not null default now()

-- balance_ledger (append-only)
  id               bigserial PK
  user_id          int not null references users(id)
  action           ledger_action not null
  amount           bigint not null check (amount > 0)
  balance_after    bigint not null check (balance_after >= 0)  -- ADR-0002
  idempotency_key  varchar(255)                                -- ADR-0002
  ts               timestamptz not null default now()

  unique (user_id, idempotency_key)
  check (action = 'credit' or idempotency_key is not null)
```

Поля `(user_id, action, amount, ts)` — из ТЗ; `id`, `balance_after` и
`idempotency_key` добавлены для идемпотентности.

## Поток запроса: `POST /users/:id/debit`

```
1. Валидация (иначе 400 VALIDATION_ERROR):
   - :id — целое 1..2147483647;
   - amount — целое 1..Number.MAX_SAFE_INTEGER;
   - Idempotency-Key — непустая строка до 255 символов.
2. BEGIN.
3. SELECT * FROM users WHERE id = :id FOR UPDATE      -> 404, если нет (ADR-0003).
4. Поиск записи по (user_id, idempotency_key)          (ADR-0002):
   -> тот же amount: COMMIT, вернуть balance_after и id этой записи;
   -> другой amount: ROLLBACK, 422.
5. amount > users.balance                             -> ROLLBACK, 409 INSUFFICIENT_FUNDS.
6. INSERT INTO balance_ledger (debit, amount, balance_after = balance - amount, key).
7. UPDATE users SET balance = SUM по леджеру RETURNING balance;
   результат ≠ balance_after                          -> ROLLBACK, 500 (ADR-0004).
8. COMMIT.
9. DEL balance:{id} в Redis (ошибка логируется, не пробрасывается).
10. 200 { balance, ledgerEntryId }.
```

## Поток запроса: `GET /users/:id/balance`

Cache-aside по ключу `balance:{id}`, TTL `BALANCE_CACHE_TTL_SECONDS` (30 с):

- hit → значение из кэша;
- miss → `SELECT balance FROM users`, положить в кэш, вернуть;
- пользователь не найден → `404`, не кэшируется;
- Redis недоступен → ошибка логируется, чтение из БД.

Redis — не источник истины: списание решается только по `users.balance`
под блокировкой, а кэш лишь ускоряет чтение. Поэтому допустимо, что `GET`
ненадолго вернёт устаревший баланс. Пример: `GET` промахнулся мимо кэша и
прочитал старый баланс, параллельный `debit` закоммитился и сделал `DEL`,
после чего `GET` положил старое значение в кэш. Устаревание ограничено TTL.

## Обработка ошибок

Глобальный exception filter приводит все ошибки к одному формату. Логику
клиент строит по `code`, `message` — для человека.

```json
{ "statusCode": 409, "code": "INSUFFICIENT_FUNDS", "error": "Conflict", "message": "Insufficient funds" }
```

| Статус | `code` | Когда |
|--------|--------|-------|
| `400` | `VALIDATION_ERROR` | невалидный `:id`, `amount` или `Idempotency-Key` |
| `404` | `USER_NOT_FOUND` | пользователь не найден |
| `409` | `INSUFFICIENT_FUNDS` | недостаточно средств |
| `422` | `IDEMPOTENCY_KEY_REUSED` | ключ уже использован с другим `amount` |
| `429` | `TOO_MANY_REQUESTS` | превышен rate limit |
| `500` | `INTERNAL_ERROR` | всё непредвиденное; детали только в логах |

## Безопасность

Настраивается в `main.ts` и `app.module.ts`:

- **helmet** — стандартные заголовки безопасности (`X-Content-Type-Options`,
  `Strict-Transport-Security` и др.), убирает `X-Powered-By`.
- **CORS** — разрешённые origin из `CORS_ORIGIN` (список через запятую);
  по умолчанию CORS выключен.
- **Rate limit** — `@nestjs/throttler`, глобально 100 запросов в минуту с
  IP, превышение — `429`. Счётчики в памяти процесса: для одного инстанса
  этого достаточно, при масштабировании хранилище переносится в Redis.
- **Валидация** — глобальный `ValidationPipe` с `whitelist` и
  `forbidNonWhitelisted`: лишние поля в теле — `400`, а не молча
  игнорируются. Размер тела ограничен лимитом Express по умолчанию (100 КБ).
- **Ошибки** — `500` отдаёт клиенту только общий текст, стек и детали
  остаются в логах.

Аутентификации нет — её нет в ТЗ; `:id` в пути доверенный. CSRF-защита не
нужна: API не использует cookie.

## Логирование

Встроенный `Logger` Nest, без сторонних библиотек:

- в каждом классе — `new Logger(ClassName.name)`, контекст виден в каждой строке;
- уровень задаётся через `LOG_LEVEL` (`log` по умолчанию, `debug` для разработки);
- middleware пишет строку на каждый запрос: метод, путь, статус, время ответа;
- exception filter логирует `500` со стеком, ожидаемые `4xx` — уровнем `warn`
  без стека;
- ошибки Redis — `warn` (чтение уходит в БД);
  расхождение пересчёта баланса — `error`.

Суммы и `Idempotency-Key` в логах допустимы, секретов в запросах нет.

## Решения

Мелкие решения, не требующие отдельного ADR:

- **Недостаток средств** — овердрафт запрещён, `409 INSUFFICIENT_FUNDS`:
  запрос валиден, но конфликтует с текущим состоянием баланса.
- **Фикстура** — пользователь `id = 1` с балансом `100000` ($1000) и
  парная `credit`-запись заводятся миграцией, чтобы баланс с первой строки
  выводился из истории. После явной вставки `id = 1` миграция сдвигает
  последовательность (`setval`), чтобы следующий `INSERT` не упал на
  дубликате ключа. Эндпоинта пополнения нет.
- **Схема** — только через миграции, `synchronize: false`: ревьюер видит
  точный DDL.
- **Тесты** — два уровня:
  - unit (без Docker): `bigint.transformer` и ветки `UsersService.debit` с
    замоканным `EntityManager` — `404`, повтор ключа, `422`, недостаток
    средств, расхождение пересчёта;
  - интеграционные на [Testcontainers](https://testcontainers.com/)
    (реальные Postgres и Redis) — то, что моки не ловят: happy path,
    параллельные `debit`, ограничения схемы, пересчёт через `SUM`,
    инвалидация кэша. После каждого сценария проверяется инвариант из ADR-0004.
