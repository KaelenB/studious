# Frontend

A Svelte 5 + TypeScript SPA built with Vite, Bootstrap 5, and
`@sveltestrap/sveltestrap` 7 (whose peer dependencies support Svelte 5).
It connects to the real API, not
mock financial data. Vite is used directly because this first slice has one
dashboard and no server-rendering requirement; SvelteKit's server runtime and
filesystem router are not needed yet.

## Features

- Create a household or reconnect by ID; remember only its ID in local storage.
- Add household members and create, rename, attribute, or archive accounts.
- Classify investment accounts by plan (TFSA, RRSP, FHSA, DCPP, and more); the
  sub-type shows beside the account type and can be changed with **Edit account**.
- Record timestamped balance snapshots and page through their history.
- Set up mortgage terms (rate, compounding, amortization, term, payment
  frequency including accelerated, optional lender payment and property value)
  and see the payment, balance today, equity, next payment split, renewal,
  mortgage-free date, lifetime interest, an interactive chart (balance, balance without prepayments, equity,
  property value, cumulative principal and interest; toggle lines in the legend and read year-end
  values by hovering, tapping or using the arrow keys), and a yearly schedule.
- Add or remove mortgage prepayments to see the interest they save, and record
  the projected mortgage balance as a snapshot with one click.
- View latest balances and recorded asset/debt/net-worth totals per currency.
- Explore combined household net-worth and investment history, asset allocation,
  net worth by member (including shared accounts), monthly category-stacked
  spending, and spending breakdowns. Select 6/12/24/36 months, a historical
  through-date and a currency.
- Read point values with hover, tap or arrow keys; toggle chart series and open
  the monthly net-worth table. Mortgage and overview timelines use `TimeChart`.
  Charts and tooltips fit their card widths; donut legends stack beneath the
  ring in narrow cards and wrap long category names without horizontal overflow.
- Project household net worth 12/24/36/60 months ahead with a dashed scenario
  and a projected-values table. Automatic monthly change averages recorded
  surplus from completed months with both income and expenses in the trailing
  year (at least three required); otherwise it shows a labeled flat scenario.
  Custom signed monthly changes are supported. Missing account balances do not
  block the forecast: known balances are projected with an explicit partial-net-worth
  warning; missing assets and debts remain excluded, not zero. At least one known
  balance is required. Forecasts exclude inflation and separate mortgage amortization;
  incomplete records and transfers can distort surplus.
- Investment forecasts share the net-worth horizon and use an editable effective
  annual growth assumption (illustrative 5% default, not an inferred or guaranteed
  return) compounded monthly, plus month-end contributions (default zero).
  Projected gains also increase projected net worth; contributions are transfers
  from household cash and do not themselves increase net worth. Set growth to zero
  if a custom net-worth change already includes returns. Every investment account
  in the selected currency needs a non-negative balance. Tables separate future
  contributions from growth; fees, taxes and inflation are excluded. Scenario
  inputs are temporary and reset on reload.
- **Load market-based projection** explicitly fetches Yahoo Finance public history
  for tickers in the latest imported statements. The holdings table shows returned
  security names, last daily close, price/history dates, historical CAGR, statement
  weights, coverage and failures. Check ticker identities, especially CAD `.TO`
  defaults. Weighted historical returns replace the manual growth assumption for
  both charts; **Apply investment assumptions** switches back to manual.
  Cash, unmatched funds and foreign-currency positions contribute zero growth
  in the weighted portfolio, without inventing FX returns. Historical performance
  does not predict future returns. Lookup data resets on household/date/currency
  changes and refreshes; no outbound market requests occur until clicked.
- Compare month-to-date, year-to-date and 12-month recorded net-worth changes.
  Month-end balances carry forward; missing observations stay unknown. Growth
  is unavailable when the observed account set changes. Deposits, withdrawals
  and debt repayments affect changes, so these are not investment returns.
  The last month stops at the selected through-date (default today, UTC).
  Archived accounts are excluded throughout history; property values are not
  added as assets. Currencies are never mixed. Expense mutations refresh charts.
- Create expense categories and record one-off expenses with optional category/member.
- Edit or archive expenses, filter by calendar month, and page through 20 rows at a time.
- View exact monthly spending totals by currency across all pages.
- Download a consistent full-server SQLite backup from **Household → Download
  SQLite database**. Includes all households and archived statement documents;
  keep the file private. The live database is unchanged.
- Record, edit and archive historical income by month/member, with exact
  per-currency totals. View combined household monthly income, expenses net of
  refunds, recorded surplus and a cash-flow table on the overview.
- Use **Import history** to upload each yearly budget XLSX. Preview both
  transaction sheets, review every warning/row and match spreadsheet owners to
  household members (or shared ownership) before confirming. Repeated imports
  skip previously imported rows; invalid populated rows block all writes.
  Negative expenses are refunds; extra precision is rounded with a warning.
  Actual cell dates are retained even when they differ from the filename year.
  Original workbooks are not stored in the database; keep your local files.
  Importing income/expenses never changes account snapshots.
- Review Sun Life PDF closing balances before creating manual investment snapshots.
- Download original PDFs from a persistent, paginated per-account archive.
- Review historical investment names, categories, units, precise prices and values.
- Accessible labelled forms, keyboard focus, loading/empty/error states, and a
  responsive desktop/mobile layout.

Recurring income/deductions, recurring expenses, investment projections, calendar, and authentication
are not implemented yet. These sections are not represented by fake data or
nonfunctional navigation.

## Run locally

Select the pinned Node version using the root [nvm-windows instructions](../README.md#nodejs-with-nvm-windows).
After `npm ci` from the root, run the API (which owns the central SQLite database) following
the [backend guide](../backend/README.md), then:

```powershell
npm run dev:frontend
```

Open `http://127.0.0.1:5173`. Requests go to `/api` on the same origin; Vite
proxies them to `http://127.0.0.1:3000`. To change the backend address, copy
`frontend\.env.example` to `frontend\.env` and set `API_TARGET`.
This is a server-side proxy setting, not a credential or browser-exposed variable.

To run the complete container stack, use `docker compose up --build -d --wait`
from the root after creating `backend\.env`. Open `http://127.0.0.1:8080`.
The frontend container runs unprivileged nginx and proxies `/api` to the API;
no permissive CORS configuration is needed. Stop it with `docker compose down`;
the database volume remains.

All ports bind to loopback. The application is not authenticated yet, so expose
the API only behind an access layer you control.
Household IDs are not access controls. Keep the ID if browser storage is cleared;
household discovery is not available.

### Static hosting (GitHub Pages)

`npm run build --workspace frontend` produces a static site in `frontend/dist`.
Two build-time variables adapt it for static hosting:

| Variable            | Default | Purpose                                                              |
| ------------------- | ------- | -------------------------------------------------------------------- |
| `VITE_API_BASE_URL` | `/api`  | Absolute API URL embedded in the bundle (it is public, not a secret) |
| `BASE_PATH`         | `/`     | Site sub-path, e.g. `/studious/` for a project Pages site            |

The API must list the site's origin in `CORS_ORIGINS`. The root guide's
[GitHub Pages section](../README.md#deploy-the-frontend-to-github-pages) covers
the automated workflow. To try a Pages-style build locally:

```powershell
$env:BASE_PATH='/studious/'; $env:VITE_API_BASE_URL='http://127.0.0.1:3000'
npm run build --workspace frontend
```

## Structure

```text
src/
  App.svelte                    # Dashboard state and workflow coordination
  components/
    Setup.svelte                # Household creation/reconnection
    AccountForm.svelte          # Create/edit account
    AccountDetail.svelte        # Balance entry, paginated history, archive
    Expenses.svelte             # Categories, expense forms, monthly totals/history
    Income.svelte               # Dated income receipts, monthly totals and edits
    BudgetImport.svelte         # Historical XLSX preview, member mapping and import
    Overview.svelte             # Household trends and historical cash flow
    Statements.svelte           # PDF preview/confirmation and archive downloads
    StatementInvestments.svelte # Historical investment breakdown
  lib/
    api.ts                      # Configures backend-distributed client; UI labels
    money.ts                    # Integer-cent aggregation and presentation
  app.css                       # Shared responsive design and focus states
e2e/                            # Real in-memory SQLite + API browser tests
```

## UI components

Selecting an account opens **Account overview** above its balance-entry form.
It shows that account's 6/12/24/36-month balance history, monthly and annual
net-worth impact, and a 12/24/36/60-month dashed scenario. Date/range controls
do not change saved records. Recording/importing balances refreshes the overview.
Investment accounts use monthly compounding and contributions or explicitly
requested account-scoped public market history. Other accounts use a signed
monthly balance change (negative repays debt, capped at zero). Mortgage
amortization remains in the detailed mortgage schedule; the overview's generic
scenario does not infer payments or interest. Missing history stays unknown,
and forecasts never include other accounts or household income/expenses.

Use components from `@sveltestrap/sveltestrap` for buttons, forms, inputs,
labels, cards, alerts, badges, loading spinners, tables, and Bootstrap grid rows
and columns. Do not use the older `sveltestrap` package, which targets Svelte 3.
Bootstrap's stylesheet is imported locally in `src/main.ts` before app styles;
there is no CDN dependency or Bootstrap JavaScript bundle. Sveltestrap owns
component interactions. `app.css` contains layout and brand-specific Bootstrap
theme overrides, not a separate form/button framework.

Sveltestrap 7 forwards component events through `on:click` / `on:submit`.
The application still uses Svelte 5 runes for state. Always set `type="submit"`
on form submission buttons and use numeric input props such as `maxlength={200}`.

Components do not access the database. The backend distributes
[`@studious/api`](../backend/api/README.md), which owns HTTP paths, shared request
and response validators, and DTO types. The frontend consumes its typed client
instead of defining its own API. Response DTOs remain separate from server
persistence models. The backend remains responsible for authorization when added, household
scoping, constraints, and all persisted writes.

Financial amounts stay decimal strings across HTTP and use `bigint` cents for
display aggregation. Positive liabilities represent money owed; negative values
represent a credit. Totals exclude accounts without observations and explicitly
warn about incomplete data. Currencies are never mixed. The latest observation
can be historical; the UI labels it as manual rather than claiming it is live.
No financial data or provider tokens are persisted in browser storage.

Expenses use calendar dates rather than instants; the UI preserves the entered
date without timezone conversion. Saving an expense opens its month. Reloading
starts with the current local month. One-off expenses support negative refunds (not zero);
entries do not alter account balances or imply a bill has been paid. Archiving
requires confirmation and excludes the record from monthly totals without
deleting it. Category names are case-sensitive and unique per household.

For Sun Life, select a manual CAD investment account and use **Review PDF**.
Only after you confirm are the detected closing balance and original PDF saved
together. Review does not persist the file. The parser supports the English
Canadian statement-period/plan-value layout, up to 10 MiB and 25 pages, without
OCR or external services. It rejects ambiguous, encrypted, damaged, or
unsupported PDFs instead of guessing. Check the account, currency and date before
confirming; a statement may contain an entire plan, not an individual fund.
Statement dates map to end-of-day UTC for snapshot ordering. Older imports do
not replace newer balances. Duplicate bytes cannot create duplicate snapshots
for the same account. PDFs live in the central SQLite database and survive container restarts;
no financial documents are stored in browser storage. Archived accounts retain
their files, although browsing archived accounts is not yet a UI feature.

The review and each archive's expandable **Investment details** display the
**My investments** table when present. Units/prices retain the PDF precision;
investment values are not counted again in net worth. For older imports, expand
the archive and choose **Extract investments from archived PDF**; this saves the
breakdown without creating another snapshot. The contribution-allocation section
is not imported. Inconsistent dates or totals produce a visible import error.

## Verify

Questrade exports use the same **Investment statement import** section: select
`InvestmentSummary.xlsx`, enter the observation date, then **Review export**.
The export has no valuation date, so the form starts blank and requires one.
Review the CAD-combined equity total (including cash), CAD/USD cash, export FX
rate, and native-currency position details. Confirmation stores the original
XLSX with the snapshot; download it from the statement archive. Only single-account
CAD/USD workbooks mapped to a manual CAD investment account are supported.
Native USD position values are labelled USD rather than misrepresented as CAD.
Cost basis, returns and allocation worksheets are not imported yet.

From the project root, with the pinned Node version selected:

```powershell
npm run typecheck
npm run build
npm test
npm exec --workspace frontend -- playwright install chromium
npm run test:e2e
npm run format:check
```

Browser tests need no Docker. They start a real API backed by a disposable
in-memory SQLite database on `127.0.0.1:3101`, with a Vite preview on `127.0.0.1:4173`. These
ports must be free; the test runner will not reuse another project's server.
Desktop and mobile Chromium tests cover creation, persistence through reload,
member assignment, balance recording, editing, archiving, and recoverable errors.
They also cover expense category/member attribution, edits across month boundaries,
per-currency totals, pagination, expense archiving, and failed-read recovery.
No developer database is modified. Tests stop their processes when finished.
