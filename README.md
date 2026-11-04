# Household Finance Dashboard — Project Proposal

## 1. Overview

A self-hosted web application that gives a household one clear, current view of its finances: income, expenses, investments, mortgage, and upcoming cash-flow events. The app has three parts: a database, an API service, and a web client. All three are deployed with Docker Compose.

**Goals**

- Show an up-to-date financial picture on a single dashboard.
- Get values from **live bank integrations** where they're available, and from **projection formulas** where they're not.
- Track income timing (paycheques), deductions, and recurring expenses on a calendar.
- Model the mortgage and its terms.
- Start as a single-user app, with a path to **multi-user household aggregation** later.
- Treat testing and documentation as part of the product, not something added afterward.

**Non-goals (for now, per YAGNI)**

- Budget enforcement, bill payment, or moving money.
- Tax filing or tax optimization.
- A native mobile app (the responsive web UI covers mobile).
- Live bank integrations in v1 (the design leaves room for them; see §5).

---

## Quick start

The [Svelte frontend](frontend/README.md), using Bootstrap 5 and Sveltestrap
components compatible with Svelte 5, connects to the
[backend](backend/README.md) using a central SQLite database (1 GiB cap), Drizzle ORM,
Fastify, and Zod.
The implemented slice includes household setup, members, manual accounts,
balance history, per-currency financial summaries, and categorized one-off expenses
with monthly totals, editing, and archiving. Manual CAD investment accounts also
support reviewed Sun Life PDF and Questrade XLSX imports with historical investment breakdowns
and an original-document archive.
The remaining finance
modules in this document are planned.

With Docker Compose installed, run from the project root in PowerShell:

```powershell
Copy-Item backend\.env.example backend\.env
docker compose up --build -d --wait
# Open http://127.0.0.1:8080
```

Skip copying the environment file if it already exists. Docker Compose 2.20+
is required for the root configuration's `include`.

### Node.js with nvm-windows

The project pins Node.js in [.nvmrc](.nvmrc). With nvm-windows, run these commands
from the project root (an elevated terminal may be required for `nvm use`):

```powershell
$nodeVersion = (Get-Content .nvmrc -Raw).Trim()
nvm install $nodeVersion
nvm use $nodeVersion
node --version
npm ci
```

nvm-windows does not automatically select a version from `.nvmrc`.
`nvm use` changes the shared Node.js symlink, including for other terminals;
coordinate with any other running projects. Node.js 22.22+ is required.

### Local development

Start the backend and frontend in separate terminals (the backend creates and
migrates `backend\data\studious.sqlite` on first start; no database server needed):

```powershell
Copy-Item backend\.env.example backend\.env  # if it does not exist yet
npm run dev:backend
# In a second terminal:
npm run dev:frontend
# Open http://127.0.0.1:5173
```

The backend command loads `backend\.env` through the workspace.
See the [backend guide](backend/README.md) for migrations, API examples, and tests.
See the [frontend guide](frontend/README.md) for UI structure and browser tests.
The backend separates models, JSON views, controllers, services, repositories,
routes, and middleware; see its [architecture guide](backend/README.md#architecture-mvc-with-services-and-repositories).
The API is local-only and does not implement authentication yet.

### Deploy the frontend to GitHub Pages

GitHub Pages hosts only static files, so it serves the Svelte frontend. All data
lives in **one central SQLite database** owned by the API container
(`docker compose up`), which you host yourself; the Pages site calls that API.
Every browser and device sees the same data.

1. Push the repository to GitHub, then **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables**: add
   `STUDIOUS_API_URL`: the public HTTPS URL of your API (for example a
   Cloudflare Tunnel or Tailscale Funnel hostname that forwards to
   `127.0.0.1:3000`). `http://127.0.0.1:3000` also works when only this
   computer uses the site. The workflow refuses any other `http://` URL.
3. Allow the Pages origin on the API (exact origin, no path), e.g. in `backend\.env`
   or before `docker compose up`:
   `CORS_ORIGINS=https://<user>.github.io`
4. Push to `main` (or run the workflow manually). [deploy-pages.yml](.github/workflows/deploy-pages.yml)
   runs the frontend tests, builds with the repository sub-path (`/<repo>/`, or `/`
   for `<user>.github.io`) and publishes `frontend/dist`.

The API has **no authentication** yet: protect the public URL with an access
layer on the tunnel/proxy (e.g. Cloudflare Access) before putting financial data
behind it. With a loopback URL, browsers may ask permission the first time the
public site connects to a local address; allow it for your Pages site.
Database size, the `507` storage-full response and backups are described in the
[backend guide](backend/README.md#central-database-and-storage-cap).
Household IDs are stored per origin, so note your household ID before switching
from the local frontend to the Pages site.

---

## 2. Architecture

```
┌──────────────┐     HTTPS/JSON     ┌──────────────┐      SQL      ┌──────────────┐
│   client     │ ─────────────────► │     api      │ ────────────► │      db      │
│ (web UI/SPA) │ ◄───────────────── │ (REST, TS)   │ ◄──────────── │ (SQLite file)│
└──────────────┘                    └──────┬───────┘               └──────────────┘
                                           │ adapter interface
                                    ┌──────▼───────┐
                                    │ integrations │  (future: bank/brokerage
                                    │   worker     │   providers, scheduled sync)
                                    └──────────────┘
```

### 2.1 Services (docker compose)

| Service            | Responsibility                                       | Notes                                                   |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------- |
| `client`           | Renders the UI and calls the API only                | Static build served by a small web server (e.g., nginx) |
| `api`              | Business logic, validation, persistence, projections | Stateless; owns the DB schema and migrations            |
| `sqlite-data`      | Central SQLite database file (volume on `api`)       | Single writer; 1 GiB cap; backed up with `VACUUM INTO`  |
| `worker` _(later)_ | Scheduled syncs from external providers              | Added only when the first integration is built          |

> **Pragmatic note (KISS):** "Microservices" here means separate, independently deployable containers with clear boundaries. It does not mean many fine-grained services. Split the API further only if a real need comes up.

### 2.2 Proposed Stack

This stays close to your previous stack (TypeScript, npm, Prettier, an ORM) and updates the parts that matter for this project:

| Concern    | Previous         | Proposed                           | Why                                                                           |
| ---------- | ---------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| Language   | TypeScript       | TypeScript (strict)                | Unchanged                                                                     |
| API        | Express          | Fastify                            | Routing, lifecycle hooks, structured logging, and request injection for tests |
| UI         | Handlebars (SSR) | Svelte 5 + Vite                    | Static SPA; the initial dashboard needs neither SSR nor a server-side router  |
| DB         | SQLite           | SQLite (central, via the API)      | One shared file; small household data; no DB server to run                    |
| ORM        | Sequelize        | Drizzle                            | Type-safe models and first-class SQL migrations                               |
| Validation | —                | Zod (shared)                       | One schema used by client and API (DRY)                                       |
| Charts     | —                | Chart.js or ECharts                | Framework-agnostic and Svelte-friendly; pick one and use it everywhere        |
| Tooling    | npm, Prettier    | npm workspaces, Prettier, ESLint   | Monorepo with shared packages                                                 |
| Tests      | —                | Vitest, Fastify inject, Playwright | Unit, API, and end-to-end tests                                               |

### 2.3 Repository Layout (single git repo, npm workspaces)

```
/
├─ backend/           # Implemented: REST API, SQLite models, migrations, Compose
│  └─ api/            # Implemented: distributable @studious/api client and contracts
├─ frontend/          # Implemented: Svelte SPA, API client, browser tests, nginx container
├─ compose.yaml       # Implemented: client + backend Compose stack
├─ packages/
│  ├─ domain/         # Pure finance logic (projections, amortization, schedules) — no I/O
│  └─ contracts/      # Shared types + Zod schemas for API requests/responses
├─ docs/              # Architecture, ADRs, API docs, testing guide
└─ .github/ or azure-pipelines.yml  # CI
```

`packages/domain` contains all of the financial math, written as pure functions. This keeps the math testable and lets it exist in exactly one place.

`backend/`, `frontend/`, root Compose, and the model documentation are implemented.
Backend and browser tests use isolated in-memory SQLite databases. The backend-owned
[`@studious/api` package](backend/api/README.md) distributes shared contracts and a
typed HTTP client to the frontend. The domain package, other shared packages,
and CI above are planned.

---

## 3. Functional Areas

### 3.1 Dashboard

- **Net worth summary**: assets (accounts and investments) minus liabilities (mortgage and debts).
- **Cash-flow summary**: income and expenses for the current month, with the net result.
- **Upcoming events**: the next paycheques, bills, and mortgage payments.
- **Investment snapshot**: current value per account and its projected value.
- **Mortgage snapshot**: remaining balance, equity, and payoff date.
- Configurable date range (month, quarter, year, custom).
- Each value is labelled with its **source**: `Live`, `Manual`, or `Projected`.

### 3.2 Accounts & Balances

- Account types: chequing, savings, investment, credit, loan, and mortgage.
- Investment sub-types: TFSA, RRSP (individual, spousal, group), FHSA, RESP, RDSP, RRIF, LIRA, LIF, DCPP, DBPP, DPSP, and non-registered.
- Each account gets its balance from one **balance source**:
  - **Manual**: the user enters snapshots.
  - **Projected**: calculated by formula (see §3.5).
  - **Integrated** _(future)_: synced from a provider.
- Balance history is kept so trends can be charted.

### 3.3 Income

- Income streams (salary, side income, benefits) per household member.
- Pay schedule: weekly, bi-weekly, semi-monthly, monthly, or one-off.
- Gross pay, a list of **deductions** (tax, CPP, EI, pension, benefits, RRSP match, etc.), and the resulting net pay.
- Paycheques generated from the schedule appear on the calendar automatically.

### 3.4 Expenses

- Recurring expenses (utilities, subscriptions, insurance) and one-off expenses.
- Categories and optional tags.
- Recurrence rules that use the same schedule engine as income (DRY).
- CSV import as the first data-entry shortcut, ahead of any live integration.

### 3.5 Investments & Projections

- Holdings per account: initial investment, recurring contributions, and expected annual rate of return.
- Projection engine in `packages/domain`. Your formula is the starting point:

  $$V = (P + D) \times (1 + r)$$

  **Decision:** use compounding growth, which grows the balance period over period and credits each contribution from the date it was made:

  $$V_t = P(1+i)^{n} + \sum_{k=1}^{n} C_k (1+i)^{\,n-k}$$

  where _P_ is the initial investment, _C_k_ is the contribution in period _k_, _i_ is the periodic rate, and _n_ is the number of periods.

- Charts comparing projected and actual values (once actual data exists).
- Scenario inputs (rate, contribution amount) adjustable in the UI with live chart updates.

### 3.6 Mortgage

- Inputs: principal, rate, fixed or variable, amortization period, term length, payment frequency (monthly, bi-weekly, accelerated bi-weekly, weekly), start date, and prepayments.
- **Decision:** interest compounds **semi-annually by default** (Canadian convention for fixed-rate mortgages). Compounding frequency is a per-mortgage setting.
- Outputs: amortization schedule, interest vs. principal over time, remaining balance, equity, term-renewal date, and the effect of prepayments.
- Mortgage payments are placed on the calendar automatically.

### 3.7 Calendar

- Month and agenda views.
- Event sources: paycheques, recurring expenses, mortgage payments, investment contributions, and custom reminders (e.g., mortgage renewal, RRSP deadline).
- Every recurring item is driven by **one recurrence engine** shared across modules.
- Clicking an event shows the item it came from.

### 3.8 Household & Multi-User _(phased)_

- **v1:** one user, but data is already scoped by `householdId`, and records have an optional `memberId` so they can be attributed to a person.
- **Later:** authentication, multiple users per household, roles (owner/member/viewer), and dashboards that show combined totals or a breakdown per member.
- Scoping data by household from day one means multi-user can be added without a schema rewrite. Building auth now is not needed (YAGNI).

### 3.9 Visualizations

- Net worth over time (line chart).
- Income vs. expenses by month (bar chart).
- Expenses by category (donut chart).
- Investment growth, projected vs. actual (line chart with a band).
- Mortgage balance and equity (area chart).
- All charts use one shared chart wrapper component (DRY, consistent styling).

---

## 4. UI / UX Principles

- **Simple first**: the dashboard answers "where do we stand?" without any clicks.
- Consistent layout: side navigation, page header, then content cards.
- Inline add and edit wherever possible, and forms are validated with the shared Zod schemas.
- Responsive design for phone, tablet, and desktop. Light and dark themes.
- Accessible: keyboard navigation, sufficient contrast, and labelled charts.
- Currency and date formatting are locale-aware (default `en-CA`, CAD).

---

## 5. Integrations (Extensible by Design)

- Integrations are defined by a `BalanceProvider` / `TransactionProvider` **interface** in the API (DIP, OCP).
- Each provider is an adapter. Adding one should not require changing the dashboard or domain code.
- Candidate providers: bank aggregators (e.g., Plaid, Flinks), brokerage exports, and CSV/OFX import.
- **CSV import is the first "integration"** because it's simple and immediately useful (KISS).
- Credentials and tokens are stored encrypted and never sent to the client.
- Sync runs in the `worker` service and is introduced only when the first live provider is built.

---

## 6. Data Model (High Level)

```
Household 1─* Member
Household 1─* Account ─* BalanceSnapshot
Account   1─0..1 ProjectionSettings
Account   1─0..1 MortgageTerms ─* Prepayment
Household 1─* IncomeStream ─* Deduction
Household 1─* Expense
IncomeStream / Expense / MortgageTerms / Contribution ─ RecurrenceRule
Household 1─* IntegrationConnection (future)
```

- **Decision:** every household-owned table carries a required `householdId`, and all queries are scoped by it.
- Money is stored as two-place decimal strings (summed as integer cents), never as floating point.
- Every table has `createdAt` and `updatedAt`. Soft deletes are used where history matters.

---

## 7. Testing Strategy

Tests are written alongside features. A feature is not "done" until its tests and docs exist.

| Layer             | Tool                             | Scope                                                                                            |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| Unit              | Vitest                           | `packages/domain`: projections, amortization, recurrence, deductions. Target ~100% coverage here |
| Contract          | Vitest + Zod                     | Request/response schemas in `packages/contracts`                                                 |
| API / Integration | Vitest + Supertest               | Endpoints against a real in-memory SQLite database                                               |
| UI component      | Vitest + @testing-library/svelte | Forms, charts, calendar rendering                                                                |
| End-to-end        | Playwright                       | Key user journeys run against the full `docker compose` stack                                    |

- `docker-compose.test.yml` brings up a disposable DB for the integration and E2E tests.
- Seed fixtures provide a realistic household for tests and local development.
- CI runs lint, format check, type check, all tests, and the Docker build on every PR.
- `docs/testing.md` explains how to run, write, and debug each test type.

---

## 8. Documentation

### Formatting

Install the development dependency with `npm ci` (Node.js and npm required).
Run `npm run format` to format supported files, or `npm run format:check` to
check formatting without changing files. Prettier uses the root configuration
and ignores dependency, build, and coverage output.

### Project documents

- [backend/README.md](backend/README.md): implemented backend setup, API, migrations, and testing.
- `README.md`: what the app is, quick start (`docker compose up`), and links to the other docs.
- `docs/architecture.md`: services, boundaries, and data flow.
- `docs/model.md`: individual data model definitions and their combined ERD.
- `docs/adr/`: Architecture Decision Records (one short file per significant decision).
- `docs/api.md` or a generated OpenAPI spec from the shared schemas.
- `docs/testing.md`: the testing guide.
- `CONTRIBUTING.md`: branching, commit conventions, and PR checklist.

---

## 9. Operations

- `docker compose up` starts the full stack locally.
- Configuration comes from `.env`, and a `.env.example` is committed.
- DB migrations run automatically when the API starts (or through a dedicated one-shot service).
- Health check endpoints (`/health`) are used by Docker for each service.
- Structured JSON logging. Errors fail fast and are reported with context.
- Scheduled DB backups to a mounted volume.

---

## 10. Design Principles Applied

| Principle                      | How it shows up                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **DRY**                        | Shared Zod contracts, a single recurrence engine, finance math only in `packages/domain`, one chart wrapper        |
| **KISS**                       | Three containers, a REST API, CSV before live integrations                                                         |
| **YAGNI**                      | No auth, worker, or provider adapters until they're needed; schema is ready but features wait                      |
| **Separation of Concerns**     | UI, API, domain, and persistence are separate layers; domain code has no I/O                                       |
| **Modularity / High Cohesion** | Feature modules (income, expenses, investments, mortgage, calendar), each with its own routes, services, and tests |
| **SRP**                        | Each service or module has one reason to change (e.g., `AmortizationCalculator` only does amortization)            |
| **OCP**                        | New integrations and account types are added as new adapters/strategies, not by editing existing code              |
| **LSP**                        | Every `BalanceProvider` (manual, projected, integrated) can be swapped without callers noticing                    |
| **ISP**                        | Small interfaces (`BalanceProvider`, `TransactionProvider`) instead of one large "BankClient"                      |
| **DIP**                        | Domain and API services depend on interfaces; concrete repositories and providers are injected                     |
| **Fail-Fast**                  | Schema validation at every boundary, strict TS, startup config validation, no swallowed errors                     |
| **Law of Demeter**             | The client talks only to the API; modules call each other's public service interfaces, not their internals         |
| **Readability & Testability**  | Pure domain functions, dependency injection, a lint/format/test gate in CI                                         |

---

## 11. Phased Roadmap

| Phase                | Scope                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| **0 — Foundation**   | Monorepo, Docker Compose, CI, lint/format/test tooling, docs skeleton                                      |
| **1 — MVP**          | Accounts (manual balances), income with deductions, expenses, recurrence engine, calendar, basic dashboard |
| **2 — Planning**     | Investment projections, mortgage module with amortization, visualizations                                  |
| **3 — Data in**      | CSV/OFX import, balance history, projected vs. actual comparison                                           |
| **4 — Household**    | Authentication, multiple members, combined and per-member dashboards                                       |
| **5 — Integrations** | Worker service, first live bank/brokerage provider via the adapter interface                               |

---

## 12. Decisions

| Decision               | Choice                                                           |
| ---------------------- | ---------------------------------------------------------------- |
| Database               | Central SQLite owned by the API (1 GiB cap)                      |
| UI framework           | Svelte                                                           |
| Investment projections | Compounding growth with time-weighted contributions              |
| Data scoping           | Organized by household from v1 (`householdId` on all owned data) |
| Mortgage compounding   | Semi-annual by default, configurable                             |

## 13. Open Questions

- Self-host only, or possibly expose externally later? This affects how soon auth and TLS are needed.
- Which bank or brokerage is most important to integrate first?
- How much history to keep (snapshot frequency, retention)?
