# SPEC-013: `financial_pl_accounting` package (Polish features that read the general ledger)

## TLDR

**Key Points:**
- A new package in this repository, `@open-mercato/financial-pl-accounting`, module id `financial_pl_accounting`. It hosts every Polish feature that needs a general ledger, so that `financial_pl` stays installable without one.
- It has a hard `requires` on `financial_pl`, `ledger`, `tax_management` and `financial_statements`. `financial_pl` itself gets no `requires`.

**Scope:**
- B1 Polish tax engines (VAT, CIT, PIT), mikrorachunek podatkowy and payment instruction: SPEC-011 (`official-modules#55`), core side `open-mercato#6168`.
- B2 Bilans and RZiS: `open-mercato#6188`.
- B3 JPK_KR_PD: SPEC-010 (`official-modules#54`), reading the ledger through `open-mercato#6038`.
- B4 VAT reconciliation report (defined in this document).
- Package manifest, `requires`, peers, features, settings, release order.

**Concerns:**
- Hard dependencies on four modules that live in `open-mercato` and are not merged yet (`ledger` #6340, `tax_management` #6168, `financial_statements` #6188, bulk read #6038). Nothing here is buildable before they merge.
- Needs two services from `financial_pl` first (SPEC-012).


## Open items

Decisions in this document are a proposed current state. The points below are marked **⚠ NEEDS HUMAN CONFIRMATION** in the body:

1. **Peer packages.** The exact package names and version ranges of `ledger`, `tax_management` and `financial_statements`, once those modules are released (see Architecture, Manifest and dependencies).
2. **VAT account settings.** Whether `ModuleConfigService` accepts a list value for `financial_pl_accounting.vatInputAccountIds` / `vatOutputAccountIds`; otherwise one config row per account (see the VAT reconciliation report).

Items that belong to the `financial_pl` side (gateway part size, `AuthData` for natural persons, `PurchaseVatRecord` period, empty `fa3Xml`, source of the VAT figure) are listed in SPEC-012.

## Overview

`financial_pl` is installed standalone for KSeF 2.0 and JPK_V7 and must not require a general ledger (its README positions it for standalone installs; its code imports from core only `directory`, `progress` and `sales`). The features that read the ledger are the opposite case: they are useless without one. Putting them in a sibling package lets each install what it needs, and lets the ledger-dependent features declare their `requires` honestly.

> **Market Reference**: Comarch Optima keeps the VAT register (evidence for the JPK_V7 declaration) separate from the books, with posting as a later step; `2026-09-06-accounts-payable.md` (`open-mercato#5962`) already cites this. The same separation decides this package's split: the register side stays in `financial_pl`, the books side lives here. A public description of how Optima or other systems reconcile the register with the VAT accounts was not checked; B4 is designed from the specs in `open-mercato`.

## Problem Statement

1. The specs SPEC-010, SPEC-011, `#6188` assign Polish features to `financial_pl` that read the ledger. A single module would need `requires: ['ledger']`, which forces a ledger on every KSeF-only install (`packages/core/AGENTS.md` allows a hard `requires` only for a non-optional dependency).
2. In `official-modules` one package holds one module (`carrier-inpost`, `forms`, `financial-pl`, `test-package`), so a second module means a second package.
3. Nothing today reconciles the VAT register with the VAT accounts in the ledger.

## Proposed Solution

One package, one module, built on the three services of SPEC-012 and the ledger services of `open-mercato`.

### Design Decisions

| Decision | Rationale |
|---|---|
| Package `@open-mercato/financial-pl-accounting`, module `financial_pl_accounting` | Matches the one-package-one-module convention; the name states the relation to `financial_pl` |
| `requires`: `financial_pl`, `ledger`, `tax_management`, `financial_statements` | Each is called directly; the generator checks only listed modules, so transitive ones are not relied on |
| No `requires` on `posting_rules` | B2 reads period state and the closing entry through `ledgerBulkReadService` (#6038), not through `posting_rules`. To be re-checked at implementation |
| No `requires` on `accounts_payable` or `contractors` | Not used by this package; the bridge to AP lives in `financial_pl` (SPEC-012) |
| VAT liability from the register; CIT and PIT from GL balances | Register fields the ledger does not carry (KSeF number, GTU, fixed-asset VAT, self-assessment); matches `#6168` |
| Own feature ids with the module prefix; JPK_KR_PD keeps the three `financial_pl.*` features | `financial_pl`'s pages already list another module's feature in `requireFeatures` (`sales.invoices.manage`) |
| B4 Phase 1 is period-level only | Document-level comparison needs an in-process read of `VendorInvoice` that no spec offers (below) |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| One module `financial_pl` with `requires: ['ledger']` (SPEC-010's earlier wording) | Forces a ledger on KSeF-only installs |
| One module, ledger features gated by `tryResolve` | No guaranteed seed order, runtime gating of UI and ACL, two test matrices (with and without ledger) |
| Put these features in core | Poland-specific; `financial_pl` is the home of Polish compliance |

## User Stories / Use Cases

- **Accountant** wants Bilans and RZiS, JPK_KR_PD and tax payment instructions from the same ledger so that no figure is typed twice.
- **Integrator** wants to install KSeF and JPK_V7 without a ledger so that a small tenant is not forced onto the full financial stack.
- **Accountant** wants to see the VAT register next to the VAT accounts so that a gap is found before the JPK_V7 is filed.

## Architecture

### Manifest and dependencies

- `index.ts` metadata: `requires: ['financial_pl', 'ledger', 'tax_management', 'financial_statements']`.
- `package.json` peers: `@open-mercato/financial-pl` at the first release that contains SPEC-012 A1 and A3; the packages that ship `ledger` (`packages/ledger`), `tax_management` and `financial_statements` (both under `packages/core`) at the first releases that contain them. **⚠ NEEDS HUMAN CONFIRMATION:** the exact package names and ranges, once those modules are released.
- Dependency direction: `financial_pl_accounting` → `financial_pl`, core. Never the reverse. `financial_pl` does not know this package exists.

### Services consumed

| Service | From | Used by |
|---|---|---|
| `ledgerBulkReadService` (`getZois`, `iterateJournalEntries`, `iterateJournalEntryLines`, `listAccounts`, `listAccountGroups`, `getFiscalPeriod`, `findClosingEntries`) | `ledger` (#6038) | B2, B3, B4 |
| `jpkTransportService` | `financial_pl` (SPEC-012 A1) | B3 |
| `vatRegisterReadService` | `financial_pl` (SPEC-012 A3) | B1 (VAT engine), B4 |
| `taxEngineRegistry`, `registerTaxCode`, `markTaxLiabilityPaid` | `tax_management` (#6168) | B1 |
| `buildBalanceSheetData`, `buildIncomeStatementData`, `computeDerivedTotals` | `financial_statements` (#6188) | B2 |

No import of `financial_pl` code. UI that belongs on a `financial_pl` screen uses widget injection, and only when `financial_pl` declares the spot (SPEC-012, Phase 2).

### `setup.ts`

- `defaultRoleFeatures` for the new features.
- Per-tenant `TaxCode` rows for `VAT`, `CIT`, `PIT` through `registerTaxCode` (SPEC-011). Seed order is guaranteed by `requires`.

### B4. VAT reconciliation report (Phase 1)

Compares, for one calendar month, the VAT register with the ledger's VAT accounts. A report with an explanation, not a gate: it never blocks the JPK_V7, which `financial_pl` generates without knowing this package.

- **Settings** (tenant scope, `ModuleConfigService`, the mechanism AP uses for its account ids): `financial_pl_accounting.vatInputAccountIds` and `financial_pl_accounting.vatOutputAccountIds`, lists of `LedgerAccount` ids. The package does not read AP's `accounts_payable.vatInputAccountId`, which AP documents as used only by itself. **⚠ NEEDS HUMAN CONFIRMATION:** that `ModuleConfigService` accepts a list value; otherwise one config row per account.
- **Input:** a `FiscalPeriod` id. The report requires the period to be one calendar month (read with `ledgerBulkReadService.getFiscalPeriod`); otherwise it stops with a message.
- **Register side:** `vatRegisterReadService.getPeriodTotals({ year, month })`.
- **Ledger side:** `ledgerBulkReadService.getZois({ periodId })`, the period turnover of the configured accounts, signed by each account's normal balance.
- **Output** per side: register total, ledger total, difference, and a note listing the usual causes (VAT on fixed assets, non-deductible VAT, self-assessed VAT, deduction period vs posting date). No verdict and no threshold.
- **Phase 2:** document-level comparison (`PurchaseVatRecord` vs `VendorInvoice.totalTax`) once `financial_pl` links records to AP drafts (SPEC-012 A2) **and** AP exposes an in-process read of its invoices, which no spec offers today (to be added to `open-mercato#5962`); a widget on the JPK_V7 screen once `financial_pl` declares an injection spot.

## Data Models

- `StatementLineMapping`, `ClosingResolution`: as in `open-mercato#6188`.
- `JpkKrFiling`, `JpkKrDeclarationInputs`: as in SPEC-010 (tables `financial_pl_accounting_jpk_kr_filing`, `financial_pl_accounting_jpk_kr_declaration_inputs`; `RPD` has eight amount fields).
- No entities for B1 (SPEC-011) and B4 (settings only).
- Table names follow `financial_pl_accounting_<entity>`; every table carries `tenant_id` and `organization_id`.

## API Contracts

Routes as specified in the source documents, under the module prefix:

- B1: `POST /api/financial-pl-accounting/tax/payment-instruction`, `POST /api/financial-pl-accounting/tax/mark-paid` (`financial_pl_accounting.tax.pay`).
- B2: `/api/financial-pl-accounting/statements/*` and `statement-line-mapping` (`financial_pl_accounting.statements.manage`).
- B3: SPEC-010's commands `financial_pl_accounting.jpk_kr.upsert_filing|generate|submit` behind routes requiring `financial_pl.view` / `.submit` / `.manage`.
- B4: `GET /api/financial-pl-accounting/vat-reconciliation?periodId=<uuid>`, `requireFeatures: ['financial_pl_accounting.reconciliation.view']`, exports `openApi`. Response `200 { periodId, year, month, input: { register, ledger, difference }, output: { register, ledger, difference }, notes: string[] }`; `404` unknown period; `422` period is not one calendar month, or no VAT accounts configured.

## Internationalization (i18n)

Namespace `financial_pl_accounting.*` (`statements.*`, `tax.*`, `jpk_kr.*`, `reconciliation.*`). Statutory line names stay untranslated, as in `#6188`.

## UI/UX

Backend pages under `backend/financial-pl-accounting/`: statements, statement line mapping, JPK_KR_PD filings, tax period-close block, VAT reconciliation (period picker, two tables, notes), settings for the VAT accounts. Action buttons are gated by the same feature the route requires.

## Migration & Compatibility

- New package and module; no existing `financial_pl` table, route, feature or event changes. Tenants on `financial_pl` alone are unaffected.
- Install requires the four modules above to be enabled; the generator stops the build otherwise.
- Release order: `financial_pl` with SPEC-012 A1 and A3 first, then this package.
- Uninstall: the package's tables remain; no `financial_pl` data depends on them.

## Implementation Plan

### Phase 0 (in `financial_pl`)
1. SPEC-012 A1 and A3 released. A2 follows independently.

### Phase 1 (this package)
1. Scaffold the package and manifest with `requires` and peers.
2. B1 per SPEC-011 (after #6340, #6013, #6168 merge).
3. B2 per #6188 (after #6340, #6013, #6038, #6711, #6188 merge).
4. B3 per SPEC-010, starting with vendoring the XSD (after #6038 merges; A1 released).
5. B4 per this document (after #6038 and A3).

### File Manifest

| File | Action | Purpose |
|---|---|---|
| `packages/financial-pl-accounting/package.json` | Create | Package, peers |
| `packages/financial-pl-accounting/src/modules/financial_pl_accounting/index.ts` | Create | Metadata, `requires` |
| `.../acl.ts`, `setup.ts`, `di.ts` | Create | Features, seeding, services |
| `.../tax/`, `statements/`, `jpk-kr/`, `reconciliation/` | Create | B1–B4, as in the source documents |

### Testing Strategy

- Contract tests against the real `financial_pl` services (A1, A3) and the real ledger services; golden files for the mikrorachunek; B4 fixtures with known differences; tenant isolation on every route.

## Risks & Impact Review

#### Hard dependency on unmerged core modules
- **Scenario**: A core module changes shape before merge and this package breaks.
- **Severity**: Medium
- **Affected area**: B1–B4
- **Mitigation**: Specs in `open-mercato` are the contract; implementation starts after each merge; contract tests.
- **Residual risk**: A later breaking change in core needs a coordinated release.

#### Version skew between `financial_pl` and this package
- **Scenario**: An older `financial_pl` without A1 or A3 is installed beside this package.
- **Severity**: Medium
- **Affected area**: JPK_KR_PD, VAT engine
- **Mitigation**: Peer range on the minimum `financial_pl` version; `requires` makes the module presence certain, the peer range its version.
- **Residual risk**: Custom installs that ignore peer warnings.

#### A locked period is not proof of reconciliation
- **Scenario**: A period is locked with `ledger.lockFiscalPeriod` directly, which skips the Posting Rules guard, and statements are generated from unreconciled zespół 4→5 data.
- **Severity**: High
- **Affected area**: B2
- **Mitigation**: Generation requires a locked period and a `CLOSING` entry, and keeps the two-variant parity check as backstop (`open-mercato#6188`); locking through `posting_rules.lockFiscalPeriod` is the intended path.
- **Residual risk**: Whether the parity check catches every case is for accounting-domain review.

#### Reconciliation false alarms
- **Scenario**: B4 shows a difference that is legitimate (fixed-asset VAT, deduction period).
- **Severity**: Low
- **Affected area**: B4 users
- **Mitigation**: The report is informational, lists the usual causes, and does not block anything.
- **Residual risk**: Users may over-trust or ignore it.

#### Missing VAT account configuration
- **Scenario**: A tenant has not set the VAT accounts and runs B4.
- **Severity**: Low
- **Affected area**: B4
- **Mitigation**: `422` with a message naming the missing setting.
- **Residual risk**: None.

## Final Compliance Report — 2026-10-08

### AGENTS.md Files Reviewed
- `AGENTS.md` (root, `official-modules`)
- `packages/core/AGENTS.md` (`open-mercato`, Cross-Module Coupling, module `requires`), as cited by the existing specs

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Modules remain isomorphic and independent | Compliant | Only DI services and `requires`; no import of `financial_pl` code |
| packages/core/AGENTS.md | Hard `requires` only for non-optional dependencies | Compliant | All four are called directly; none optional |
| packages/core/AGENTS.md | Upstream module must not know the consumer | Compliant | `financial_pl` and core know nothing of this package |
| root AGENTS.md | No direct ORM relations between modules | Compliant | Only FK-ids and DTO services |
| root AGENTS.md | Filter by `organization_id` and `tenant_id` | Compliant | All tables and services scoped |
| root AGENTS.md | One package, one module in `official-modules` | Compliant | Matches existing packages |
| root AGENTS.md | Routes export `openApi`, declare guards, validate with zod | Compliant (specified; verify in review) | API Contracts |
| root AGENTS.md | Feature naming `<moduleId>.<action>` | Compliant | Own features use the module prefix |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Services consumed match SPEC-012 and the `ledger` services | Pass | Table above |
| B4 inputs available | Pass | `getPeriodTotals` (A3), `getZois`, `getFiscalPeriod` (#6038) |
| Source documents agree on module id and prefixes | Pass | SPEC-010, SPEC-011 and `#6188` updated 2026-10-08 |

### Non-Compliant Items

None identified. Open ⚠ items above must be confirmed before implementation.

### Verdict

Draft: ready for maintainer review.

## Changelog

### 2026-10-08
- Initial specification. Records the split of the ledger-dependent Polish features out of `financial_pl`, the manifest and `requires`, the feature ids, the services consumed, and the Phase 1 VAT reconciliation report.
