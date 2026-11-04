# PostgreSQL Backend

The backend is an independent npm workspace containing:

- **PostgreSQL 17** for persistent storage.
- **Drizzle ORM** as the typed model abstraction over the `pg` connection pool,
  with checked-in SQL migrations managed by Drizzle Kit.
- **Fastify** for HTTP routing, household-scoping hooks, structured logging, and
  centralized error handling.
- **Zod** for strict request and environment validation.

The implementation covers households, members, manual accounts, balance snapshots,
expense categories, one-off expenses with monthly currency totals, and Sun Life
PDF snapshot imports with archived original documents.
The other entities in [the model document](../docs/model.md)
remain planned; this is a backend foundation, not the complete finance app.

## Requirements

- Node.js 22.22 or newer and npm.
- Docker with Compose and Linux containers (also required for integration tests).
- An available local port for PostgreSQL (default `5432`) and the API (`3000`).

For nvm-windows, follow the root [Node version setup](../README.md#nodejs-with-nvm-windows).

## Run everything in Docker

From the project root, using PowerShell:

```powershell
Set-Location backend
Copy-Item .env.example .env
docker compose up --build -d --wait
Invoke-RestMethod http://127.0.0.1:3000/health
```

Compose starts PostgreSQL, runs the migrations once, and starts the API only
after migration succeeds. Data is stored in the `postgres-data` named volume.
`docker compose down` stops the services without deleting that volume.

The example credentials are for local development only. Replace them before
shared use. If using special characters in credentials, URL-encode them in
`DATABASE_URL`; Compose's interpolated connection URL assumes URL-safe values.

Both published ports bind to loopback. There is deliberately **no authentication
yet**, following the v1 proposal. Household IDs scope queries and database
relationships but do not authorize callers. Do not expose this service publicly
or use it on an untrusted network.

`CORS_ORIGINS` (comma-separated exact origins, empty by default) lets a
separately hosted frontend such as GitHub Pages call the API from the browser.
Only the listed origins receive CORS headers; credentials are not allowed and
wildcards or paths are rejected at startup. With Docker Compose, set it in the
shell or `.env` before `docker compose up`. Allowing an origin does not add
authentication: keep the API on loopback.

## Develop locally

From the project root:

```powershell
npm ci
Set-Location backend
Copy-Item .env.example .env
docker compose up db -d --wait
npm run db:migrate
npm run dev
```

The root `npm run build`, `npm run typecheck`, and `npm test` commands now cover
all workspaces. Append `--workspace @studious/backend` to the inner
workspace command when verifying the backend alone.

Skip `Copy-Item` if `.env` already exists. Configure `DATABASE_URL` there to use
an existing PostgreSQL server instead of the Compose database. If you change
`POSTGRES_PORT`, update `DATABASE_URL` for the local process too.
When using Docker for the API, stop that API before starting local development
on the same port.

Local development defaults to `127.0.0.1:3000`. The server validates configuration
and checks its database connection before listening. `SIGINT` / `SIGTERM` close
the HTTP server and database pool.

## Layout

```text
backend/
  api/              # Distributable @studious/api contracts and HTTP client
  src/
    models/         # Drizzle models and inferred domain types
    db/             # PostgreSQL pool and migration runner
    repositories/   # Typed persistence operations; no HTTP dependencies
    services/       # Application rules; no Fastify dependencies
    controllers/    # Parse requests, call services, select JSON views
    views/          # Explicit JSON response presenters
    routes/         # Route declarations and middleware wiring
    middleware/     # Household context and centralized error mapping
    app.ts          # Dependency composition and application factory
    config.ts       # Validated environment settings
    server.ts       # Startup and graceful shutdown
    validation.ts   # Shared API validators plus server-only Date conversion
  drizzle/          # Generated SQL migrations and schema metadata
  test/             # Unit and real-PostgreSQL API tests
  compose.yaml
  Dockerfile
```

## Architecture: MVC with services and repositories

```text
HTTP request -> routes -> middleware -> controller -> service -> repository -> PostgreSQL
                                             |
HTTP response <--------------------------- JSON view
```

- **Models**: [the Drizzle schema](src/models/schema.ts) defines the database
  model and inferred TypeScript types. Changes are deployed through migrations.
- **Controllers**: [HTTP handlers](src/controllers/finance.ts) parse input,
  call services, and choose response status and presentation. No SQL or
  financial rules live here.
- **Views**: [JSON presenters](src/views/finance.ts) explicitly allowlist response
  fields and serialize dates. Database rows are not sent directly to clients.
  An API does not need server-rendered HTML templates.
- **Public API distribution**: [`@studious/api`](api/README.md) provides the
  contracts, request validators, enum values, and HTTP client consumed by the
  frontend. Presenters return its DTO types; database models are not distributed.
- **Services**: [application operations](src/services/finance.ts) enforce
  account existence and supported balance sources. They depend on an injected,
  typed repository and use application errors rather than HTTP response objects.
- **Repositories**: [persistence operations](src/repositories/finance.ts) own
  Drizzle queries, scoping, ordering, and soft-deletion filters, without HTTP code.
- **Middleware**: [the household hook](src/middleware/household.ts) validates the
  household ID, loads it once, and attaches request context.
  [The error handler](src/middleware/errors.ts) logs failures and maps validation,
  application, and database errors to safe HTTP responses.
- **Composition**: [the application factory](src/app.ts) wires dependencies
  explicitly; only the server entry point starts a listener or owns the pool.

Every repository operation on owned data includes its household ID; composite
foreign keys also reject cross-household references outside the API.
Modules are grouped by layer for this small foundation. Split controllers and
services by feature as those modules grow; do not introduce generic base
controllers, a dependency-injection container, or a second ORM abstraction.

- IDs are database-generated UUIDs.
- Money uses PostgreSQL `NUMERIC(14,2)` and **decimal strings** in JSON, such as
  `"1234.56"`; JavaScript floating-point conversion is not used.
- Timestamps are timezone-aware and serialized as ISO 8601 strings.
- `updatedAt` is maintained by Drizzle on updates; direct SQL writers must set
  it themselves.
- Accounts are soft-deleted; balance snapshots have no update/delete endpoints.
- Account type, currency, and balance source cannot be patched. This avoids
  reinterpreting historical balances. Only the manual source is accepted by
  the initial API.
- Constraint conflicts return `409`; invalid input returns `400`; missing
  resources return `404`. Unexpected errors are logged and return a generic
  `500` response, not database details.

## API

All routes accept/return JSON unless the response is `204`.
`{householdId}` and `{accountId}` must be UUIDs.

| Method     | Path                                                      | Purpose                                                                  |
| ---------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| GET        | `/health`                                                 | Database readiness; `200` when connected, `503` otherwise                |
| POST       | `/households`                                             | Create `{ "name": "Home", "defaultCurrency": "CAD" }`                    |
| GET        | `/households/{householdId}`                               | Read household                                                           |
| GET / POST | `/households/{householdId}/members`                       | List / create `{ "name": "Alex" }`                                       |
| GET / POST | `/households/{householdId}/accounts`                      | List active / create account                                             |
| GET        | `/households/{householdId}/accounts/{accountId}`          | Read active account                                                      |
| PATCH      | `/households/{householdId}/accounts/{accountId}`          | Update `name` and/or nullable `memberId`                                 |
| DELETE     | `/households/{householdId}/accounts/{accountId}`          | Archive account; `204`                                                   |
| GET        | `/households/{householdId}/accounts/{accountId}/balances` | Newest-first history; `limit` (1-500, default 100), `offset` (default 0) |
| POST       | `/households/{householdId}/accounts/{accountId}/balances` | Append manual snapshot                                                   |
| GET / POST | `/households/{householdId}/expense-categories`            | List / create category `{ "name": "Groceries" }`                         |
| GET        | `/households/{householdId}/expenses?month=2026-01`        | Monthly active expenses, pagination, and full-month totals by currency   |
| POST       | `/households/{householdId}/expenses`                      | Create one-off expense                                                   |
| PATCH      | `/households/{householdId}/expenses/{expenseId}`          | Edit one or more expense input fields                                    |
| DELETE     | `/households/{householdId}/expenses/{expenseId}`          | Archive expense; `204`                                                   |

### One-off expenses

Expense input is `{ "name": "Groceries", "amount": "42.15", "currency": "CAD",
"startDate": "2026-01-31", "categoryId": null, "memberId": null }`.
Currency defaults to CAD on creation; member/category are optional and nullable.
Amounts must be positive decimal strings with exactly two places, up to
`999999999999.99`. Dates are calendar dates (`YYYY-MM-DD`, years 1000–9999), not
timestamps. Patches only change explicitly supplied fields; currency, amount,
date, name, category, and member can be corrected.

The list requires `month=YYYY-MM`, with `limit` (1–500, default 100) and `offset`
(0–1000000, default 0). It returns `{ items: Expense[], totals: [{ currency,
amount }] }`, ordered by date descending, then ID descending. Totals sum **all**
active expenses in that month, not only the requested page. PostgreSQL computes
them with exact numeric arithmetic in the same repeatable-read transaction as
the list; aggregate amounts may exceed the single-expense amount limit.
Archived expenses remain stored but cannot be edited or re-archived.

Category names are trimmed and unique within each household (case-sensitive).
Cross-household member/category references are rejected by composite foreign
keys. Category rename/delete, recurrence rules, payment status, and tags are not
implemented. Recording or archiving an expense does not change account balances.

Create a household and account, then record a balance:

```powershell
$household = Invoke-RestMethod http://127.0.0.1:3000/households `
  -Method Post -ContentType application/json -Body '{"name":"Home"}'
$base = "http://127.0.0.1:3000/households/$($household.id)"
$account = Invoke-RestMethod "$base/accounts" `
  -Method Post -ContentType application/json `
  -Body '{"name":"Chequing","type":"CHEQUING","currency":"CAD"}'
Invoke-RestMethod "$base/accounts/$($account.id)/balances" `
  -Method Post -ContentType application/json `
  -Body '{"amount":"1234.56","asOf":"2026-01-01T00:00:00Z"}'
```

Save the returned household ID; household discovery and authentication are not
implemented yet. Account types are `CHEQUING`, `SAVINGS`, `INVESTMENT`, `CREDIT`,
`LOAN`, and `MORTGAGE`. Negative balances are allowed; signed amounts are not
automatically normalized by account type.

## Sun Life PDF imports

Select or create a **manual CAD investment account** in the UI, then upload a
Sun Life PDF, review the detected closing plan value/date, and confirm the import.
Preview does not write anything. Confirmation re-parses the uploaded bytes and
atomically inserts a manual balance snapshot and the original PDF into PostgreSQL.
The archived PDF is stored as `bytea`, not on an ephemeral container filesystem;
the existing database volume and database backups include it.

The **My investments** section is also extracted into historical rows containing
fund name, category when present, units, unit price, and closing value. Units and
prices are decimal strings (up to eight fractional places), not floating-point
numbers. The table's price and value dates must match the statement closing date,
and row values must sum exactly to both Total investments and the plan balance.
Rounded displayed unit prices are not multiplied to replace the reported value.
A missing section returns `investments: null` with a visible review warning;
a present but incomplete/inconsistent section rejects the import rather than
silently discarding investments. Ongoing contribution allocation percentages are
not part of this table and are not imported.

Investment rows are saved in the archive's `investments` JSONB column alongside
the snapshot and PDF in the same transaction. They describe the recorded balance,
not independent accounts or additional net worth. They do not create or overwrite
the planned editable `Holding` model. Older archives have a null breakdown; use
**Extract investments from archived PDF** in their investment details to re-parse
the original. This only updates derived investment metadata after verifying the
PDF hash/date/balance/currency against the archive. It does not create a snapshot,
change the original PDF, or bypass household/account scoping.

The parser supports the English Canadian statement layout with a statement period
and `Value of my plan on ...` totals. It matches the closing-period date rather
than guessing from the largest amount or taking an opening balance. It rejects
conflicting totals, unrecognized layouts, scans without text, encrypted/damaged
PDFs, files over 10 MiB, and documents over 25 pages. CAD is assumed for this
Canadian layout; detected USD statements are rejected. There is no OCR or external
AI/document service. Parsing runs in a separate Node process with a 128 MiB V8 heap,
a 15-second deadline, bounded extracted text, and at most two concurrent parsers.
These limits contain failures; they are not an OS security sandbox or malware scan.

| Method | Path (relative to `/households/{householdId}/accounts/{accountId}`) | Purpose                                                                                             |
| ------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| POST   | `/statements/preview?filename=statement.pdf`                        | Parse raw `application/pdf`; return `{amount, statementDate, currency, sha256}` without persistence |
| POST   | `/statements?filename=statement.pdf`                                | Parse again, save snapshot + original PDF; return archive metadata (`201`)                          |
| GET    | `/statements?limit=20&offset=0`                                     | Newest-first archive metadata (same limit/offset bounds as balance history)                         |
| GET    | `/statements/{statementId}/pdf`                                     | Download original bytes as an attachment                                                            |
| POST   | `/statements/{statementId}/investments`                             | Extract investment details from an existing archive; return updated metadata                        |

Filenames must end in `.pdf`, contain no paths/control characters, and be at
most 200 characters. The same SHA-256 cannot be imported twice for one account
(including renamed files and concurrent retries); duplicate imports return `409`
without creating extra snapshots. The same PDF may be imported into a different
account, so verify account ownership and avoid double-counting the same plan.
Unsupported PDFs return `422`, size limits `413`, and invalid input `400`.

The statement date is retained as a PostgreSQL `DATE`. Its snapshot timestamp is
the end of that day in UTC (`23:59:59.999Z`), a documented convention rather than
a known observation time. Imported snapshots remain `MANUAL`; archive metadata
links each PDF to its snapshot. Existing newer observations still determine the
dashboard balance when importing an older statement.

Original PDFs and snapshot metadata have no edit/delete endpoint; only derived
investment details can be re-extracted. Account archiving preserves PDFs and
snapshots; metadata/download endpoints remain available using the account ID,
while new imports require an active account. The active-account UI does not
browse archived accounts yet. Downloads are attachment-only with no-store
headers. Household IDs are still **not authorization**: keep this app local,
protect database backups, and do not expose financial PDFs publicly.
Private sample statements under `docs/sunlife/` are excluded from Git and Docker
build contexts; tests use synthetic PDFs instead.

## Questrade XLSX imports

The same investment-account workflow accepts Questrade `InvestmentSummary.xlsx`
exports containing **Balances** and **Positions** worksheets. Select a manual CAD
investment account, choose the workbook, enter its **observation date**, and review
the account total, cash, FX rate, and position breakdown before confirming.
The supplied export contains no valuation date: none is inferred from file
metadata or upload time. That date is explicitly user-supplied and stored using
the same end-of-day UTC snapshot convention as PDF statements.

Exactly one source account per workbook is supported. The snapshot uses **Total
Equity in CAD Combined**, which includes CAD and USD cash and positions using the
export's FX rate. Native CAD/USD cash, combined cash, account type and FX are
retained in archive metadata. Position symbol, description, asset class, quantity,
market price and value are preserved; each position has its native currency.
The position values are not added to the combined account balance a second time.
Cost basis, profit/loss and allocation worksheets are not imported in this slice.
Short positions and currencies other than CAD/USD are not supported.

The read-only XLSX parser runs locally in a separate process with the same
10 MiB input, 128 MiB V8 heap, 15-second deadline and bounded output conventions
as PDF parsing. It accepts up to 500 position rows and 40 columns; multiple
accounts, missing columns, invalid decimals, inconsistent totals, damaged or
encrypted workbooks are rejected visibly. Native position sums must match native
market values; cash plus market values must match equity; combined cash/market
values must match the export FX rate rounded to cents. Decimals are parsed as
strings and reconciled with integer arithmetic, never binary floating-point sums.

The existing preview/import endpoints accept raw
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, with
`?filename=InvestmentSummary.xlsx&statementDate=YYYY-MM-DD`. Extension and media
type must match. Archives now include `provider` (`SUNLIFE` or `QUESTRADE`),
optional `questrade` balance metadata, and native `currency`/`symbol` on
investment rows. Existing archives default to Sun Life.
Use `GET /statements/{statementId}/file` for either original document format;
the older `/pdf` route remains PDF-only. XLSX downloads have their original
filename and spreadsheet media type. For compatibility the PostgreSQL binary
column is still named `pdf`, but holds the original document bytes for either
provider. The PDF, XLSX, snapshot and investment archive workflows share atomic
transactions, account/household isolation and per-account SHA-256 deduplication.
An identical workbook cannot create another snapshot even with a different
observation date.

Private samples under `docs/questrade/` are excluded from Git and Docker build
contexts. Tests use synthetic workbooks; no customer spreadsheets are sent to
external parsing services.

## Migrations

From `backend`, after changing the schema:

```powershell
npm run db:generate
# Review the generated SQL before applying it.
npm run db:migrate
```

Commit generated SQL and metadata together. Migration execution is repeatable:
already-applied migrations are tracked in PostgreSQL. Do not use schema push
against persistent databases. The compiled runner also works with
`node dist/db/migrate.js` after a build.

## Verification

From the project root:

```powershell
npm run typecheck
npm run build
npm test
npm run format:check
```

Service and view unit tests run without HTTP or database dependencies.
Integration tests create an isolated PostgreSQL container on a dynamically assigned port,
apply the checked-in migrations, and exercise the real API with Fastify's
injection client. They do not use or clear your development database. The test
container is stopped after the run. Docker failures fail the suite rather than
silently skipping database coverage.
