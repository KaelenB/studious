# Backend API distribution

`@studious/api` is the backend-owned, browser-safe API package consumed by the
frontend. It contains the public request/response contracts, inferred TypeScript
DTOs, and a typed HTTP client. It contains no SQLite, Drizzle, Fastify,
environment settings, or credentials.

## Use in this repository

`api.investmentMarket(householdId, asOf, currency, signal?)` returns latest
statement holdings with public historical stock/ETF prices, annualized adjusted
returns, coverage and per-holding errors. It performs outbound ticker/date-only
lookups when called; it is not a live valuation or a guaranteed projection.
An optional fifth `accountId` argument scopes holdings and weights to one account.

`api.downloadDatabase()` downloads a full-server SQLite backup as a `Blob`
from `GET /database/backup`. It includes all households and private archived
documents; store it securely. Concurrent downloads receive a retryable 503.

Both backend and frontend depend on `@studious/api` at version `0.11.0`. npm
workspaces link the package locally during `npm ci`; nothing is published or
downloaded from a private registry.

```typescript
import { createApiClient, ApiError, type Account } from '@studious/api';

const api = createApiClient('/api');
const household = await api.createHousehold('Home', 'CAD');
const accounts: Account[] = await api.accounts(household.id);
```

Use an absolute base URL for Node.js callers, for example
`createApiClient('http://127.0.0.1:3000')`. The browser uses its same-origin
`/api` proxy. Pass `{ fetch }` as the second argument to route requests through
another transport; the GitHub Pages build uses this to call the API running
inside the browser. Read operations accept an optional `AbortSignal`.
`storage()` returns `{ usedBytes, limitBytes }` for the SQLite database.
Inputs and JSON responses are validated with the distributed Zod schemas.
HTTP errors throw `ApiError` with a `status` property; validation errors throw
before a request is sent. Dates and monetary values remain strings on the wire.

Accounts carry a nullable `subtype` classifying investment accounts by plan
(`investmentSubtypes`: `TFSA`, `RRSP`, `SPOUSAL_RRSP`, `GROUP_RRSP`, `FHSA`,
`RESP`, `RDSP`, `RRIF`, `LIRA`, `LIF`, `DCPP`, `DBPP`, `DPSP`,
`NON_REGISTERED`). `addAccount` rejects a sub-type unless `type` is `INVESTMENT`;
`updateAccount` accepts `subtype` (or `null` to clear) and the server answers 409
for non-investment accounts. Responses from older servers parse with `subtype: null`.

Mortgage accounts use `mortgage(householdId, accountId, asOf?, signal?)`,
`saveMortgageTerms` (PUT, create or replace), `addPrepayment`, and
`deletePrepayment`. `mortgage` returns `{ terms, prepayments, projection }`, where
`terms` and `projection` are `null` until terms are saved. The exported
`paymentFrequencies`, `compoundingFrequencies`, `rateTypes`, and `ratePattern`
describe valid input; `MortgageTermsInput`, `MortgageProjection`, and `Prepayment`
type the payloads. See the [API guide](../README.md#mortgages).

`overview(householdId, months = 12, asOf?, signal?)` returns an `Overview`:
chronological `months` (`YYYY-MM`), active-account `{ accountId, balances }`
series aligned to those months, and expense totals grouped by month, currency,
category and member. `months` accepts 1–120. Each balance is the latest
observation at month-end, carried forward, or `null` before the first
observation. The last month is capped at `asOf` (default: today, UTC), not
extrapolated. Expense totals include all active expenses through that day,
not only one page. Metadata comes from `accounts`, `members` and
`expenseCategories`. See the [overview guide](../README.md#household-overview).

The client also exposes `expenseCategories`, `addExpenseCategory`, `expenses`,
`addExpense`, `updateExpense`, and `archiveExpense`. Expense requests and
responses use the exported `ExpenseInput`, `ExpenseUpdate`, `Expense`,
`ExpenseCategory`, and `ExpensePage` types and their Zod schemas.
`expenses(householdId, '2026-01', 20, 0, signal)` returns paginated `items` plus
full-month `totals` per currency. `startDate` is a calendar date, not a timestamp.
Expense amounts must be non-zero; negative values represent refunds and reduce
monthly totals. See the [API guide](../README.md#one-off-expenses)
for constraints and semantics.

`income`, `addIncome`, `updateIncome` and `archiveIncome` manage positive dated
receipts, with the same month/pagination and household-member conventions as
expenses (no category). Types: `Income`, `IncomeInput`, `IncomeUpdate`,
`IncomePage`. The overview includes monthly `income` totals; its expense totals
may now be negative.

`previewBudget(id, blob, filename, currency, signal?)` returns `BudgetPreview`
with source rows, exact totals, warnings, row issues, owner names and duplicate
status. `importBudget(id, blob, filename, currency, preview.sha256, members)`
returns counts `{ expenses, income, duplicates }`. `BudgetMemberMapping` maps
each source owner to a household member UUID, `'CREATE'`, or `null` (shared).
Invalid rows block all writes; the confirmation hash must match the upload.
See the [history guide](../README.md#historical-budgets-and-dated-income) for
precision, date and duplicate rules.

Sun Life imports use `previewStatement(householdId, accountId, filename, blob,
signal?)` and `importStatement(householdId, accountId, filename, blob)`. Both send
raw `application/pdf` bytes, not base64 JSON. Preview returns `StatementPreview`;
confirmation returns `StatementArchive` linked to the saved balance snapshot.
`statements(householdId, accountId, limit, offset, signal?)` lists archive metadata.
`downloadStatement(householdId, accountId, statementId)` returns a `Blob` of the
original PDF. File size and filenames are validated; parsing stays server-side.
See the [PDF import guide](../README.md#sun-life-pdf-imports) for format limits.

Previews and archive metadata include `investments: StatementInvestment[] | null`.
Each historical row contains `name`, optional `category` (nullable), `units`,
`unitPrice`, and `value`, with all numeric values represented as decimal strings.
Units and prices keep their original precision; `value` has two decimal places.
Null means the PDF has no section or the archive predates extraction.
`extractStatementInvestments(householdId, accountId, statementId)` extracts from
the stored original without changing the saved snapshot or creating a duplicate.

## Ownership and changes

Questrade workbooks use the same methods: `previewStatement(id, accountId,
filename, blob, signal?, statementDate?)` and `importStatement(id, accountId,
filename, blob, statementDate?)`. The explicit `YYYY-MM-DD` observation date
is required for XLSX, and the client chooses the media type from the validated
extension. `StatementArchive.provider` identifies the format; `questrade`
metadata includes account type, FX, native cash and combined cash.
Positions may carry `symbol` and native `currency`. `downloadStatement` returns
the original PDF or XLSX Blob using the generic `/file` endpoint.

- `src/contracts.ts` defines public input schemas, output schemas, enum values,
  and DTO types. The server imports the same request validators and enum values.
- `src/client.ts` owns HTTP paths and serialization for every supported operation.
- Backend JSON presenters have explicit return types from these contracts, so
  response shape changes are checked during compilation.
- Database models remain server-internal. Conversion from ISO timestamps to
  `Date` objects happens only in backend validation.
- The frontend wrapper only configures the base URL and defines UI labels. It
  must not duplicate contracts or HTTP route definitions.

After editing the contracts or client, run `npm run build:api` from the root.
Backend/frontend dev, build, typecheck, and test commands build the API package
automatically before consuming it. Restart development servers after API edits;
the compiled package is not rebuilt on every source change.

## Distribution outside this workspace

```powershell
npm pack --workspace @studious/api --pack-destination .
```

The `prepack` hook builds JavaScript and `.d.ts` declarations. The resulting
`studious-api-0.11.0.tgz` can be installed into a separate frontend project with
`npm install <path-to-tarball>`. Only compiled distribution files, package metadata,
and this guide are included. `zod` is the sole runtime dependency. No registry
publish step is performed by this project.

Version public contract changes with the package; breaking changes require a
major version once the API is stable. Run root typecheck, build, unit/integration,
and browser tests before distributing. Integration tests exercise the packaged
client against every real backend operation and an isolated in-memory SQLite database.
