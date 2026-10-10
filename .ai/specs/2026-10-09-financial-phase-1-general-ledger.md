# Financial module — Phase 1: General Ledger

**Status:** Specification (buildable)
**Program:** [`2026-10-09-financial-module-program.md`](2026-10-09-financial-module-program.md)
**Module:** `financial` (new, `apps/mercato/src/modules/financial`)
**Depends on:** nothing. **Depended on by:** every later financial phase and the KSA plugin.

## TLDR

Phase 1 creates the `financial` module and its ledger: a chart of accounts, journal
entries with balanced debit/credit lines, accounting periods with a close gate, and
the two state transitions that make a ledger trustworthy — **post** (freeze) and
**reverse** (correct without editing). It is jurisdiction-neutral: it stores no tax
rule, no invoice format and no country behaviour. Those arrive in Phase 1b through
the country-plugin registry. Everything here is graded by the accounting invariants
in §Invariants, which are unit-tested directly and asserted end-to-end through the
API.

## Overview

Sales owns invoicing; `wms` owns stock; nothing owns the double-entry book. Phase 1
supplies exactly that book and the rules that keep it sound:

- **Chart of accounts** — hierarchical, classed (`asset`/`liability`/`equity`/`revenue`/`expense`),
  each with a normal balance, a currency and an optional country code.
- **Journal entries** — header (date, posting date, period, type, description,
  reference, currency, exchange rate) plus ≥2 lines that must balance.
- **Periods** — fiscal year + period number with `open` / `soft_closed` / `hard_closed`
  states that gate posting.
- **Post / reverse** — the only way an entry's effect enters the ledger, and the only
  way an error leaves it.

## Problem Statement

1. **No ledger exists**, so no trial balance, no statements and no VAT return can be
   produced from real postings.
2. **The dangerous failure is a ledger that balances visually but not on the books.**
   Editing a posted entry, posting into a closed period, or letting a line carry both
   a debit and a credit all produce a system that looks right and is unauditable.
   These are command-layer rules, not form validations.
3. **Rounding must not drift.** Vanilla float arithmetic is a halala off ZATCA's
   arithmetic; the ledger must never store money in binary floats.
4. **The engine must not learn about countries.** If `financial` imports Saudi rules,
   the core stops being reusable and the plugin layer is fiction.

## Proposed Solution

### Scope (Phase 1)

In: accounts, journal entries + lines, periods, post, reverse, trial balance read
model, CRUD + backend screens for all three entities, ACL, events, i18n in six
locales, unit + integration tests.

Out (later phases or never): AP/AR documents, bank/cash, multi-currency revaluation,
fixed assets, budgeting, cost centres, consolidation, statements, payroll. Tax
calculation, e-invoicing and fiscal calendars, which come from the **plugin**, not
the core.

### Entities

| Entity | Table | Notes |
|---|---|---|
| `GlAccount` | `gl_accounts` | Classed, hierarchical (`parentId`), `normalBalance`, `currencyCode`, `countryCode`, `isReconciliationRequired` |
| `GlPeriod` | `gl_periods` | `(fiscalYear, periodNumber)` unique per tenant, `status`, `closedAt/closedBy`, optional `balanceSnapshot` |
| `GlJournalEntry` | `gl_journal_entries` | Header; `entryNumber` unique per tenant; `status` draft→posted→reversed; links to the reversing pair |
| `GlJournalLine` | `gl_journal_lines` | Exactly one of `debitAmount`/`creditAmount` non-zero; optional `taxCode`, `costCenterId`, `projectId` (ids only) |

Header↔line is an intra-module ORM relation (`GlJournalEntry.lines`); every other
reference is by id.

### Invariants (the rules this phase exists to enforce)

1. **Balanced.** `sum(debit) == sum(credit)` per entry, in both the entry currency and
   the base currency, to the currency's minor-unit precision. Enforced at create,
   update, and post.
2. **Single-sided lines.** Each line has a positive debit XOR a positive credit; never
   both, never neither, never negative.
3. **At least two lines.** A one-line entry is not a journal entry.
4. **Posted entries are immutable.** `update`/`delete` on a `posted` entry is refused;
   the correction path is `reverse`, which creates a new entry whose lines mirror the
   original and links `reversesEntryId`/`reversedByEntryId`.
5. **Period gating.** Posting requires the target period to be `open`; `soft_closed`
   requires the elevated `financial.close` permission; `hard_closed` always refuses.
6. **Posting is idempotent-safe.** Posting a non-`draft` entry is refused with a
   stable error code, so a retried request cannot double-post.
7. **Tenant isolation.** Every query filters `tenant_id` + `organization_id`.

### State machine

```
draft ──post──► posted ──reverse──► reversed
  ▲                                    │
  └──────────── reversing entry ◄───────┘
```

`GlPeriod`: `open ──close──► soft_closed ──close──► hard_closed`; `reopen` moves
`soft_closed → open` and requires `financial.close` (a `hard_closed` period is not
reopenable through the API).

## Data Models

All tables carry `id UUID PK`, `tenant_id`, `organization_id`, `created_at`,
`updated_at`, `deleted_at` (where archivable), `created_by`, `updated_by`. Money is
`NUMERIC(19,4)`; `exchange_rate` is `NUMERIC(19,6)`. `updated_at` doubles as the
optimistic-lock version, so every entity's API response carries `updatedAt`.

```sql
CREATE TABLE gl_accounts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  account_class VARCHAR(20) NOT NULL,      -- asset|liability|equity|revenue|expense
  account_type VARCHAR(50),
  parent_id UUID REFERENCES gl_accounts(id),
  currency_code CHAR(3) NOT NULL,
  normal_balance VARCHAR(10) NOT NULL,     -- debit|credit
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_reconciliation_required BOOLEAN NOT NULL DEFAULT false,
  country_code CHAR(2),
  created_at TIMESTAMPTZ NOT NULL, created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL, updated_by UUID,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_gl_accounts_code UNIQUE (tenant_id, code)
);

CREATE TABLE gl_periods (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  fiscal_year INTEGER NOT NULL,
  period_number INTEGER NOT NULL,
  period_name VARCHAR(50) NOT NULL,
  start_date DATE NOT NULL, end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',   -- open|soft_closed|hard_closed
  closed_at TIMESTAMPTZ, closed_by UUID,
  balance_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_gl_periods UNIQUE (tenant_id, fiscal_year, period_number)
);

CREATE TABLE gl_journal_entries (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  entry_number VARCHAR(50) NOT NULL,
  entry_date DATE NOT NULL, posting_date DATE NOT NULL,
  period_id UUID NOT NULL REFERENCES gl_periods(id),
  entry_type VARCHAR(20) NOT NULL,          -- standard|adjusting|closing|reversing
  description TEXT NOT NULL,
  reference VARCHAR(100),
  currency_code CHAR(3) NOT NULL, exchange_rate NUMERIC(19,6) NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',  -- draft|posted|reversed
  reverses_entry_id UUID REFERENCES gl_journal_entries(id),
  reversed_by_entry_id UUID REFERENCES gl_journal_entries(id),
  posted_at TIMESTAMPTZ, posted_by UUID,
  created_at TIMESTAMPTZ NOT NULL, created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL, updated_by UUID,
  CONSTRAINT uq_gl_entries_number UNIQUE (tenant_id, entry_number)
);

CREATE TABLE gl_journal_lines (
  id UUID PRIMARY KEY,
  entry_id UUID NOT NULL REFERENCES gl_journal_entries(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  account_id UUID NOT NULL REFERENCES gl_accounts(id),
  description TEXT,
  debit_amount NUMERIC(19,4) NOT NULL DEFAULT 0,
  credit_amount NUMERIC(19,4) NOT NULL DEFAULT 0,
  base_debit_amount NUMERIC(19,4) NOT NULL DEFAULT 0,
  base_credit_amount NUMERIC(19,4) NOT NULL DEFAULT 0,
  tax_code VARCHAR(20), cost_center_id UUID, project_id UUID,
  CONSTRAINT chk_gl_line_single_sided CHECK (
    (debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0)
  )
);

CREATE INDEX idx_gl_lines_account ON gl_journal_lines (account_id);
CREATE INDEX idx_gl_entries_period ON gl_journal_entries (period_id, status);
```

**Validators** (`data/validators.ts`, zod, types via `z.infer`): `createAccountSchema`
/ `updateAccountSchema`, `createPeriodSchema` / `updatePeriodSchema`, and
`createJournalEntrySchema` with a `superRefine` asserting invariants 1–3 (balance to
minor-unit precision, single-sided lines, ≥2 lines). The same refinement is re-used
by the post command so the invariant cannot be enforced in only one place.

## API Contracts

CRUD routes built with `makeCrudRoute` (OpenAPI docs included); `pageSize` ≤ 100:

| Method | Path | Feature | Notes |
|---|---|---|---|
| GET/POST | `/api/financial/accounts` | `financial.read` / `financial.write` | filters: `search`, `accountClass`, `isActive`, `countryCode` |
| GET/PUT/DELETE | `/api/financial/accounts/[id]` | `financial.read` / `financial.write` | delete is an archive; refuses when the account has posted lines |
| GET/POST | `/api/financial/journal-entries` | `financial.read` / `financial.write` | filters: `status`, `periodId`, `entryType`; search number/reference |
| GET/PUT/DELETE | `/api/financial/journal-entries/[id]` | `financial.read` / `financial.write` | PUT/DELETE refuse a `posted` entry (invariant 4) |
| GET/POST | `/api/financial/periods` | `financial.read` / `financial.write` | |
| GET/PUT | `/api/financial/periods/[id]` | `financial.read` / `financial.write` | |
| POST | `/api/financial/journal-entries/post` | `financial.post` | body `{ id, updatedAt }`; command-level optimistic lock |
| POST | `/api/financial/journal-entries/reverse` | `financial.post` | body `{ id, updatedAt, postingDate? }`; creates the mirror entry |
| POST | `/api/financial/periods/close` | `financial.close` | body `{ id, updatedAt, target: 'soft_closed' \| 'hard_closed' }` |
| POST | `/api/financial/periods/reopen` | `financial.close` | body `{ id, updatedAt }`; `soft_closed → open` only |
| GET | `/api/financial/trial-balance` | `financial.read` | query `periodId` (or `from`/`to`); per-account debit/credit/closing |

Error codes are stable and translated: `financial.errors.unbalanced_entry`,
`entry_not_draft`, `entry_immutable`, `period_closed`, `period_hard_closed`,
`account_has_postings`, `invalid_period`, `currency_mismatch`. Every mutating endpoint
returns the standard **409** body on a stale `updatedAt`.

## Access Control (`acl.ts`)

```
financial.read    View the ledger                      module: financial
financial.write   Manage accounts, drafts, periods     dependsOn: financial.read
financial.post    Post and reverse journal entries     dependsOn: financial.write
financial.close   Close and reopen periods             dependsOn: financial.post
financial.admin   Administer financial settings        dependsOn: financial.close
```

Wired into default role features from `setup.ts` (viewers get `read`; the default
admin role gets all five; the feature catalogue is added to `auth/i18n/*` so the role
editor renders titles in every locale).

## Events (`events.ts`, via `createModuleEvents`)

`financial.account.created|updated|archived`,
`financial.journal_entry.created|updated`,
`financial.journal_entry.posted`, `financial.journal_entry.reversed`,
`financial.period.created|closed|reopened`. Posted/reversed/closed carry the entry or
period id plus tenant/organization. `financial.journal_entry.posted` is the hook the
KSA plugin and later phases subscribe to (a VAT return sums the posted tax lines).

## Commands

`commands/crud.ts` is the module's CRUD factory (the `transport_operations` /
`fleet_management` pattern: `registerCommand`, `dataEngine.createOrmEntity`,
`emitCrudSideEffects`, one transaction per command). `commands/gl.ts` adds the four
action commands — `financial.journal_entries.post`, `.reverse`,
`financial.periods.close`, `.reopen` — each wrapped with
`enforceCommandOptimisticLock` and each writing its event. Posting recomputes the
balance check inside the transaction (pessimistic lock on the entry) so a concurrent
draft edit cannot slip an unbalanced entry through.

## UI

Three backend screens under `/backend/financial`: **Chart of accounts** (`CrudForm`
with class/normal-balance selects and a parent picker), **Journal entries**
(`CrudForm` plus a line editor grid; row actions `Post` and `Reverse` behind confirm
dialogs wrapped in `useGuardedMutation` with the row's `updatedAt`, surfacing the
translated 409), and **Periods** (list with `Close`/`Reopen` row actions). i18n ships
in six locales (ar translated; de/es/ko/pl mirror English), `financial.*` namespace.

## Tests & Verification

**Unit (`lib/__tests__/`, `data/__tests__/`):** balance check rejects an entry off by
one minor unit and accepts one off by less; single-sided check rejects a line with
both amounts and one with neither; negative amounts rejected; `entryNumber` uniqueness
per tenant; period-gating matrix (`open` posts; `soft_closed` posts only with
`financial.close`; `hard_closed` never); reversal builds exact mirrors and links both
directions; trial-balance aggregation sums only `posted` entries and nets by normal
balance.

**Validation gates for this phase (run in order):** `yarn generate` (route
discovery), `yarn build:packages`, `yarn typecheck`, `yarn lint`, the module's jest
suite, then the integration spec. The chosen runner (local vs Docker) is recorded in
the PR.

## Integration Coverage

`financial/__integration__/TC-FINANCIAL-001-general-ledger.spec.ts`, self-contained
(fixtures created in setup, deleted in teardown):

1. create account → appears in the accounts list;
2. create a two-line balanced entry → **post** → 200 and the entry reads `posted`;
3. the trial balance for the period shows the two accounts with the posted amounts;
4. an unbalanced entry is refused at create (400) and cannot be posted;
5. `PUT` on the posted entry is refused; `reverse` creates the mirror entry and the
   original reads `reversed`; the trial balance nets to zero;
6. posting a draft whose period is `hard_closed` returns the translated refusal;
7. posting with a stale `updatedAt` returns 409 (optimistic lock end-to-end).

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| A posted entry becomes editable through a second code path | High | Ledger integrity | Immutability enforced in the command layer + the DB-level single-sided CHECK + an integration case that PUTs a posted entry | Any future write path must go through the command; the guard test is the backstop |
| Concurrent draft edits allow an unbalanced post | High | Ledger integrity | Balance re-checked inside the posting transaction under a pessimistic lock; command-level optimistic lock on the header | — |
| Float money math | High | Money | `NUMERIC` columns; minor-unit rounding helper; no `parseFloat` on money | — |
| Entry numbering races under concurrency | Medium | UX | Unique `(tenant_id, entry_number)`; the command retries/sequences per tenant | A retry may skip a number (acceptable for an audit number) |
| Period gating bypass for privileged users | Medium | Compliance | `soft_closed` requires `financial.close`; recorded on the event | Elevated posting is allowed by design |
| Trial-balance read model drifts from lines | Medium | Reporting | Computed from `gl_journal_lines` at read time (no denormalised cache in Phase 1); `balance_snapshot` is unused until later phases | Later caching must add an invalidation test |

## Final Compliance Report

- New module, new tables, new routes, new ACL ids and new event ids — **all additive**.
- No existing contract surface changes; no existing route, event, spot id, DI key or
  ACL id is touched.
- No new production dependency.
- Migrations are additive; `yarn db:generate` output is reviewed for unrelated drift
  before committing.
- Backward compatibility: nothing to deprecate; `BACKWARD_COMPATIBILITY.md` requires
  only that the new ids are stable once shipped (they are frozen at first release).

## Changelog

- **2026-10-09** — Phase-1 spec created: chart of accounts, journal entries/lines,
  periods, post/reverse/close/reopen, trial balance; accounting invariants fixed;
  plugin boundary left to Phase 1b.
- **2026-10-09 (implementation, part 1)** — Landed in
  `apps/mercato/src/modules/financial`: module shell (`index`/`acl`/`setup`/`di`), the
  four entities, zod validators, the error vocabulary, the pure ledger rules
  (`lib/glService.ts`) with 11 unit tests, the CRUD command factory, and the ledger
  commands (entry create/update/delete, `financial.journal_entries.post`/`.reverse`,
  `financial.periods.close`/`.reopen`, each in one transaction with a pessimistic lock
  and a command-level optimistic lock at the route). Verified: `npx tsc --noEmit -p
  apps/mercato/tsconfig.json` → 0 errors repo-wide, `npx jest src/modules/financial` →
  22 tests passing. **Remaining for Phase 1:** API routes (+ OpenAPI), six-locale i18n,
  the ORM migration, the three backend screens, and the `TC-FINANCIAL-001` integration
  spec.
- **2026-10-09 (implementation, part 2)** — API surface and dictionaries landed:
  `api/openapi.ts`, CRUD routes for **accounts**, **periods** and **journal-entries**,
  the four action routes (`post` / `reverse` / `periods/close` / `periods/reopen`) on a
  shared `runLedgerAction` wrapper (the route mutation guards carry the optimistic-lock
  header, so a stale `updatedAt` is a 409), and the **trial-balance** read model; i18n
  in six locales (ar translated, de/es/ko/pl mirror English); the module is registered
  in `apps/mercato/src/modules.ts`. Verified: `tsc --noEmit` → **0 errors**;
  `npx jest src/modules/financial` → 22 tests; `yarn i18n:check-sync` → all in sync;
  `yarn generate` discovers all **8** financial routes
  (`api-route-shard.026.financial.generated.ts`); the `crud-resource-path` guard passes.
  **Remaining for Phase 1:** the ORM migration (no tables are created yet), the three
  backend screens, and the `TC-FINANCIAL-001` integration spec.
- **2026-10-09 (implementation, part 3)** — Migration and integration coverage landed.
  `yarn db:generate` produced exactly one file (`Migration..._financial.ts`) with
  **zero drift** in every other module, and the three uniqueness rules emit genuine
  `create unique index` statements — the `@Index({ expression })` form is required,
  because the `options: { unique: true }` form the reference module uses silently
  degrades to a plain index (which would have let duplicate account codes, period keys
  and entry numbers through). `__integration__/TC-FINANCIAL-001-general-ledger.spec.ts`
  covers the seven Phase-1 cases end to end: balanced post, unbalanced refusal at create,
  posted-entry immutability, trial balance after posting, reversal netting the balance to
  zero, hard-closed period refusal, and the stale-`updatedAt` **409**. Verified: the
  narrow project `npx tsc --noEmit -p .mercato/tsconfig-financial.json` → **exit 0**;
  22 module tests green. **Remaining for Phase 1:** the three backend screens; applying
  the migration needs approval (`yarn db:migrate`).
- **2026-10-09 (implementation, part 4 — Phase 1 screens)** — The backend UI landed:
  three list screens (accounts / periods / journal-entries) on the shared `DataTable`
  pattern plus create and edit `CrudForm` screens for each (18 page files under
  `backend/financial/**`). The **periods** list drives `close (soft/hard)` / `reopen`
  from row actions, the **journal-entry** list drives `post` / `reverse`, each behind a
  confirm dialog through `useGuardedMutation` with the row's `updatedAt` (so a stale
  version surfaces the server 409), and the entry form carries a custom **lines editor**
  (account picker + debit/credit per row with an advisory balance badge) so header and
  postings save in one submit. A `journal-entries/lines` endpoint feeds the edit screen,
  because `gl_journal_lines` is scoped through its entry and the entry list carries no
  lines. `yarn generate` discovers all **9** routes; the narrow project typecheck is
  **exit 0** and the 22 module tests stay green. **Remaining:** the module's UI i18n keys
  (the finance screens currently fall back to English in Arabic), and applying the
  migration (`yarn db:migrate`, approval required).
- **2026-10-09 (implementation, part 5 — the module dictionary)** — The three screens now
  read Arabic. The dictionary grew from the 18 `financial.errors.*` keys to **164**: the
  **149** UI keys the screens and their page metadata actually reference — the nav group,
  three column sets, three filter sets, six create/edit field sets, both form group sets,
  the flash/confirm/error strings, the API-side `financial.errors.entry_not_found`, and
  the five enum families the screens resolve dynamically (`accounts.class`,
  `accounts.normalBalance`, `entries.status`, `entries.type`, `periods.status`, 17 keys).
  The English values are the screens' own `t()` fallbacks, read out of the source, so the
  dictionary cannot drift from the code. `ar.json` carries a real Arabic translation for
  every key (accounting terminology: *دليل الحسابات*, *قيد يومية*, *ترحيل*, *عكس القيد*,
  *ميزان المراجعة* terms, *مدين/دائن*); Arabic is a *shipped* locale rather than a parity
  locale, so `i18n:check-sync` validates it exactly like `pl/es/de/ko`, which mirror
  English. Verified: `i18n:check-sync` → **all translation files are in sync**; all six
  files hold the same **164** sorted keys; and a module-scoped scan of every literal
  `t('…')` / `translate('…')` argument finds **0** keys absent from `en.json`. The module's
  code is unchanged by this slice — six data files plus this changelog. **Remaining for
  Phase 1:** applying the migration (`yarn db:migrate`, approval required).

- **2026-10-10 (implementation, part 6 — the events the spec asked for)** — The
  module's `events.ts` landed (`createModuleEvents`, 13 ids) and the four action
  commands now emit the transitions it declares:
  `financial.journal_entry.posted` / `.reversed` and `financial.period.closed` /
  `.reopened`. Posting previously emitted only
  `financial.journal_entry.updated` — the same id a draft edit produces — so a
  consumer that had to react to *postings* (the KSA VAT return is the first) had
  no signal to follow; both can carry an entry id, and only one means the ledger
  changed. The declarations also stop `warnIfUndeclaredEvent` firing on every
  write. One naming correction against the original event list: the account delete
  is a CRUD `financial.account.deleted` (the factory's soft-archive action), not a
  bespoke `archived`, so the declaration matches the id the platform actually
  emits rather than a name nothing calls. `financial/lib/money.ts` also landed
  here — the jurisdiction layer's decimal-string rounding, which the country
  plugin needs and which posting does not (posting stays on `glService`'s exact
  4-decimal arithmetic).
