# balance-ledger-service

Сервис баланса на базе леджера: каждое списание записывается как
неизменяемая запись в истории, а баланс пользователя (`users.balance`)
после каждой операции пересчитывается по всей истории в той же транзакции —
см. [ADR-0004](docs/adr/0004-balance-recalculation-from-ledger.md).

## Стек

NestJS + TypeScript, PostgreSQL + TypeORM, Redis (кэш баланса). Библиотеки
и их назначение — в [architecture.md](docs/architecture.md#стек).

## Документация

- [docs/task.md](docs/task.md) — исходное ТЗ и где закрыт каждый пункт.
- [docs/architecture.md](docs/architecture.md) — модули, модель данных,
  потоки запросов, ошибки.
- [docs/adr/](docs/adr/README.md) — ключевые решения и альтернативы.
- [docs/milestones.md](docs/milestones.md) — план реализации по этапам.

## API

| Метод | Путь                 | Описание                                                 |
|-------|----------------------|----------------------------------------------------------|
| POST  | `/users/:id/debit`   | Списание с баланса. Требует заголовок `Idempotency-Key`. |
| GET   | `/users/:id/balance` | Текущий баланс (кэшируется).                             |

Суммы — целые числа в центах ([ADR-0001](docs/adr/0001-money-representation.md)):

- `POST /users/:id/debit` → `200 { "balance": 90000, "ledgerEntryId": 2 }`
  (и для нового списания, и для повтора с тем же ключом);
- `GET /users/:id/balance` → `200 { "balance": 90000 }`.

Коды ошибок — в [architecture.md](docs/architecture.md#обработка-ошибок),
интерактивная документация — на `/docs` (Swagger).

## Запуск

Требования: Node.js 22+ (`.nvmrc`), Docker.

```bash
cp .env.example .env
docker compose up -d        # Postgres + Redis
npm install
npm run migration:run       # схема + пользователь id = 1 с балансом $1000
npm run start:dev
```

API — `http://localhost:3000`, Swagger — `http://localhost:3000/docs`.

## Тесты

```bash
npm run test                # unit
npm run test:integration    # Testcontainers, нужен Docker
```

## Пример

Покупка предмета за $100 (`10000` центов) пользователем `id = 1`:

```bash
curl -X POST http://localhost:3000/users/1/debit \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 3f1e9c2e-1c1a-4b0b-9a8a-000000000001" \
  -d '{"amount": 10000}'

curl http://localhost:3000/users/1/balance
```
