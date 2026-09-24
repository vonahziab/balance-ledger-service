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
- **Vitest** + **supertest** — unit-, интеграционные и e2e-тесты (проект ESM, как и Nest 12).
- **ESLint** + **Prettier** — линтер и форматирование.

## Модули

```
src/
  main.ts                   # bootstrap: логгер запросов, helmet, CORS, Swagger
  app.module.ts             # config, TypeORM, Redis, users; глобальные guard, pipe, filter
  users/
    users.controller.ts     # POST /users/:id/debit, GET /users/:id/balance
    users.service.ts        # транзакция, блокировка, пересчёт, cache-aside
    balance-cache.ts        # кэш баланса в Redis; ошибки Redis не пробрасывает
    users.errors.ts         # доменные ошибки: 404, 409, 422, 503, расхождение пересчёта
    idempotency-key.decorator.ts  # чтение и валидация заголовка Idempotency-Key
    entities/               # User, BalanceLedger
    dto/                    # тело и ответ debit, ответ balance, параметр :id
  database/
    data-source.ts          # DataSource для TypeORM CLI
    typeorm.options.ts      # опции подключения: общие и с пулом/таймаутами для приложения
    migrations/             # схема + сид пользователя id = 1
    bigint.transformer.ts   # bigint <-> number (ADR-0001)
  common/
    redis/                  # ioredis-клиент и провайдер для кэша
    errors/                 # ApiException и коды ошибок
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
2. BEGIN; нет соединения из пула за 5 с               -> 503 SERVICE_BUSY.
3. SELECT * FROM users WHERE id = :id FOR UPDATE      -> 404, если нет (ADR-0003);
   не дождались за lock_timeout                        -> 503 LOCK_TIMEOUT.
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
- Redis недоступен → чтение из БД. Пока клиент не подключён, Redis не
  вызывается: недоступность логируется один раз, а не на каждый запрос.
  Ошибка подключённого Redis (например, таймаут команды 500 мс) — `warn`.

Redis — не источник истины: списание решается только по `users.balance`
под блокировкой, а кэш лишь ускоряет чтение. Поэтому допустимо, что `GET`
ненадолго вернёт устаревший баланс. Пример: `GET` промахнулся мимо кэша и
прочитал старый баланс, параллельный `debit` закоммитился и сделал `DEL`,
после чего `GET` положил старое значение в кэш. Другой пример: `debit`
прошёл, пока Redis был недоступен, и `DEL` пропущен — после восстановления
Redis отдаёт значение, закэшированное до сбоя. В обоих случаях устаревание
ограничено TTL.

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
| `503` | `LOCK_TIMEOUT` | пользователь занят параллельными операциями дольше `lock_timeout`; ответ с `Retry-After` |
| `503` | `SERVICE_BUSY` | нет свободного соединения с БД дольше 5 с; ответ с `Retry-After` |
| `500` | `INTERNAL_ERROR` | всё непредвиденное; детали только в логах |

Прочие ошибки фреймворка получают код по имени статуса: неизвестный
маршрут — `404 NOT_FOUND`, слишком большое тело — `413 PAYLOAD_TOO_LARGE`.
Любой `400`, включая невалидный JSON, — `VALIDATION_ERROR`; несколько
нарушений валидации склеиваются в `message` через `; `.

## Безопасность

Настраивается в `main.ts` и `app.module.ts`:

- **helmet** — стандартные заголовки безопасности (`X-Content-Type-Options`,
  `Strict-Transport-Security` и др.), убирает `X-Powered-By`.
- **CORS** — разрешённые origin из `CORS_ORIGIN` (список через запятую);
  по умолчанию CORS выключен.
- **Rate limit** — `@nestjs/throttler`, глобально `THROTTLE_LIMIT` (100)
  запросов в минуту с IP, превышение — `429`. Счётчики в памяти процесса:
  для одного инстанса этого достаточно, при масштабировании хранилище
  переносится в Redis.
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
- exception filter логирует непредвиденные `500` со стеком (`error`),
  перегрузку (`503 LOCK_TIMEOUT` и `SERVICE_BUSY`) — `warn` без стека,
  причину `4xx` — `debug`: статус уже есть в строке middleware;
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
- **Пул и таймауты БД** — пул на 10 соединений, `lock_timeout` 2 с,
  `statement_timeout` 10 с, ожидание соединения из пула — до 5 с. Поток
  запросов к одному пользователю ждёт на `FOR UPDATE`, держа соединения
  пула, и может ненадолго занять его целиком. Таймауты ограничивают, как
  долго это длится: списание под блокировкой занимает миллисекунды, так что
  2 с ожидания — уже перегрузка. Истёк `lock_timeout` — `503 LOCK_TIMEOUT`,
  ожидание пула — `503 SERVICE_BUSY`, оба с `Retry-After`: это ожидаемая
  перегрузка, а не сбой, и повтор с тем же `Idempotency-Key` безопасен.
  Истёк `statement_timeout` — `500`: запрос под блокировкой не должен идти
  10 с, это сбой. CLI миграций работает без таймаутов, чтобы долгий DDL не падал.
- **Схема** — только через миграции, `synchronize: false`: ревьюер видит
  точный DDL.
- **Тесты** — три уровня:
  - unit (без Docker): `bigint.transformer`, валидация env;
  - интеграционные на [Testcontainers](https://testcontainers.com/) — то,
    что моки не ловят: параллельные `debit`, идемпотентность под гонкой,
    ограничения схемы, пересчёт через `SUM`, `lock_timeout`. После каждого
    сценария проверяется инвариант из ADR-0004;
  - e2e (supertest + Testcontainers, полный `AppModule`) — HTTP-контракт:
    валидация, коды и формат ошибок из таблицы выше, `Retry-After`.
