# SPEC-012: `financial_pl` integration contracts (JPK transport, KSeF → AP bridge, VAT register read service)

## TLDR

**Key Points:**
- Three additions to `financial_pl`, each a small, additive contract: a DI service that sends JPK files (`jpkTransportService`), an optional action that turns a received KSeF invoice into an Accounts Payable draft, and a read-only DI service over the VAT register (`vatRegisterReadService`).
- They let the sibling package `financial_pl_accounting` (SPEC-013) use `financial_pl` without importing its code or touching its entities, and let `financial_pl` stay installable without a ledger.

**Scope:**
- A1 `jpkTransportService`: `submit`, `pollStatus`. The signing certificate and private key never leave `financial_pl`.
- A2 KSeF → AP bridge: command `financial_pl.received_invoice.create_vendor_draft`, field `ReceivedInvoice.linkedVendorInvoiceId`, one UI action. Optional integration through `tryResolve`; no `requires`.
- A3 `vatRegisterReadService.getPeriodTotals`: aggregated VAT register figures for one month, no entities, no personal data.

**Concerns:**
- A1 and A3 become public, versioned contracts between two packages in this repository. A change to their shape is a breaking change.
- A2 depends on the Accounts Payable and Contractor Registry code, which today exist as specs in `open-mercato` (#5962, #5955).


## Open items

Decisions in this document are a proposed current state. The points below are marked **⚠ NEEDS HUMAN CONFIRMATION** in the body and are for the maintainers of `financial_pl` to settle during implementation:

1. **A1, gateway part size.** The MF gateway's size limit per uploaded part; a full-year Dziennik / KontoZapis file may exceed it, and Phase 1 sends a single part.
2. **A1, `AuthData` for natural persons.** The production authorization path (`buildJpkAuthData`, marked in code as not verifiable in the test environment) and whether JPK_KR_PD needs it.
3. **A2, empty `fa3Xml`.** The fallback when the invoice XML is missing: number from `PurchaseVatRecord.documentNumber`, one line built from the sums, VAT rate only when it matches a statutory rate.
4. **A3, period semantics.** Whether `PurchaseVatRecord.year/month` is the deduction period the declaration uses.
5. **A3, source of the VAT figure.** Whether the VAT engine takes the amount from a generated JPK_V7 declaration when one exists, or computes it from register sums with an operator-entered `priorSurplus`.

## Overview

`financial_pl` covers KSeF 2.0 / FA(3) exchange, JPK_V7 from its own register tables (`PurchaseVatRecord`, `ReceivedInvoice`, `SalesInvoicePlMeta`), and invoice authoring. It declares no `requires` and imports from core only `directory`, `progress` and `sales`. Its README positions it for standalone installs on `@open-mercato/core` ≥ 0.6.6.

The Polish features that read a general ledger (tax engines, Bilans/RZiS, JPK_KR_PD, VAT reconciliation) belong to a separate package, `financial_pl_accounting` (SPEC-013), so that `financial_pl` does not have to depend on `ledger`. That package needs three things from `financial_pl`; this document defines them. The bridge in A2 is the one addition that serves `financial_pl`'s own users: it connects a received invoice to the accounts-payable ledger.

> **Market Reference**: Comarch Optima records a purchase document in the VAT register first and posts it to the books in a separate "Księguj" step; `2026-09-06-accounts-payable.md` (`open-mercato#5962`) already cites this. That is the model here: the register stays the evidence for the JPK_V7 declaration, and posting is a separate, later action in another module. Rejected: making `financial_pl` post to the ledger itself.

## Problem Statement

1. **JPK_KR_PD needs the existing JPK transport.** `lib/jpk/jpk-submission-client.ts` implements the MF gateway protocol over any XML (the `InitUpload` metadata carries no form code; signing uses the organization's certificate). A module in another package cannot import it: root `AGENTS.md` requires modules to remain isomorphic and independent, and the certificate and key must not be handed out.
2. **Received invoices stop at the register.** A supplier invoice fetched from KSeF lands in `ReceivedInvoice` and `PurchaseVatRecord`. Entering the same invoice in Accounts Payable is manual, and nothing prevents it from being entered twice.
3. **VAT figures are only reachable through `financial_pl`'s entities.** The VAT tax engine (SPEC-011) and the reconciliation report (SPEC-013) need the period totals the JPK_V7 declaration is built from, and direct access to `financial_pl` entities from another module would be an ORM-level coupling.

## Proposed Solution

| Decision | Rationale |
|---|---|
| A1 is a DI service registered by `financial_pl`, taking the XML as a string and resolving the signer by `tenantId`/`organizationId` | The protocol is already generic over XML; the service only adds a module boundary. Certificate and key stay encrypted per organization inside `financial_pl` |
| A1 mirrors the existing `JpkSubmissionResult` union instead of throwing | Callers (the JPK_KR_PD commands) already branch on it; no behavioral change for JPK_V7 |
| A2 lives in `financial_pl`, as a consumer of AP and Contractor Registry | Dependency direction stays consumer → provider (`packages/core/AGENTS.md`, Cross-Module Coupling). AP and Contractor Registry know nothing about `financial_pl` |
| A2 is optional: `tryResolve` for AP and for the contractor lookup; the action is hidden when either is missing | Never declare a hard `requires` on an optional peer (`packages/core/AGENTS.md`) |
| A3 is a read-only DTO service wrapping the same aggregation JPK_V7 uses | One source of truth: the engine and the declaration cannot disagree |

### Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Add `requires: ['ledger']` to `financial_pl` and keep everything in one module | Forces a general ledger on every KSeF-only install; ties release cadence of KSeF fixes to the ledger |
| New package imports `submitJpk` directly | Direct import between modules; exposes the signer material path |
| Reconciliation and engines read `financial_pl` entities by FK-id queries | ORM-level coupling between modules |
| Bridge implemented in `accounts_payable` | Makes AP depend on `financial_pl`; reverses the dependency direction |

## User Stories / Use Cases

- **Accountant** wants to create a purchase draft in Accounts Payable from a received KSeF invoice so that the invoice is not retyped and a duplicate is caught.
- **Accountant** wants to send the annual JPK_KR_PD with the same certificate already configured for JPK_V7 so that no second signing setup exists.
- **Tax engine** wants the VAT register totals for a month so that the VAT liability follows the declaration's evidence.

## Architecture

### A1. `jpkTransportService`

Registered in `financial_pl`'s `di.ts` under the token `jpkTransportService`. Resolved by modules that `requires` `financial_pl`.

```ts
interface JpkTransportService {
  submit(input: {
    tenantId: string
    organizationId: string
    jpkType: string            // label for logs and audit only, e.g. 'JPK_KR_PD'; no behavioral effect
    xml: string
    onReference?: (referenceNumber: string) => Promise<void> | void
  }): Promise<JpkSubmissionResult>

  pollStatus(input: {
    tenantId: string
    organizationId: string
    referenceNumber: string
  }): Promise<JpkSubmissionResult>
}

type JpkSubmissionResult =
  | { ok: true; referenceNumber: string; status: string; upoXml?: string }
  | { ok: false; referenceNumber?: string; status?: string; error: string }
```

- Internally resolves the organization's signer (`certificatePem`, `privateKeyPem`), the MF public certificate and the environment from `financial_pl`'s own settings, then calls `submitJpk` / `pollJpkStatus` unchanged. Signer material is never returned and never logged.
- Errors keep the existing convention: operator-facing configuration errors (missing signer certificate, missing MF certificate) carry the `[internal]` prefix and contain no key or certificate content.
- No authorization inside the service, like `contractorBankWhitelistCheck`: the caller owns authorization and passes explicit scope. The service does not read request context.
- No idempotency in the service. A caller that can race (two concurrent submits) claims its own record first, as `commands/jpk.ts` does with a conditional update before calling the gateway.
- **Phase 1 keeps the current single-part upload** (`jpk-part-1.bin`). A full-year `Dziennik`/`KontoZapis` may outgrow a single part; multi-part upload and streaming are Phase 2 and tracked with SPEC-010 Q6.
- **⚠ NEEDS HUMAN CONFIRMATION (maintainers of `financial_pl`):** (a) the gateway's size limit per part; (b) the production authorization path for natural persons (`buildJpkAuthData`, marked in code as not verifiable in the test environment), and whether JPK_KR_PD needs it.

### A2. KSeF received invoice → AP draft

Command `financial_pl.received_invoice.create_vendor_draft`, input `{ receivedInvoiceId, expenseAccountId, dueDate? }`. Scope is derived with `resolveCommandScope(ctx)`, never from the body.

Steps:
1. Load the `ReceivedInvoice` for the scope. Stop if `linkedVendorInvoiceId` is set and the linked invoice is not cancelled.
2. Read the document number and lines from `fa3Xml` (`P_2`, invoice lines). If `fa3Xml` is null, use `PurchaseVatRecord.documentNumber` through `linkedPurchaseRecordId` for the number and build one line from the sums (`netAmount`, `vatAmount`); the VAT rate is derived from the sums only when it matches a statutory rate, otherwise the action stops with a message. **⚠ NEEDS HUMAN CONFIRMATION** (fallback behavior).
3. Match the supplier: `contractorLookupByNip({ tenantId, organizationId, nip: issuerNip })` (`open-mercato#5955`). A non-matching NIP returns `null`. If there is no contractor, create one with `createContractor` from the invoice's issuer data; it starts `PENDING_APPROVAL` and triggers the vendor-approval workflow. If the contractor exists without the vendor role, stop with a message and change nothing.
4. Create the draft with the AP command `createVendorInvoice`: `vendorId`, `vendorSnapshot { name: issuerName, taxId: issuerNip }`, `invoiceNumber`, `invoiceDate` (`issueDate`), `dueDate` (from `fa3Xml` payment terms when present, else the value from the dialog, else `issueDate`), `currencyId` from `currency`, lines with the account chosen in the dialog (`expenseAccountId`). The draft is created in `DRAFT`; AP does not check supplier verification when creating.
5. Store `ReceivedInvoice.linkedVendorInvoiceId` with a conditional update (`WHERE linked_vendor_invoice_id IS NULL OR the linked invoice is cancelled`), so two clicks cannot create two drafts.
6. On AP's `409 DUPLICATE_VENDOR_INVOICE`, do not create: offer to link `existingInvoiceId` instead and store it on confirmation.

Optional integration: AP and the contractor lookup are resolved with `tryResolve`; when either is absent the action and the link column are hidden. `financial_pl` declares no `requires` on `accounts_payable` or `contractors`.

The expense account is chosen in the action dialog on every call (the last choice is remembered per user in the UI); no new setting is added in Phase 1. Automatic account mapping waits for the Posting Rules Engine, as in AP's Out of scope.

### A3. `vatRegisterReadService`

Registered in `di.ts`. Read-only, explicit scope, DTOs only.

```ts
interface VatRegisterReadService {
  getPeriodTotals(input: {
    tenantId: string
    organizationId: string
    year: number
    month: number
  }): Promise<{
    year: number
    month: number
    output: { byRate: { rate: string; net: string; vat: string }[] }
    input: {
      netFixedAssets: string
      vatFixedAssets: string
      netOther: string
      vatOther: string
      corrFixedAssets: string
      corrOther: string
      selfAssessedVat: string
    }
  }>
}
```

- Amounts are decimal strings (numeric(19,4)). `rate` is the register's own rate code.
- Implemented as a thin wrapper over the register aggregation that JPK_V7 generation already uses (`lib/jpk/compute-declaration.ts`; the exact function is named at implementation), not a second computation.
- The period is the register's own `year`/`month` (`PurchaseVatRecord.year`, `.month`); a quarterly filer sums three months in the caller. **⚠ NEEDS HUMAN CONFIRMATION:** that this period is the deduction period the declaration uses.
- Netting (output VAT minus input VAT, prior surplus carry-over) is not done here; the VAT engine does it (SPEC-011) with the operator-entered `priorSurplus` as an input. **⚠ NEEDS HUMAN CONFIRMATION:** whether the engine should instead take the figure from a generated JPK_V7 declaration when one exists.

## Data Models

- `ReceivedInvoice` (table `financial_pl_received_invoice`, existing): add `linkedVendorInvoiceId` (uuid, nullable, FK-id to `accounts_payable.VendorInvoice`, no ORM relation). Additive migration. Index on `(organization_id, tenant_id, linked_vendor_invoice_id)` where not null.
- No other schema change. A1 and A3 are services over existing data.

## API Contracts

- `POST /api/financial-pl/received-invoices/:id/vendor-draft`: body `{ expenseAccountId: string (uuid), dueDate?: string (date) }`. `requireAuth: true`, `requireFeatures: ['financial_pl.view', 'accounts_payable.invoices.manage']`; creating a contractor additionally requires the contractor-creation feature declared by `open-mercato#5955`. Calls the command through the command bus. Exports `openApi`. Validation with zod.
- Responses: `200 { vendorInvoiceId, created: boolean }`; `404` unknown invoice; `409 { code: 'ALREADY_LINKED', vendorInvoiceId }`; `409 { code: 'DUPLICATE_VENDOR_INVOICE', existingInvoiceId }` (from AP, offering a link); `422` for an unmatched-vendor-role, a missing document number, or an underivable VAT rate; `403` when a required feature is missing; `404` when AP or the contractor lookup cannot be resolved (the UI hides the action in that case).
- A1 and A3 are DI services, no HTTP.

## Internationalization (i18n)

Keys under `financial_pl.vendor_draft.*` for the action label, dialog fields and the messages above. No new keys for A1 and A3 (no UI).

## UI/UX

On the received invoices list and detail: an action "Create purchase draft in AP", visible only when AP and the contractor lookup resolve, opening a dialog with the expense account (required) and due date. After creation, a column or field shows the linked AP invoice id. Only the registered users with the features above see the action.

## Migration & Compatibility

Additive: one nullable column and three new services. No existing contract changes. A1 and A3 become public contracts of `@open-mercato/financial-pl`; their shape is versioned with the package, and a breaking change needs a major version. The first `financial_pl` release containing A1 and A3 is the minimum peer version for `financial_pl_accounting`.

## Implementation Plan

### Phase 1
1. A1: `jpkTransportService` over the existing client; DI registration; unit tests with the existing fetch-injection pattern (`fetchImpl`) for success, rejection and missing-certificate errors.
2. A3: `vatRegisterReadService.getPeriodTotals` as a wrapper over the declaration aggregation; a test that its totals equal the JPK_V7 declaration inputs for the same period.
3. A2: migration for `linkedVendorInvoiceId`; command, route, UI action; integration tests for the link race, the duplicate response, the missing-role stop and the hidden action without AP.

### Phase 2
1. A1: multi-part upload and streaming input (with SPEC-010 Q6).
2. Widget injection spot on the JPK_V7 screen for the VAT reconciliation widget (SPEC-013).

### File Manifest

| File | Action | Purpose |
|---|---|---|
| `packages/financial-pl/src/modules/financial_pl/services/jpk-transport-service.ts` | Create | A1 |
| `packages/financial-pl/src/modules/financial_pl/services/vat-register-read-service.ts` | Create | A3 |
| `packages/financial-pl/src/modules/financial_pl/di.ts` | Modify | Register A1 and A3 |
| `packages/financial-pl/src/modules/financial_pl/data/entities.ts` | Modify | `linkedVendorInvoiceId` |
| `packages/financial-pl/src/modules/financial_pl/commands/received-invoice-vendor-draft.ts` | Create | A2 command |
| `packages/financial-pl/src/modules/financial_pl/api/received-invoices/[id]/vendor-draft/route.ts` | Create | A2 route |
| `packages/financial-pl/src/modules/financial_pl/backend/...` | Modify | A2 action and link column |

### Testing Strategy

- Unit: A1 result mapping and error prefixes; A3 totals against fixtures; A2 line extraction from sample FA(3) XML.
- Integration: A2 end to end with AP present and absent; tenant isolation of all three services.

## Risks & Impact Review

#### Public contract drift between packages
- **Scenario**: A1 or A3 changes shape in a `financial_pl` release and `financial_pl_accounting` breaks at runtime.
- **Severity**: Medium
- **Affected area**: JPK_KR_PD submission, VAT engine
- **Mitigation**: Named DI tokens, a peer range on the minimum `financial_pl` version, contract tests in `financial_pl_accounting` against the real services.
- **Residual risk**: Version skew in a custom install is possible until the peer range is enforced by the package manager.

#### Signing material exposure
- **Scenario**: A1 leaks the certificate or key through a result, a log or an error message.
- **Severity**: Critical
- **Affected area**: Every JPK submission for the organization
- **Mitigation**: The service never returns signer material; errors carry only operator-facing configuration messages without content; a test asserts no PEM block appears in any result or error.
- **Residual risk**: None beyond the existing handling in `jpk-submission-client.ts`.

#### Duplicate or wrong purchase drafts
- **Scenario**: The bridge creates a second draft for the same invoice, or a draft with a wrong VAT rate.
- **Severity**: Medium
- **Affected area**: Accounts Payable data
- **Mitigation**: Conditional update of the link; AP's duplicate guard (`409`) before create; lines from `fa3Xml`, with the underivable-rate stop; a draft is only a draft, reviewed before posting.
- **Residual risk**: A cancelled-then-recreated draft leaves a cancelled invoice in AP; acceptable.

#### Large JPK_KR_PD upload
- **Scenario**: A full-year journal exceeds a single upload part or memory.
- **Severity**: High for large tenants
- **Affected area**: A1, SPEC-010
- **Mitigation**: Phase 1 keeps current behavior and limits; Phase 2 adds multi-part and streaming.
- **Residual risk**: Large tenants cannot use JPK_KR_PD until Phase 2.

#### Tenant isolation
- **Scenario**: A caller passes the wrong `tenantId` or `organizationId` to A1 or A3.
- **Severity**: High
- **Affected area**: Cross-tenant data and submissions
- **Mitigation**: Explicit scope arguments, every query filtered by `organization_id` and `tenant_id`; the commands in the sibling package derive scope from the authenticated context.
- **Residual risk**: Same as `ledgerBulkReadService` and `contractorBankWhitelistCheck`: scope is the caller's responsibility.

## Final Compliance Report — 2026-10-08

### AGENTS.md Files Reviewed
- `AGENTS.md` (root, `official-modules`)
- `packages/core/AGENTS.md` (`open-mercato`, Cross-Module Coupling), as cited by the existing specs

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Modules remain isomorphic and independent; no direct ORM relations between modules | Compliant | A1 and A3 are DI services; `linkedVendorInvoiceId` is an FK-id |
| packages/core/AGENTS.md | Never declare a hard `requires` on an optional peer | Compliant | A2 uses `tryResolve`; no new `requires` |
| packages/core/AGENTS.md | Upstream module must not know the consumer | Compliant | AP and Contractor Registry are unchanged and unaware of `financial_pl` |
| root AGENTS.md | Filter by `organization_id` and `tenant_id` | Compliant | Explicit scope in every contract |
| root AGENTS.md | Validate input with zod; guards declared on routes; routes export `openApi` | Compliant (specified; verify in review) | API Contracts |
| root AGENTS.md | Do not return sensitive data in errors | Compliant (specified; verify in review) | A1 error convention and a test |
| root AGENTS.md | Mutations are commands | Compliant | A2 command; A1 and A3 do not mutate |
| root AGENTS.md | Undo contract for each mutation | Non-compliant | A2 has no undo: a created draft is cancelled in AP (`cancelVendorInvoice`), after which the link may be replaced. To be stated explicitly in the command at implementation |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | One new column, used by the route |
| Risks cover all write operations | Pass | A2 is the only write |

### Non-Compliant Items

- **Rule**: Undo behavior specified for each mutation. **Gap**: A2 states cancellation in AP but not a formal undo handler. **Recommendation**: define a no-undo contract with the reason, as SPEC-010 does for `.generate`.

### Verdict

Draft: ready for maintainer review; blocked for implementation until the ⚠ items are confirmed and the undo statement is written.

## Changelog

### 2026-10-08
- Initial specification. Written from the mapping of `financial_pl` against the financial module specs (`open-mercato#6061`) and the code of `official-modules` (branch `feat/financial-pl-invoice-ux`).
