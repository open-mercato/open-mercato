# Accounts Payable — vendors, purchase invoice lifecycle

**Related:** [General Ledger core engine](2026-08-18-general-ledger-core-engine.md)
(open, PR #5663 — the posting engine this spec books into), the future
[sales-invoice-gl-posting](2026-08-18-sales-invoice-gl-posting.md)
(planned, not written yet — the analogous subscriber pattern on the AR
side; same citation correction as in `Contractor Registry`'s Related
header), [Contractor Registry](2026-09-06-contractor-registry.md)
(open, PR #5955 — vendor registry — this spec consumes it, does not
duplicate it),
[Journal Entry Line Dimension](2026-09-06-journal-entry-line-dimension.md)
(open, PR #5972 — future consumer of AP's cost lines — the 490 engine,
this spec does not build it), [Accounts Payable —
Payments](2026-09-06-accounts-payable-payments.md) (sibling document —
payment batches, transfer execution, VAT whitelist verification;
split out of this document 2026-09-08, see Changelog). None of the
above three have merged as of this writing (2026-09-08, maintainer
review) — every link above resolves once its own PR lands, not
before.

## TLDR

Module handling the liability lifecycle from the invoice side: receipt
and approval of the purchase invoice (including the draft/buffer state
before final posting). Ends with a call to `postJournalEntry` in GL —
this spec does not change the posting engine, only uses it. Vendor
registration and verification lives in a separate module — see
`Contractor Registry`. Grouping approved invoices into payment batches
and executing the transfer lives in a separate, sibling module — see
`Accounts Payable — Payments` — this split is the result of independent
review, not the original design (see Changelog, 2026-09-08).

## Overview

On the event-storming wall the AP process is four parallel paths: (A)
vendor registration and verification (GUS/VIES/VAT whitelist — pulled
out to `Contractor Registry`), (B) purchasing materials (goods receipt
→ invoice → posted), (C) purchasing a fixed asset (asset capitalization,
depreciation schedule — pulled out to a separate Fixed Assets spec, see
`.ai/specs/2026-09-06-fixed-assets.md` — planned, not written yet;
no such file or PR exists today, 2026-09-08 maintainer review), (D)
outbound payments (budget
limits, payment batches — pulled out to
`2026-09-06-accounts-payable-payments.md`, see below). This document
covers **only B** — A, C, and D are deliberately pulled out (their own,
independent capabilities).

> **Market Reference**: SPEC-024 (the pre-workshop brief, "Accounts
> Payable Module" section) assumed full three-way matching
> (`matchToOrder` requiring `PurchaseOrder` and `GoodsReceipt`) and a
> separate `PaymentProposal`/`PaymentError` type. The wall (the
> verified source, see Design decisions) showed a simpler, two-step
> flow (goods receipt → invoice, no formal PO) and confirmed neither
> type in code — neither exists anywhere in the repo. What was
> confirmed at the workshop was adopted, and SPEC-024 was treated as a
> reference point for what was deliberately rejected (three-way
> matching) and why (Phase 2, no support in code).

## Problem Statement

Today there is no module responsible for the purchasing side — GL
(#5663) only posts final, balanced entries, but nothing manages the
invoice lifecycle before posting. This is a "blank page in code" (no
existing implementation to extend) — confirmed directly in the repo: no
`accounts_payable` module exists, no financial `PurchaseOrder`/
`GoodsReceipt` entity exists, and the WMS module
(`packages/core/src/modules/wms`) has goods receipt as a real,
quantity-only entity (`InventoryMovement`, `type: 'receipt'`) but
without any financial field or posting path — see Design decisions.
Scope and boundaries with neighboring modules (Contractor Registry,
payments, Fixed Assets, Posting Rules Engine) had to be settled
explicitly before designing the entities — which is what this document
now does.

**This document originally covered payments too** (`PaymentBatch`/
`PaymentBatchLine`) in one `accounts_payable` module. Two independent,
fresh-context reviews (compliance/checklist + architectural) both
independently reached a SPLIT verdict: separate ACL groups, separate
`postJournalEntry` calls to GL, coupling only through an FK (the same
shape as referencing a fully separate module), a separate legal-risk
domain (the VAT whitelist/mandatory split payment applies only to
payments). The team confirmed the split on 2026-09-08 — see Changelog
and `2026-09-06-accounts-payable-payments.md`.

## Proposed Solution

An independent `accounts_payable` module with one entity group:
**purchase invoices** (`VendorInvoice`/`VendorInvoiceLine`, draft state
→ approval → posted). The invoice approval flow uses the `workflows`
engine (see Design decisions below — this was not yet settled in the
skeleton and required verification in code). The module does not post
directly to the database — the transition to `posted` calls
`postJournalEntry` from GL through the generic `commandBus`, the same
way any other module calls someone else's command (see Architecture →
Cross-module integration). Grouping approved invoices into payment
batches and executing the transfer lives in the sibling module
`accounts_payable_payments`, which reads `VendorInvoice` via FK-id and
has a hard, declared dependency on this module (see this document's
Module Dependency, and the sibling doc's own `index.ts`).

### Design decisions (2026-09-07 — resolved at the workshop)

**The contractor is a shared entity, not duplicated in AP and AR.**
Single-responsibility test: the contractor registry (GUS/VIES
verification, bank account, approval flow) works independently of the
purchase invoice flow — so it lives in a separate, shared module
(`2026-09-06-contractor-registry.md`), and AP references it via FK-id.

**The invoice's draft (buffer) state is in Phase 1.** Without a
pre-posting state there's no way to build an approval flow — and that
is the whole point of AP existing. Invoice status: draft →
pending-approval → approved → posted.

**Account 300 (GR/IR) is in Phase 1.** The wall shows goods-receipt-
before-invoice as a normal, frequent case (the "purchase materials"
path), not an edge case.

**Approval flow: simple, single-step in Phase 1.** One approver, a
binary decision. Configurable amount thresholds and multi-step paths
are Phase 2.

**No special "hook" for the future 490 engine — with one known
transitional gap.** AP posts ordinary, balanced `JournalEntryLine`
rows to group-4 accounts — the posting-rules engine (Posting Rules
Engine, once it exists) reads from a separate dimension table
(`2026-09-06-journal-entry-line-dimension.md`), and needs nothing
extra from AP. The only convention: AP's account mapping points to
group 4, not directly to group 5. Known gap: the dimension table's
mere existence doesn't close the window — nothing writes to it yet,
until the Posting Rules Engine (built directly after AP, see
`.ai/specs/2026-09-06-posting-rules-engine.md` — planned, not
written yet; no such file or PR exists today, 2026-09-08 maintainer
review) actually starts doing
so (`2026-09-06-journal-entry-line-dimension.md` itself says: "empty
structure for now, no populating logic"). If AP starts posting before
the Posting Rules Engine exists at all, invoices posted in that window
will not have a recorded cost-center dimension for retroactive
reclassification — they will need to be manually reclassified once the
490 engine starts. Deliberately accepted as the cost of a short
transitional window, not overlooked.

**Purchase Order / three-way matching — Phase 2.** SPEC-024 (the
pre-workshop brief) assumed PO→GR→Invoice, but the wall (the current,
verified source) shows only goods-receipt→invoice (two-way). Phasing
follows what was confirmed at the workshop.

**Rejection due to a locked `FiscalPeriod` — now designed (see
below).** An invoice can sit in the buffer (draft →
pending-approval → approved) longer than an open fiscal period lasts.
Solution: see Architecture → Commands (`postVendorInvoice`) and Risks &
Impact Review → Data integrity failures.

**VAT whitelist/mandatory split payment (MPP) verification is not this
document's concern.** It's a hard legal blocker, but it applies at
**payment** time, not invoice receipt/posting — the full legal
rationale and design live in the sibling
`2026-09-06-accounts-payable-payments.md`.

### Design decisions (2026-09-07 — added during the full spec expansion)

The decisions below were not yet settled in the skeleton — each
required verification in real code (not on the wall), so they are
flagged separately.

**The invoice approval flow uses the `workflows` engine
(`defineWorkflow`/`USER_TASK`), not `useGuardedMutation`.** Verified in
code: the only implemented repo precedent for an approve/reject-type
decision (`sales.order-approval`,
`packages/core/src/modules/sales/workflows.ts`) uses the full workflow
engine — `USER_TASK` with a `formSchema` (`decision: approve |
reject`), automated transitions (`UPDATE_ENTITY` on status,
`EMIT_EVENT`), and a front end that completes the task via
`POST /api/workflows/tasks/:id/complete` (a plain `useMutation`, not
`useGuardedMutation` — this isn't a field edit through `CrudForm`).
`useGuardedMutation` as a "guarded row action" is a real pattern only
for a simple, reversible toggle (GL's fiscal-period lock/unlock) — not
for a one-off approve/reject decision. The AP invoice is exactly that
second case ("one approver, a binary decision"), so AP adopts the
`sales.order-approval` pattern 1:1: `submit for approval` emits an
event, `workflows.ts` declares a trigger on that event (`eventPattern`),
`registerWorkflowSafeCommands` authorizes the status-updating command,
and a widget injected into
`backend/accounts_payable/invoices/[id]/page.tsx` shows the pending
task — analogous to `widgets/injection/order-approval/`. The same fix
(the exact same wrong citation) was applied retroactively to the
already-open PR #5955 (Contractor Registry) — see that spec's
Changelog, 2026-09-07 "approval-pattern citation corrected".

**The call to `postJournalEntry` in GL goes through the generic
`commandBus`, not through `tryResolve`/a DI token like
`checkBankAccountWhitelist`.** This distinction matters: GL is not an
optional peer for AP (an AP module without GL makes no sense — it's a
hard, declared dependency), so `packages/core/AGENTS.md` →
Cross-Module Coupling doesn't apply here (that pattern is for
*optional* integration, where a missing peer must degrade safely). AP
calls `container.resolve('commandBus').execute('ledger.postJournalEntry', { input, ctx })`
— the real, two-argument `execute(commandId, options)` signature
(`packages/shared/src/lib/commands/command-bus.ts:223-226`; corrected
2026-09-08, maintainer review — an earlier draft cited a non-existent
three-argument form) — exactly the same generic mechanism that
`workflows`' `UPDATE_ENTITY` already uses to call commands by string
`commandId`
(`packages/core/src/modules/workflows/lib/activity-executor.ts`).
Decidedly simpler than inventing a new mechanism for this case — and
consistent with GL itself saying "Phase 1 comes from
`postJournalEntry` called programmatically by a downstream
integration" (GL doesn't yet have its own HTTP path for this).

**`goodsReceiptReference` is a real FK-id to `InventoryMovement`
(WMS), not free text — correction after independent review.** The
first version of this decision assumed no goods-receipt entity exists
in code. Independent, fresh-context review found this to be false:
`packages/core/src/modules/wms`'s `InventoryMovement` (`type:
'receipt'`, `referenceType: 'po'|'so'|'transfer'|'manual'|'qc'|'rma'`)
is a real, working goods-receipt entity, with a command
(`wms.inventory.receive`) and a UI (`ReceiveInventoryDialog.tsx`).
What actually doesn't exist is a disabled toggle
(`wms_integration_procurement_goods_receipt`) — and that only concerns
the future PO-to-receipt integration, not the receipt itself. Result:
`VendorInvoice.goodsReceiptReference` is a nullable `uuid` (FK-id →
`InventoryMovement.id` where `type = 'receipt'`, no ORM relation), not
a plain string.

**This does not change the account-300 analysis below.**
`InventoryMovement` is a purely quantity-based warehouse entity
(quantity/warehouse/location/lot), with no financial field whatsoever
(no `amount`, no `accountId`) and no call to
`postJournalEntry`/`commandBus` anywhere in
`wms/commands/inventory-actions.ts` (independently verified). So even
though the receipt entity exists, nothing on the WMS side still posts
the second leg of account 300 — the gap described below remains
current; only whether `goodsReceiptReference` is a real reference or
free text changes.

**Account 300 (GR/IR): a deliberately one-sided, transitional gap in
Phase 1 — not a mechanism that settles to zero.** The standard GR/IR
flow requires two postings: on goods receipt (DR cost/inventory, CR
300) and on the invoice (DR 300, CR liability) — only both together
zero out account 300. Because no path posts the first leg financially
(goods receipt — `InventoryMovement`, see above — exists as an entity,
but has no amount/account field and never calls `postJournalEntry`),
`postVendorInvoice` in this document posts **only** the second leg (DR
300, CR liability). Result: account 300 will show a growing, never-
zeroed DR balance until WMS starts posting receipts financially — this
is a deliberately accepted, explicitly documented transitional gap
(analogous to the cost-dimension/490 gap above), not a design flaw. See
Risks & Impact Review → Data integrity failures for the full
description and the revised mitigation (GL's own balance-lookup route
is cut from Phase 1 — see that Risk for details).

**Input VAT gets its own account — it is not silently absorbed into
the expense account.** Correction after independent review, which
traced the posting math by example: if `postVendorInvoice` posted a DR
per line only to its `accountId` with no separate VAT leg, then for the
entry to balance against a CR at the full gross liability amount, the
DR would have to silently include VAT — overstating expense in the P&L
and never recording input VAT as a receivable from the tax office (a
real asset item under Polish accounting rules). Fix:
`postVendorInvoice` posts a net DR per line to its `accountId`, one
aggregated DR to the configured input-VAT account
(`accounts_payable.vatInputAccountId`, the sum of `taxAmount` across
all lines), and a CR to the liability account for the full gross
amount — see Architecture → Commands, Data Models → Module Config.

**The approval flow calls a separate, narrow command — not
`updateVendorInvoice`.** The first version of this document registered
`accounts_payable.vendor_invoices.update` (the same command used to
edit a draft invoice's fields) as `registerWorkflowSafeCommands`'s
target for the `PENDING_APPROVAL` → `APPROVED`/`REJECTED` transition —
but `updateVendorInvoice` is defined above as working **only** on
`status === 'DRAFT'`. Independent review caught this contradiction:
either the status guard would reject the workflow's own transition, or
the "DRAFT only" rule would silently not apply to workflow-originated
calls — neither option had been designed. Fix: a separate, narrow
`applyVendorInvoiceApprovalDecision` command, registered separately in
`registerWorkflowSafeCommands`, which **only** moves `PENDING_APPROVAL`
→ `APPROVED`/`REJECTED` (and nothing else) — see Architecture →
Commands, Workflow definition. This is a deliberate departure from
`sales.order-approval`'s pattern (which reuses `sales.orders.update`
for both purposes) — verified that sales has this exact same latent
issue, unresolved in that module; AP avoids it rather than copying it.

**The hard dependency on `ledger` is a real mechanism
(`ModuleInfo.requires`), not just a statement in prose.** Independent
review verified that `metadata.requires: string[]` exists and is
validated at generation time
(`packages/shared/src/modules/registry.ts`,
`packages/cli/src/lib/generators/module-registry.ts`), used today by
`sales` (`requires: ['catalog','customers','dictionaries']`) and
`wms`. The first version of this document claimed AP declares this,
but never designed it anywhere (no `index.ts` in
Architecture/File Manifest) — fix: see Architecture → Module
Dependency (`index.ts`), File Manifest.

### Design decisions (2026-09-08 — Q1 resolved: split into two modules)

**Split into `accounts_payable` (this document — invoices) and
`accounts_payable_payments` (sibling document — payments).** Two
independent, fresh-context reviews (as `spec-checklist.md` requires)
independently reached a SPLIT verdict: separate ACL groups
(`invoices.*` vs `payments.*`), separate `postJournalEntry` calls to
GL (two different postings, two different moments), coupling only
through an FK (`PaymentBatchLine.vendorInvoiceId` — the same shape as
referencing the fully separate Contractor Registry module), a separate
legal-risk domain (the VAT whitelist/MPP applies only to payments, not
invoice receipt). The counter-argument for COHESIVE (a shared liability
account, live access to approved invoices when building a batch) was
real, but didn't win out — and the first version of this document
justified its "Pass" by analogy to how GL left `FiscalPeriod` in one
document, which on inspection turned out to be a misleading
comparison (GL's own scope-cohesion check also returned SPLIT and was
only kept bundled by an explicit stakeholder decision, not a clean
architectural justification). The team confirmed SPLIT on 2026-09-08.
The shared liability account (`accounts_payable.liabilityAccountId`)
remains **deliberately** owned by this document (set through its
config UI) and is **read** by `accounts_payable_payments` — the one
intentional coupling point between the two modules besides the FK
itself, documented explicitly in both documents to avoid drift.

**No per-vendor `LedgerAccount` — contractor-level tracking lives in
this module's own tables (control-account / subsidiary-ledger
pattern).** Contractors deliberately do not get their own account in
the chart of accounts. `accounts_payable.liabilityAccountId` is a
single, shared control account for all vendors — the standard
control-account pattern in double-entry bookkeeping. The per-vendor
breakdown ("how much do we owe Contractor X") lives as ordinary
application data — this module's `VendorInvoice` table and
`accounts_payable_payments`, both keyed by `vendorId` (plain FK-id) —
which together are the subsidiary ledger (księgi pomocnicze) that
GL's own spec already anticipated in its Out of Scope section ("fall
naturally out of a future Accounts Payable / Accounts Receivable
module", `2026-08-18-general-ledger-core-engine.md`), now realized
here rather than as a GL-level mechanism. Consequence: a question
about "immutability of a contractor's account" doesn't apply to
`LedgerAccount` at all — no such account exists. Protection against
stale contractor data (e.g. a changed bank account) already happens
one level down, at `JournalEntryLine.contractorSnapshot` (column
defined in `2026-08-18-general-ledger-core-engine.md`'s Design
decisions; see `2026-09-06-journal-entry-line-dimension.md` for why
it's handled this way rather than as a dimension row), not at the
chart-of-accounts level.

### Alternatives considered

| Alternative | Why Rejected |
|-------------|-------------|
| `useGuardedMutation` simple toggle for invoice approve/reject | Has no coverage in any real, implemented repo precedent for an approve/reject decision (only for reversible toggles like the GL lock/unlock); `sales.order-approval` — the only real precedent for this kind of decision — uses the full workflow engine |
| Skip account 300 in Phase 1, post straight to the group-4 account | Considered and rejected after consultation — the wall explicitly and deliberately wants account 300 in Phase 1 already (not as an edge case); a documented, one-sided transitional gap was adopted instead, see Design decisions above |
| Automatic vendor/category-to-account mapping (a rules engine) | No precedent whatsoever in the repo for this kind of mapping (verified — nothing similar exists); building AP's own rules engine would duplicate the future Posting Rules Engine (account 490), which is meant to do exactly this. Phase 1: manual account selection per invoice line + tenant-scoped configuration values (see Data Models, Module Config) |
| Keep invoices and payments in one `accounts_payable` module | Rejected 2026-09-08 after two independent reviews — see Design decisions, "Q1 resolved" |

## User Stories

- **AP clerk** wants to **enter a purchase invoice as a draft and fill
  it in progressively**, so they **don't get blocked on entering all
  the data at once in a single pass**.
- **AP clerk** wants to **submit an invoice for approval with one
  click**, so the **approver sees it in their task panel without
  manual notification**.
- **Approver** wants to **approve or reject an invoice from a single
  screen, with an optional comment**, so the **decision is documented
  and irreversible without a trace**.
- **Chief accountant** wants **certainty that a posted invoice never
  disappears from account 202 without a matching payment entry**
  (recorded by `accounts_payable_payments`), so **vendor reconciliation
  always balances** — this is exactly the cross-module relationship
  both documents must keep consistent despite the split (see Design
  decisions, "Q1 resolved").
- **Chief accountant** wants a **readable message instead of a raw
  command error when trying to post an invoice in a closed period**, so
  they **know what to do next (move the date, or ask for the period to
  be unlocked)**.

## Architecture

### Entities (`data/entities.ts`)

- `VendorInvoice` — `vendorId` (FK-id → `Contractor`, `uuid`, no ORM
  relation), `vendorSnapshot` (nullable `json` — the vendor's name/tax
  ID at the time the invoice was created, purely for rendering the list
  without a live join; analogous to `SalesInvoice.customerSnapshot` on
  the AR side, but a **different** snapshot than GL's
  `JournalEntryLine.contractorSnapshot` — the latter is created only at
  posting time and is GL's own audit record, not this module's UI
  data), `invoiceNumber` (the vendor's own invoice number, free text —
  this isn't a document we number ourselves), `invoiceDate`, `dueDate`,
  `currencyId` (FK-id, `uuid`, like `JournalEntry.currencyId` in GL),
  `status` (`DRAFT`/`PENDING_APPROVAL`/`APPROVED`/`REJECTED`/`POSTED`/
  `CANCELLED`), `goodsReceiptReference` (nullable `uuid`, FK-id →
  `wms.InventoryMovement.id` where `type = 'receipt'`, no ORM relation
  — see Design decisions), `totalNet`/`totalTax`/`totalGross`
  (`numeric(19,4)`, computed from the lines), `postedJournalEntryId`
  (nullable FK-id — set once, after a successful `postJournalEntry`;
  also serves as an idempotency guard against double posting),
  tenant/org scoped, `updatedAt` (optimistic lock active as long as
  `status !== 'POSTED'`), `deletedAt` (soft delete, blocked for
  statuses other than `DRAFT`/`REJECTED`/`CANCELLED` — see Commands).
  **Read by `accounts_payable_payments`** (FK-id
  `PaymentBatchLine.vendorInvoiceId`, only `POSTED` invoices can enter
  a payment batch) — this is a cross-module consumer of this entity,
  see the sibling document.
- `VendorInvoiceLine` — `vendorInvoiceId` (FK), `accountId` (FK-id →
  `LedgerAccount`, expected in group 3 [account 300] or group 4 —
  validated at the command level, not a database constraint, the same
  convention as GL's `LedgerAccountType`/`LedgerAccount` without
  enforcing numbering in the schema), `description`, `netAmount`,
  `taxRate`, `taxAmount`, `grossAmount` (`numeric(19,4)`), its own
  `organizationId`/`tenantId` (like `ContractorBankAccount` — not just
  inherited through `vendorInvoiceId`).

### Access Control (`acl.ts`)

Following the `customers`/`ledger` module convention
(`<module>.<resource>.<action>`, `manage`/`post` depending on `view`):

```typescript
export const features = [
  { id: 'accounts_payable.invoices.view', title: 'View vendor invoices', module: 'accounts_payable' },
  { id: 'accounts_payable.invoices.manage', title: 'Create and edit vendor invoices', module: 'accounts_payable', dependsOn: ['accounts_payable.invoices.view'] },
  { id: 'accounts_payable.invoices.approve', title: 'Approve or reject vendor invoices', module: 'accounts_payable', dependsOn: ['accounts_payable.invoices.view'] },
  { id: 'accounts_payable.invoices.post', title: 'Post vendor invoices to the ledger', module: 'accounts_payable', dependsOn: ['accounts_payable.invoices.view'] },
]
```

`createVendorInvoice`/`updateVendorInvoice`/`submitVendorInvoiceForApproval`
require `accounts_payable.invoices.manage`; `postVendorInvoice`
requires `accounts_payable.invoices.post` (separate from `.manage` —
mirroring `ledger.accounts.manage` vs `ledger.entries.post`: editing a
draft invoice is a different sensitivity than sending an irreversible
entry to GL).

**The invoice approve/reject decision is gated by
`accounts_payable.invoices.approve` (corrected 2026-09-08, maintainer
review).** Completing the `pending_approval` user task always requires
`workflows.tasks.complete` (from the `workflows` module, gating the
route itself — see Cross-module integration), but `UPDATE_ENTITY`'s
authorization check
(`packages/core/src/modules/workflows/lib/activity-executor.ts:644-657`)
separately requires the completing user to hold every feature in the
registered safe command's `requiredFeatures` — see Workflow
definition, where `accounts_payable.vendor_invoices.applyApprovalDecision`
is now registered against `['accounts_payable.invoices.approve']`. An
earlier draft of this section claimed the decision "has no ACL feature
of its own" and mirrored `sales.order-approval`'s `sales.orders.update`
→ `requiredFeatures: ['sales.orders.manage']` registration — that
claim was wrong (the decision was always gated by whichever feature
the registered command names) and the mirrored behavior was a latent
bug in the precedent, not a deliberate choice: `sales` does declare a
`sales.orders.approve` feature (`packages/core/src/modules/sales/acl.ts`),
but only uses it to gate the approval widget's visibility
(`workflows/widgets/injection/order-approval/widget.ts:9`), not the
transition itself — the transition still requires `sales.orders.manage`,
which is exactly what this module had copied. Registering
`applyVendorInvoiceApprovalDecision` against `.approve` instead closes
that gap for real, the same way this module already deliberately
improved on the `sales.order-approval` pattern once before (see Design
decisions, "The approval flow calls a separate, narrow command").

**No maker-checker control (self-approval) in Phase 1 — a documented
risk, not an oversight, and now a genuinely configurable one.** `admin`
gets `accounts_payable.invoices.approve` automatically
(`defaultRoleFeatures` grants `admin: ['accounts_payable.*']` — see
Module Setup) alongside `.manage`, so nothing stops that role from
entering an invoice and then approving it itself. `employee`'s default
list (`accounts_payable.invoices.view`, `.manage`) never included
`.approve`, so a tenant that wants genuine maker-checker separation can
grant `.approve` alone to a distinct approver role today — a
configuration option that actually works, unlike
`sales.order-approval`'s: there, granting only `sales.orders.approve`
lets a user see the widget but fails `UPDATE_ENTITY`'s authorization
check the moment they try to complete it, because the transition is
still gated by `.manage`. See Risks & Impact Review for the full
record of the residual (default-role) risk.

### Module Dependency (`index.ts`)

GL is a hard, declared dependency (see Design decisions, Cross-module
integration) — not an optional peer. Expressed through the real,
generation-time-validated `ModuleInfo.requires` mechanism
(`packages/shared/src/modules/registry.ts`), already used by `sales`
(`requires: ['catalog','customers','dictionaries']`) and `wms`:

```typescript
// index.ts
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'accounts_payable',
  title: 'Accounts Payable — Invoices',
  version: '0.1.0',
  description:
    'Vendor invoice lifecycle: draft, approval, and posting to the general ledger.',
  author: 'Open Mercato Team',
  license: 'MIT',
  requires: ['ledger'],
  ejectable: true,
}
```

**Correction (2026-09-08, this review round)**: the real `ModuleInfo`
type (`packages/shared/src/modules/registry.ts`) has no `id` field —
the identifying field is `name`, exactly as `sales`/`wms` use it. The
sample above was fixed to match; an earlier draft used `id:`, which
would not compile against the real type.

`contractors` is not on this list — this module only holds `vendorId`
as a plain FK-id (no `tryResolve`, no service call); live VAT-whitelist
verification lives in `accounts_payable_payments`, not here.

### Encryption (`encryption.ts`)

`VendorInvoice.vendorSnapshot` stores the vendor's denormalized name
and tax ID (see Entities) — structurally identical to
`SalesOrder.customerSnapshot`/`SalesQuote.customerSnapshot`, both
declared in `sales/encryption.ts`. AP does the same:

```typescript
// encryption.ts
import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'accounts_payable:vendor_invoice',
    fields: [{ field: 'vendor_snapshot' }],
  },
]

export default defaultEncryptionMaps
```

**Correction (2026-09-08, this review round)**: the real
`ModuleEncryptionMap` type (`packages/shared/src/modules/encryption.ts`)
is an array of `{ entityId, fields }` objects, with `fields` itself an
array of `{ field, hashField? }` rule objects — not a keyed object of
plain string arrays, as an earlier draft showed. The sample above now
matches `sales/encryption.ts`'s real shape exactly.

Reads go through `findWithDecryption`/`findOneWithDecryption`, always
passing `tenantId`/`organizationId` — as required by
`packages/core/AGENTS.md` → Encryption.

### Module Setup (`setup.ts`)

```typescript
defaultRoleFeatures: {
  admin: ['accounts_payable.*'],
  employee: [
    'accounts_payable.invoices.view',
    'accounts_payable.invoices.manage',
  ],
},

async seedDefaults({ em, tenantId, organizationId }) {
  // Registers the default 'accounts_payable.invoice-approval' workflow
  // through createWorkflowsModuleConfig — see Workflow definition
  // below. Doesn't write any rows itself: the code-defined
  // configuration (source: 'code') is projected by workflows until
  // someone materializes it in the database (see
  // packages/core/src/modules/workflows/AGENTS.md → Trigger Sources
  // And Precedence).
}
```

### Commands (Command Pattern, `commands/`)

- `createVendorInvoice` / `updateVendorInvoice` — `DRAFT` status only.
  Validates line totals (`netAmount`+`taxAmount` = `grossAmount` per
  line, sum of lines = header `totalNet`/`totalTax`/`totalGross`).
  Does not validate vendor verification — a draft invoice can exist
  before the vendor is fully verified in GUS/VIES (that only blocks
  payment in `accounts_payable_payments`, not entering the invoice).
- `submitVendorInvoiceForApproval` — `DRAFT` → `PENDING_APPROVAL`.
  Emits `accounts_payable.vendor_invoice.submitted` (persistent) — the
  only way to start the approval workflow, see Workflow definition.
  Requires at least one line.
- `applyVendorInvoiceApprovalDecision` — called **only** from inside
  the workflow (not directly from the UI — see Workflow definition),
  via `UPDATE_ENTITY`, `PENDING_APPROVAL` → `APPROVED` or `REJECTED`
  and nothing else (accepts no other fields). Registered separately in
  `registerWorkflowSafeCommands`, requires
  `accounts_payable.invoices.approve` (corrected 2026-09-08, maintainer
  review — see Access Control for why `.manage` was wrong).
  **Deliberately not `updateVendorInvoice`** — see Design decisions ("The approval flow
  calls a separate, narrow command") for the contradiction this
  avoids.
- `postVendorInvoice` — `APPROVED` → `POSTED`. Resolves `commandBus`
  from the container (see Cross-module integration) and calls
  `ledger.postJournalEntry` with: one **net** DR line per
  `VendorInvoiceLine` (on its `accountId`, the `netAmount`, not
  `grossAmount` — see Design decisions, "Input VAT gets its own
  account"), one aggregated DR line to the configured input-VAT
  account (`accounts_payable.vatInputAccountId`, the sum of
  `taxAmount` across all lines — skipped if the sum is zero), and one
  CR line to the configured liability account
  (`accounts_payable.liabilityAccountId`, the full `totalGross` amount
  — `ModuleConfigService`, see Data Models — **the same configuration
  value that `accounts_payable_payments` reads later**), with
  `referenceType: 'accounts_payable:vendor_invoice'`,
  `referenceId: invoice.id`. Sets `postedJournalEntryId` and emits
  `accounts_payable.vendor_invoice.posted` (see Events) only after
  success (idempotency guard — a repeat call on an invoice that
  already has `postedJournalEntryId` is a no-op, not a duplicate
  entry, and does not re-emit the event). **Locked-period handling**: if `ledger.postJournalEntry`
  rejects the call (the period covering `invoiceDate`/`postedAt` is
  locked), `postVendorInvoice` catches that error and returns a
  readable domain message (`FISCAL_PERIOD_LOCKED`, with the name/range
  of the locked period) — the invoice stays in `APPROVED` (it doesn't
  lose its approval, doesn't revert to `DRAFT`), ready for a retry once
  the period is unlocked or for a manual change of `invoiceDate` to the
  currently open period by the chief accountant. This closes a design
  decision that was still open in the skeleton ("handling not yet
  designed").
- `cancelVendorInvoice` — `DRAFT`/`REJECTED` → `CANCELLED` (soft
  delete via `deletedAt`). Blocked for `PENDING_APPROVAL`/`APPROVED`/
  `POSTED`.

### Workflow definition (`workflows.ts`)

A 1:1 mirror of the `sales.order-approval` pattern
(`packages/core/src/modules/sales/workflows.ts`) for the workflow
shape itself — steps, transitions, `USER_TASK` config — with one
deliberate difference: the registered safe command's
`requiredFeatures` names `accounts_payable.invoices.approve`, not
`accounts_payable.invoices.manage` (see Access Control, "The invoice
approve/reject decision is gated by `accounts_payable.invoices.approve`"):

```typescript
import { defineWorkflow, createWorkflowsModuleConfig } from '@open-mercato/shared/modules/workflows'
import { registerWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'

registerWorkflowSafeCommands([
  { commandId: 'accounts_payable.vendor_invoices.applyApprovalDecision', requiredFeatures: ['accounts_payable.invoices.approve'] },
])

const invoiceApproval = defineWorkflow({
  workflowId: 'accounts_payable.invoice-approval',
  workflowName: 'Vendor Invoice Approval Workflow',
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    {
      stepId: 'pending_approval',
      stepName: 'Pending Approval',
      stepType: 'USER_TASK',
      userTaskConfig: {
        formSchema: {
          type: 'object',
          required: ['decision'],
          properties: {
            comments: { type: 'string' },
            decision: { enum: ['approve', 'reject'], type: 'string' },
          },
        },
        slaDuration: 'PT24H',
      },
    },
    { stepId: 'approved', stepName: 'Approved', stepType: 'AUTOMATED' },
    { stepId: 'rejected', stepName: 'Rejected', stepType: 'AUTOMATED' },
    { stepId: 'end', stepName: 'Complete', stepType: 'END' },
  ] as const,
  transitions: [ /* start→pending_approval (auto, EMIT_EVENT already fired by
                    submitVendorInvoiceForApproval, not repeated here);
                    pending_approval→approved (preCondition: decision === 'approve',
                    UPDATE_ENTITY → applyApprovalDecision, then EMIT_EVENT
                    accounts_payable.vendor_invoice.approved); pending_approval→rejected
                    (preCondition: decision === 'reject', same shape, EMIT_EVENT
                    accounts_payable.vendor_invoice.rejected); both →end — identical
                    structure to sales.order-approval's own emit_order_approved/
                    emit_order_rejected activities, see that file (added 2026-09-08,
                    maintainer review — names which transition emits which event) */ ],
  triggers: [{
    triggerId: 'invoice_approval_trigger',
    name: 'Invoice Approval Trigger',
    eventPattern: 'accounts_payable.vendor_invoice.submitted',
    config: { entityType: 'VendorInvoice' },
    enabled: true,
    priority: 0,
  }],
})

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'accounts_payable',
  workflows: [invoiceApproval],
})

export default workflowsConfig
```

One structural difference from `sales.order-approval` — not
cosmetic, it follows directly from Design decisions: sales starts its
workflow immediately on **order creation** (`eventPattern:
'sales.order.created'` — the order has no separate draft state before
being sent for approval). AP has an explicit `DRAFT` state before
approval (Design decision: "Without a pre-posting state there's no way
to build an approval flow"), so the trigger binds to a separate event,
`accounts_payable.vendor_invoice.submitted`, emitted only by
`submitVendorInvoiceForApproval` — not by
`accounts_payable.vendor_invoice.created`.

### Events (`events.ts`)

```typescript
const events = [
  { id: 'accounts_payable.vendor_invoice.created', label: 'Vendor Invoice Created', entity: 'vendor_invoice', category: 'crud' },
  { id: 'accounts_payable.vendor_invoice.submitted', label: 'Vendor Invoice Submitted For Approval', entity: 'vendor_invoice', category: 'lifecycle' },
  { id: 'accounts_payable.vendor_invoice.approved', label: 'Vendor Invoice Approved', entity: 'vendor_invoice', category: 'lifecycle' },
  { id: 'accounts_payable.vendor_invoice.rejected', label: 'Vendor Invoice Rejected', entity: 'vendor_invoice', category: 'lifecycle' },
  { id: 'accounts_payable.vendor_invoice.posted', label: 'Vendor Invoice Posted', entity: 'vendor_invoice', category: 'lifecycle' },
] as const
```

`accounts_payable.vendor_invoice.posted` is emitted by
`postVendorInvoice` (see Commands) and is ephemeral (mirroring
`ledger.journal_entry.posted`) — no persistent subscriber is needed
yet in Phase 1; the future Posting Rules Engine subscribes directly to
`ledger.journal_entry.posted` (from GL), not to AP's events — AP isn't
its data source, GL is (see `2026-09-06-posting-rules-engine.md` —
planned, not written yet; no such file or PR exists today, 2026-09-08
maintainer review). `accounts_payable_payments`
does **not** subscribe to any of the above events — it reads
`VendorInvoice` status directly (a query, not an event) when building
a payment batch, see the sibling document.

### Cross-module integration

- **GL (`ledger.postJournalEntry`) — a hard, declared dependency, not
  an optional peer.** `packages/core/AGENTS.md` → Cross-Module
  Coupling describes `tryResolve` for **optional** integration; GL
  isn't optional here (an AP module without GL has no functional
  meaning). AP calls
  `container.resolve('commandBus').execute('ledger.postJournalEntry', { input, ctx })`
  — the same generic mechanism that `workflows`'
  `UPDATE_ENTITY` already uses to call any command by string
  `commandId`. No degradation to design: if `ledger` is disabled, AP
  simply doesn't work (much like GL itself doesn't work without
  `ledger`) — that's expected, not an error to handle.
- **Contractor Registry — plain FK-id, no integration.** `vendorId` is
  a plain FK-id (like every other one in this repo); this module never
  resolves or calls any service from `contractors`. Live VAT-whitelist
  verification (`contractorBankWhitelistCheck` through `tryResolve`,
  fail-closed) lives exclusively in `accounts_payable_payments` — see
  that document.

### Backend Pages (`backend/accounts_payable/`)

- `invoices/page.tsx` — invoice `DataTable` (status, vendor from
  `vendorSnapshot`, amount, due date).
- `invoices/create/page.tsx`, `invoices/[id]/page.tsx` — `CrudForm`
  with invoice lines as an inline sub-list; editable only in `DRAFT`.
  An injected approval-task widget at spot ID
  `accounts_payable.vendor_invoice.detail:details`, visible when the
  status is `PENDING_APPROVAL` and there's a task assigned to the
  current user. **Correction (2026-09-08, this review round)**: the
  real precedent (`workflows/widgets/injection/order-approval/`) shows
  the widget itself is owned and defined by `workflows`, not by the
  consuming module — `workflows` registers
  `workflows.injection.order-approval` into `sales`'s own declared spot
  ID (`sales.document.detail.order:details`) via `workflows`' own
  `injection-table.ts`. This module only needs to declare and document
  the spot ID above; the widget component, its feature gate
  (mirroring `sales.orders.approve`), and the injection-table entry
  belong to `workflows`, exactly as they do for `sales` today — not to
  this module, and there is no `sales/widgets/injection/order-approval/`
  path (an earlier draft cited a path that does not exist).

## Data Models

### VendorInvoice

- `id`: uuid (PK)
- `tenant_id`, `organization_id`: uuid
- `vendor_id`: uuid (FK-id → `contractors.Contractor`, no ORM relation)
- `vendor_snapshot`: json, nullable
- `invoice_number`: text
- `invoice_date`, `due_date`: date
- `currency_id`: uuid (FK-id → `currencies.Currency`, no ORM relation)
- `status`: text (`DRAFT`/`PENDING_APPROVAL`/`APPROVED`/`REJECTED`/`POSTED`/`CANCELLED`)
- `goods_receipt_reference`: uuid, nullable (FK-id → `wms.InventoryMovement`)
- `total_net`, `total_tax`, `total_gross`: numeric(19,4)
- `posted_journal_entry_id`: uuid, nullable (FK-id → `ledger.JournalEntry`)
- `updated_at`: timestamptz, nullable (optimistic lock, active as long as `status <> 'POSTED'`)
- `deleted_at`: timestamptz, nullable

Supporting index for the invoice list (status, vendor, due date — see
API Contracts): `(tenant_id, organization_id, status, due_date)`. A
separate index `(tenant_id, organization_id, vendor_id)` for the
vendor filter and for `accounts_payable_payments`'s query for
"approved, unpaid invoices for this vendor" (see the sibling document's
Cross-module integration).

### VendorInvoiceLine

- `id`: uuid (PK)
- `vendor_invoice_id`: uuid (FK)
- `tenant_id`, `organization_id`: uuid (own, not just inherited)
- `account_id`: uuid (FK-id → `ledger.LedgerAccount`, no ORM relation)
- `description`: text
- `net_amount`, `tax_rate`, `tax_amount`, `gross_amount`: numeric(19,4)

Supporting index: `(vendor_invoice_id)` for loading invoice lines.

### Module Config (`ModuleConfigService`, tenant scope)

Instead of building its own vendor/category-to-account mapping engine
(rejected, see Alternatives considered), AP stores exactly two
tenant-scoped configuration values through
`src/modules/configs/lib/module-config-service.ts`:

- `accounts_payable.liabilityAccountId` — the `LedgerAccount.id` of the
  vendor liability account (e.g. "202"), used as the CR in
  `postVendorInvoice`. **Owned by this document, but also read by
  `accounts_payable_payments`** (as the DR in its
  `markPaymentBatchSent`) — the one intentional, documented shared
  configuration point between the two documents (see Design decisions,
  "Q1 resolved"). Set once, in this document's config UI.
- `accounts_payable.vatInputAccountId` — the `LedgerAccount.id` of the
  input-VAT account (e.g. "223"), used as the aggregated DR in
  `postVendorInvoice` (see Design decisions, "Input VAT gets its own
  account"). Used exclusively in this document.

## API Contracts

### `GET /api/accounts_payable/invoices` / `POST /api/accounts_payable/invoices`

Standard `makeCrudRoute`.

- **Query**: `page?`, `pageSize?` (≤100), `status?`, `vendorId?`,
  `dueDateFrom?`, `dueDateTo?`.
- **Create body**: `{ vendorId, invoiceNumber, invoiceDate, dueDate,
  currencyId, goodsReceiptReference?, lines: { accountId,
  description, netAmount, taxRate }[] }`. `status` defaults to
  `DRAFT`, not settable on create.
- **Response 200 (list)**: `{ items: VendorInvoiceDto[], total, page,
  pageSize }` where `VendorInvoiceDto` is `{ id, vendorId,
  vendorSnapshot, invoiceNumber, invoiceDate, dueDate, currencyId,
  status, totalNet, totalTax, totalGross, postedJournalEntryId,
  updatedAt }`.
- **Response 403**: caller lacks `accounts_payable.invoices.view`
  (list) / `.manage` (create).

### `PUT /api/accounts_payable/invoices/:id`

Standard `makeCrudRoute` update, blocked (409) unless `status ===
'DRAFT'`.

### `DELETE /api/accounts_payable/invoices/:id`

Standard `makeCrudRoute` soft-delete, enforced via its `beforeDelete`
hook (`packages/shared/src/lib/crud/factory.ts`, real precedent:
`api_keys/api/keys/route.ts`) — blocked (409) unless `status` is
`DRAFT`/`REJECTED`/`CANCELLED`.

### `POST /api/accounts_payable/invoices/:id/submit`

Custom write route wired through the mutation guard registry (mapped
to `update`), per `packages/core/AGENTS.md` → API Routes — this isn't
a field edit, so it doesn't go through `makeCrudRoute`.

- **Response 200**: `{ id, status: 'PENDING_APPROVAL' }`.
- **Response 409**: `status !== 'DRAFT'` or no lines.
- **Response 403**: caller lacks `accounts_payable.invoices.manage`.

### `POST /api/accounts_payable/invoices/:id/post`

Custom write route (mapped to `update`).

- **Response 200**: `{ id, status: 'POSTED', postedJournalEntryId }`.
- **Response 409**: `status !== 'APPROVED'`.
- **Response 422 `FISCAL_PERIOD_LOCKED`**: `{ code:
  'FISCAL_PERIOD_LOCKED', periodStart, periodEnd }` — the period
  covering `invoiceDate` is locked; the invoice stays `APPROVED`.
  **Coordination note**: GL's own spec
  (`2026-08-18-general-ledger-core-engine.md`) describes
  `postJournalEntry` rejecting a locked period, but defines no typed
  error code for that rejection — `code: 'FISCAL_PERIOD_LOCKED'` is
  **this document's own proposal**, not a confirmed GL contract.
  Requires agreement with GL's implementation (either GL adds an
  error discriminator, or `postVendorInvoice` will have to recognize
  the rejection by exception content/class — to be settled at
  implementation time, not resolved by this spec on its own).
- **Response 403**: caller lacks `accounts_payable.invoices.post`.

## Migration & Deployment

New, additive tables: `accounts_payable_vendor_invoices`,
`accounts_payable_vendor_invoice_lines` — zero changes to existing
tables in other modules (GL, Contractor Registry). `onTenantCreated`
in `setup.ts` writes empty default values for
`accounts_payable.liabilityAccountId`/`vatInputAccountId` (a row in
`module_configs` with `tenant_id` set) — it can't pick a sensible value
automatically (it depends on the tenant's actual chart of accounts,
created manually through `ledger.createLedgerAccount`), so
`postVendorInvoice` rejects the call with a readable configuration
error until the accountant sets both values through the module
configuration screen. **`accounts_payable_payments`'s rollout depends
on `liabilityAccountId` already being set here** — rollout order: this
module first, the sibling module second.

## Implementation Plan

### Phase 1: Invoices, approval, posting

1. `index.ts` (`metadata.requires: ['ledger']`) + entities + migration
   (the two tables above) + indexes from Data Models +
   `encryption.ts` (`vendor_snapshot`).
2. `acl.ts` (four features, including `.approve`) + `setup.ts`
   (roles, `defaultRoleFeatures`).
3. `createVendorInvoice` / `updateVendorInvoice`.
4. `submitVendorInvoiceForApproval` + `events.ts` (declaring
   `accounts_payable.vendor_invoice.submitted` and the rest).
5. `workflows.ts` (the `accounts_payable.invoice-approval` definition,
   `registerWorkflowSafeCommands` on `applyVendorInvoiceApprovalDecision`
   against `accounts_payable.invoices.approve`) +
   `applyVendorInvoiceApprovalDecision`; declare the approval-task spot
   ID on `backend/accounts_payable/invoices/[id]/page.tsx` — the widget
   itself is created and injected by `workflows` (cross-module task,
   coordinate with that module's `injection-table.ts`, corrected
   2026-09-08 maintainer review — see Backend Pages).
6. `postVendorInvoice` (the `commandBus` call → `ledger.postJournalEntry`
   with three legs — net/VAT/liability, see Commands — handling
   `FISCAL_PERIOD_LOCKED`).
7. API routes + `api/openapi.ts` (including `DELETE`).
8. Backend pages (invoices list/create/edit).
9. Module config UI (setting `liabilityAccountId`/`vatInputAccountId`).
10. Unit + integration test coverage (see Testing Strategy).

### Phase 2 (deferred)

- Purchase Order / three-way matching (`matchToOrder`), once financial
  goods-receipt posting exists in WMS.
- Multi-step, threshold-based approval flow (amount thresholds,
  multi-person paths).
- Automatic vendor/category-to-account mapping — only once the
  Posting Rules Engine (account 490) is ready, so the same mechanism
  isn't duplicated twice.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `index.ts` | Create | `metadata.requires: ['ledger']` — hard dependency |
| `data/entities.ts` | Create | `VendorInvoice`, `VendorInvoiceLine` |
| `acl.ts` | Create | Four features (view/manage/approve/post) |
| `setup.ts` | Create | `defaultRoleFeatures`; `onTenantCreated` writing empty `module_configs` values |
| `encryption.ts` | Create | `vendor_snapshot` (mirroring `sales`'s `customer_snapshot`) |
| `events.ts` | Create | Five events (see Events) |
| `workflows.ts` | Create | The `accounts_payable.invoice-approval` definition, `registerWorkflowSafeCommands` on `applyVendorInvoiceApprovalDecision` |
| `commands/vendorInvoices.ts` | Create | `createVendorInvoice`, `updateVendorInvoice`, `submitVendorInvoiceForApproval`, `applyVendorInvoiceApprovalDecision`, `postVendorInvoice`, `cancelVendorInvoice` |
| `api/openapi.ts` | Create | `openApi` exports for every `accounts_payable` route |
| `api/invoices/route.ts` | Create | `VendorInvoice` CRUD (`makeCrudRoute`), including the `beforeDelete`-guarded `DELETE` |
| `api/invoices/[id]/submit/route.ts`, `.../post/route.ts` | Create | Custom guarded write routes |
| `backend/accounts_payable/invoices/page.tsx` (+ create/[id]) | Create | Vendor invoice list/create/edit UI |
| `backend/config/accounts_payable/page.tsx` | Create | `liabilityAccountId`/`vatInputAccountId` config UI |
| `commands/__tests__/*` | Create | Regression coverage for all commands above |
| `__integration__/*` | Create | Integration coverage: full submit→approve→post flow; `FISCAL_PERIOD_LOCKED` path; VAT posting balance |

## Testing Strategy

- Create a draft invoice, edit it, submit it for approval; approve it
  through `POST /api/workflows/tasks/:id/complete`; assert status
  `APPROVED` and the `accounts_payable.vendor_invoice.approved` event
  emitted.
- Same for rejection — assert `REJECTED`, the invoice can't be posted
  or resubmitted without returning to `DRAFT`.
- Post an approved invoice; assert a balanced `JournalEntry` with the
  correct `referenceType`/`referenceId`, a second call to
  `postVendorInvoice` on the same invoice is a no-op (idempotency
  guard).
- Post an invoice with `invoiceDate` in a locked period; assert a
  `422 FISCAL_PERIOD_LOCKED` response, the invoice stays `APPROVED`.
- Account-300 regression test: post two invoices with lines on account
  300; assert that the `JournalEntry` per invoice is balanced
  *internally* (this only checks the correctness of a single entry —
  it is not a test that "account 300's balance zeroes out", since by
  design it doesn't in Phase 1, see Design decisions and Risks).
- VAT regression test: post an invoice with two lines at different
  `taxRate` values; assert that the `JournalEntry` has a separate DR
  line on `vatInputAccountId` equal to the sum of `taxAmount` across
  both lines, that the lines on `accountId` per line carry **net**
  amounts (not gross), and that the CR on `liabilityAccountId` equals
  `totalGross`.

## Risks & Impact Review

### Data integrity failures

#### Double posting of the same invoice
- **Scenario**: `postVendorInvoice` called twice for the same invoice
  (e.g. a retry after a network timeout), before the first call
  manages to set `postedJournalEntryId`.
- **Severity**: High
- **Affected area**: `accounts_payable`, `ledger` (a duplicate,
  unbalanced entry on the liability account)
- **Mitigation**: `postedJournalEntryId` is checked and set in the
  same transaction as the `commandBus` call
  (`withAtomicFlush`/transaction wrapping); a second, concurrent
  attempt on the same invoice must see `postedJournalEntryId` already
  set and return a no-op instead of calling `postJournalEntry` again.
- **Residual risk**: a theoretical race window between reading and
  writing `postedJournalEntryId` under two simultaneous requests —
  requires a unique constraint or a select-for-update on
  `VendorInvoice.id` inside the command; to be confirmed at
  implementation time (not resolved by the data design alone).

#### Account 300 never zeroes out in Phase 1
- **Scenario**: Every invoice posted with a line on account 300
  increases its DR balance; nothing ever credits it (no financial
  goods-receipt posting). After months of operation, account 300 shows
  a large, growing balance that could be misread as an accounting
  error by someone unaware of this design decision.
- **Severity**: Medium
- **Affected area**: `ledger` (balance-sheet readability), accounting
- **Mitigation**: documented explicitly in Design decisions and in
  this risk (not hidden). GL's own spec explicitly cuts
  `getAccountBalance`/`GET /api/ledger/accounts/:id/balance` from
  Phase 1 (a stakeholder-directed scope reduction). Until GL adds that
  route, the only available mitigation is a manual SQL report on
  `journal_entry_line` (outside the product, requires database access)
  or a manual correction/reclassification once WMS starts posting
  goods receipts financially. This is a real, not merely cosmetic,
  cross-spec dependency — GL adding a balance route closes this
  mitigation gap more cheaply than anything AP could do alone.
- **Residual risk**: until WMS posts goods receipts financially,
  account 300's balance is, by definition, accounting-incorrect
  (one-sided) — deliberately accepted as the cost of phasing, not
  eliminable without building goods receipt earlier than planned.
  Additionally, until GL's balance route exists, even detecting this
  state requires a manual database query, not a screen in the
  product.

#### No reversal path for a wrongly-posted invoice
- **Scenario**: an invoice reaches `POSTED` (`postedJournalEntryId`
  set) with incorrect data — wrong amount, wrong account, wrong vendor
  — discovered only after posting.
- **Severity**: Medium-High
- **Affected area**: `accounts_payable`, `ledger` (an incorrect balance
  stands until corrected)
- **Mitigation**: none in Phase 1. This module defines no
  `reverseVendorInvoice`/`voidVendorInvoice` command and no unwind of
  `postJournalEntry`. The only path today is a manual, out-of-band
  correcting journal entry directly in `ledger` (outside this module,
  requires ledger access), not a documented, guarded operation of this
  module.
- **Residual risk**: real, and currently accepted as a Phase 1 gap — a
  genuine reversal/void flow (a new command, a new workflow state, and
  a corresponding reversing entry in `ledger`) is deferred to Phase 2.
  Flagged explicitly here (this review round) rather than left
  implicit, matching the sibling document's symmetric gap for `SENT`
  payment batches.

#### No maker-checker control (invoice self-approval)
- **Scenario**: the same person, holding both
  `accounts_payable.invoices.manage` and
  `accounts_payable.invoices.approve` (e.g. the `admin` role, which
  gets both automatically via the `accounts_payable.*` wildcard — see
  Module Setup), creates an invoice, submits it for approval, and
  completes their own approval task, approving their own invoice with
  no second person in the loop.
- **Severity**: Medium (financial control, not data loss)
- **Affected area**: `accounts_payable.invoices.*`, the approval flow
- **Mitigation (corrected 2026-09-08, maintainer review)**: role
  configuration — and, unlike the mirrored `sales.order-approval`, one
  that actually works. `employee`'s default `defaultRoleFeatures`
  never included `.approve` (see Access Control), so a tenant that
  wants a real approver role can grant `.approve` alone to it today;
  that role can complete the approval task and nothing else
  invoice-related. `sales.order-approval` cannot offer the same
  guarantee: it declares `sales.orders.approve`, but never registers
  it against the transition's `registerWorkflowSafeCommands` entry
  (`sales.orders.update` still requires `sales.orders.manage`), so
  granting only `.approve` there lets a user see the widget but fails
  `UPDATE_ENTITY`'s authorization check the moment they try to
  complete it — no functioning maker-checker role is possible in
  `sales` today. This module's registration against `.approve` (see
  Access Control, Workflow definition) closes that gap for itself; an
  earlier draft of this section described the old, non-functional
  `sales`-style mitigation as the practical option, which was wrong.
- **Residual risk**: no code-level enforcement (e.g. "assignee
  different from the invoice's creator" — the runtime check
  `2026-09-06-contractor-registry.md` uses for its own four-eyes
  requirement) exists here — nothing stops an administrator from
  granting both features to the same role, which is exactly what the
  default `admin` role does. Accepted as a Phase 1 gap: unlike
  Contractor Registry's Problem Statement, this module's own Problem
  Statement never frames approval as a fraud-prevention control, so a
  hard runtime self-approval block is not justified here — the
  configuration option (now genuinely functional) is considered
  sufficient for Phase 1. Revisit in Phase 2 alongside the
  multi-step, threshold-based approval flow.

### Cascading failures & side effects

#### `ledger.postJournalEntry` unavailable (the `ledger` module disabled)
- **Scenario**: `commandBus.execute('ledger.postJournalEntry', ...)`
  throws, because `ledger` isn't registered.
- **Severity**: Critical
- **Affected area**: the whole `accounts_payable` module — it can't
  post anything.
- **Mitigation**: no degradation to design — this is a hard dependency
  (see Cross-module integration), not an optional peer.
  `accounts_payable` declares `ledger` as a required module through
  `index.ts`'s `metadata.requires`.
- **Residual risk**: none — this is the expected behavior for a
  missing hard dependency, analogous to GL itself not working without
  a database.

#### The `accounts_payable.vendor_invoice.submitted` event doesn't reach the workflow
- **Scenario**: the persistent-event worker is offline at the moment
  of `submitVendorInvoiceForApproval`; the event waits in the queue.
- **Severity**: Medium
- **Affected area**: the approval flow (delayed, not lost)
- **Mitigation**: the durable queue (`@open-mercato/queue`) delivers
  the event once the worker returns — no data loss, only delay. The
  invoice is visible in the UI as `PENDING_APPROVAL` the whole time
  (persistent state in the database, independent of the workflow's own
  state).
- **Residual risk**: none — this is exactly the behavior
  `packages/events/AGENTS.md` designs the durable queue for.

### Tenant & data isolation

Both entities have their own `tenant_id`/`organization_id`
(`VendorInvoiceLine` has its own scope columns, not just inherited
through the FK, mirroring `ContractorBankAccount`).
`ModuleConfigService` with an explicit `tenantId` in scope guarantees
that one tenant's liability account never leaks as a fallback to
another (see `packages/core/AGENTS.md` → Module Config — a scoped
write never touches the global row).

### Migration & deployment

See the Migration & Deployment section above — two new, additive
tables, zero changes to existing ones. `onTenantCreated` is idempotent
(can run multiple times without duplicating `module_configs` rows —
`ModuleConfigService`'s partial unique indexes guarantee this).

## Out of scope (tracked separately)

- Grouping invoices into payment batches, executing transfers, VAT-
  whitelist verification — see
  `2026-09-06-accounts-payable-payments.md`.
- Purchase Order / three-way matching — Phase 2, waiting on financial
  goods-receipt posting in WMS.
- Multi-step, threshold-based approval flow — Phase 2.
- Automatic vendor/category-to-account mapping — waiting on the
  Posting Rules Engine (account 490), so the mechanism isn't
  duplicated.

## Final Compliance Report — 2026-09-08

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/core/src/modules/workflows/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `vendorId`, `currencyId`, `accountId`, `goodsReceiptReference` all FK-id only |
| root AGENTS.md | Filter by organization_id | Compliant | Both entities tenant/org scoped; `VendorInvoiceLine` carries own scope columns |
| `packages/core/AGENTS.md` → API Routes | All API route files MUST export `openApi` | Compliant | `api/openapi.ts` covers every route, per File Manifest |
| `packages/core/AGENTS.md` → API Routes | Custom write routes wire the mutation guard registry | Compliant | `submit`/`post` routes mapped to `update` operation |
| `packages/core/AGENTS.md` → Cross-Module Coupling | Hard dependency uses direct resolution, not `tryResolve` | Compliant | `ledger.postJournalEntry` via direct `commandBus.execute` — verified against `packages/core/src/modules/workflows/lib/activity-executor.ts` and real cross-module command calls elsewhere in the repo that need no allowlist |
| `packages/core/AGENTS.md` → Cross-Module Coupling (hard dependency mechanism) | Hard dependency declared through `ModuleInfo.requires` | Compliant | `index.ts` with `metadata.requires: ['ledger']`, matching `sales`/`wms`'s real usage. **Corrected this review round**: an earlier draft's sample used a non-existent `id:` field instead of the real `name:` field — fixed to match `sales`/`wms` exactly (see Architecture → Module Dependency) |
| `packages/core/AGENTS.md` → Database Entities | User-editable entities MUST include `updated_at` | Compliant | `VendorInvoice` has `updatedAt`; `VendorInvoiceLine` is a sub-resource guarded by its parent aggregate (exempt, per the same rule's own exemption list) |
| `packages/core/AGENTS.md` → Database Entities | Standard column contract includes `deleted_at` | Compliant | `VendorInvoice` has `deletedAt`; status guard enforced at both the command layer (`cancelVendorInvoice`) and the route layer (`DELETE`'s `beforeDelete` hook) |
| `packages/core/AGENTS.md` → Encryption | GDPR/PII fields declared in `<module>/encryption.ts`, read via `findWithDecryption` | Compliant | `encryption.ts` declares `vendor_snapshot`, mirroring `sales`'s already-encrypted `customer_snapshot`. **Corrected this review round**: an earlier draft's sample used a keyed-object shape instead of the real `ModuleEncryptionMap[]` array-of-`{entityId, fields}` shape — fixed to match `sales/encryption.ts` exactly |
| `packages/core/AGENTS.md` → Access Control (RBAC) | Features declared per module, naming `<module>.<action>` | Compliant | Four features (`view`/`manage`/`approve`/`post`) — `approve` added 2026-09-08, maintainer review, closing the self-approval ACL gap (see Design decisions, Risks) |
| `packages/events/AGENTS.md` | Events declared with `as const`; subscribers export `metadata` | Compliant | Five events declared; no persistent subscriber needed in Phase 1 |
| `packages/queue/AGENTS.md` | Workers idempotent, export `metadata` | N/A | This module ships no queue worker in Phase 1 — no background job crosses a request boundary |
| `packages/core/src/modules/workflows/AGENTS.md` | Event triggers for cross-module workflow starts; `registerWorkflowSafeCommands` gates `UPDATE_ENTITY` | Compliant | `accounts_payable.invoice-approval` triggers on `accounts_payable.vendor_invoice.submitted`, mirroring `sales.order-approval`'s `sales.order.created` trigger; the registered command is a dedicated `applyVendorInvoiceApprovalDecision`, not the general-purpose `update` |
| `BACKWARD_COMPATIBILITY.md` | Database schema additive-only | Compliant | Two new tables only, zero changes to existing modules' schemas |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match architecture | Pass | Entities in Architecture and Data Models agree |
| API contracts match data models | Pass | Every documented field/filter has a backing column |
| Commands defined for all mutations | Pass | Every status transition has a named command |
| Double-entry postings balance | Pass | `postVendorInvoice` posts three legs — DR net per line, aggregated DR to `vatInputAccountId`, CR `totalGross` to the liability account |
| Risks cover all write operations | Pass | Double-posting, konto 300, ledger-unavailable, event-queue delay, maker-checker, tenant isolation, migration, and (added this review round) the missing reversal-path gap all addressed |
| Scope cohesion vs. other modules | Pass | Single capability (vendor invoice lifecycle), independently deployable given its one hard dependency (`ledger`) — payments split out per Q1 resolution below |
| Scope cohesion *within* this document | Pass | One entity group, one lifecycle, one GL integration seam — the prior bundling of payments (a second, separate GL integration seam and ACL group) was resolved by the split recorded in Design decisions |
| Cross-module coupling mechanism matches dependency type | Pass | Hard dependency (`ledger`) via `commandBus` + `ModuleInfo.requires`; plain FK-id reference to `Contractor` (no coupling mechanism needed, no service resolved) |

### Non-Compliant Items

None outstanding after this review round's fixes. **This review round
(2026-09-08, post-split, English translation + fresh-context review)
found and fixed three real defects**, none caught by this document's
own prior self-assessment: an `index.ts` sample using a non-existent
`ModuleInfo.id` field (real field is `name`); an `encryption.ts` sample
using the wrong shape for `ModuleEncryptionMap` (real shape is an array
of `{entityId, fields}`, `fields` itself an array of `{field}` rule
objects); and a widget-placement sample citing a non-existent path
(`sales/widgets/injection/order-approval/`) and, more substantively,
describing the ownership backwards — the real precedent
(`workflows/widgets/injection/order-approval/`) has the *workflow*
module own and inject the widget into the consumer's spot, not the
other way around. Also added: a Risks entry for "no reversal path for
a wrongly-posted invoice", previously undocumented.

**A second review round (2026-09-08, external maintainer review of PR
#5962) found and fixed a further four defects**, all verified against
the real repository before being accepted: the approval decision was
gated only by `workflows.tasks.complete` in prose, while the real
`UPDATE_ENTITY` authorization check also required
`accounts_payable.invoices.manage` (fixed by adding a dedicated
`accounts_payable.invoices.approve` feature and registering
`applyVendorInvoiceApprovalDecision` against it — see Access Control,
Workflow definition, Risks); two `commandBus.execute` citations used a
non-existent three-argument form instead of the real
`execute(commandId, options)` signature; the `workflows.ts` code
sample omitted the required `stepName` on every step and `name` on its
trigger; and the File Manifest / Implementation Plan still assigned
creation of the approval widget to this module, contradicting the
already-corrected Backend Pages text. Also added, on the same round:
naming which transition emits which `.approved`/`.rejected` event and
which command emits `.posted` (previously left implicit); PR-status
annotations on the Related header's GL/Contractor Registry/JELD links
and explicit "not written yet" framing for `fixed-assets.md`/
`posting-rules-engine.md` (none of the five resolve today). See
Changelog for the full list with sources.

### Verdict

**Ready for maintainer review.** Every AGENTS.md rule checked is
compliant. This document is the narrower half of what was originally
a single combined Accounts Payable specification — two independent,
fresh-context reviews (compliance/checklist + architectural sanity)
found the combined document's own scope-cohesion self-assessment
unreliable (it cited a misrepresented GL precedent) and recommended a
split; the team confirmed the split on 2026-09-08. A further pair of
fresh-context reviews of the post-split, translated document (this
round) found the three defects listed above, now fixed. This document
carries forward, unchanged, every fix from the combined document's
earlier independent-review round that applies to the invoice half
(encryption gap, workflow/command contradiction, VAT posting gap,
corrected goods-receipt claim, undesigned hard dependency) — see
Changelog for the full history. The payments half, its own risks, and
its own compliance report now live in
`2026-09-06-accounts-payable-payments.md`.

## Changelog

### 2026-09-06

- Initial specification (Design Decisions only, from event-storming
  wall).

### 2026-09-07

- Full expansion from skeleton to complete `om-spec-writing` template
  (at this point still combined with payments in one document).
  Research pass against the real repo (not the pre-workshop SPEC-024
  brief) before writing: confirmed no `PurchaseOrder`/`GoodsReceipt`/
  `PaymentOrder` entity exists anywhere; confirmed GL's
  `JournalEntry`/`JournalEntryLine` have no `deletedAt` (append-only,
  direct precedent for this module's own posted-invoice immutability);
  confirmed the generic `commandBus` mechanism (used by `workflows`'
  `UPDATE_ENTITY`) as the correct way to call `ledger.postJournalEntry`,
  distinct from Contractor Registry's narrower `tryResolve`/DI-token
  pattern.
- Verified two significant claims against real code before committing
  them to this document (both flagged to the user as open questions,
  not silently decided): the vendor-invoice approval mechanism (workflow
  engine, not `useGuardedMutation` — confirmed via
  `sales/workflows.ts` and the task-completion API; the same fix was
  applied back to Contractor Registry's PR #5955, which had cited the
  wrong precedent) and konto 300's one-sidedness (no goods-receipt
  posting exists anywhere to pair with it — user decided to keep it in
  Phase 1 anyway, documented as a known transitional gap rather than
  silently designed around).
- Added a new, previously-undecided design decision:
  `goodsReceiptReference` is a FK-id to `wms.InventoryMovement` (later
  corrected the same day — see below — from an initial, wrong
  assumption that no such entity exists).
- Added a new, previously-undecided design decision: automatic
  vendor/category-to-account mapping is out of scope for Phase 1
  (would duplicate the future Posting Rules Engine); Phase 1 uses
  manual per-line account selection plus tenant-scoped
  `ModuleConfigService` values.

### 2026-09-07 (cont. — independent review round, while still combined with payments)

Two fresh-context reviews (compliance/checklist + architectural
sanity) were run against the full expansion above, per the same
protocol used for GL and Contractor Registry. Findings verified
against the real repo before acting on them; fixes applied in this
same round (only the ones affecting the invoice half are listed here
— the payments-half fixes from this same round are recorded in
`2026-09-06-accounts-payable-payments.md`'s own Changelog):

- **Encryption gap (fixed)**: no `encryption.ts` existed for
  `vendorSnapshot` (vendor name/NIP), structurally identical to
  `sales`'s already-encrypted `customer_snapshot`. Added
  `encryption.ts`.
- **Workflow/command contradiction (fixed)**: the approval workflow's
  `UPDATE_ENTITY` step called `accounts_payable.vendor_invoices.update`
  — the same command defined elsewhere in this document as
  `DRAFT`-only, which the workflow's own `PENDING_APPROVAL` transition
  would then contradict. Replaced with a dedicated, narrow
  `applyVendorInvoiceApprovalDecision` command, registered separately
  in `registerWorkflowSafeCommands`, that only moves `PENDING_APPROVAL`
  → `APPROVED`/`REJECTED`. Noted as a deliberate departure from
  `sales.order-approval`'s own pattern (which reuses its general
  `.update` command and carries the same latent risk, unaddressed
  there).
- **VAT posting gap (fixed)**: traced the double-entry math by hand —
  as originally written, `postVendorInvoice` had no dedicated VAT leg,
  which would have silently absorbed VAT into cost/300 accounts and
  never recorded the VAT-recoverable receivable. Added a third posting
  leg (aggregated DR to a new `vatInputAccountId` module-config value)
  and corrected the per-line DR to net (not gross) amounts.
- **False "no goods-receipt entity" claim (corrected)**: independent
  review found `wms.InventoryMovement` (`type: 'receipt'`) is a real,
  working entity — only its *financial* posting doesn't exist (no
  amount/account fields, never calls `postJournalEntry`). Corrected
  `goodsReceiptReference` from free text to a real FK-id; the konto
  300 one-sided-gap analysis itself needed no change, since it never
  depended on the receipt entity not existing, only on nothing
  posting money against it.
- **Undesigned hard dependency (fixed)**: Risks asserted AP declares
  `ledger` as a required module "at the app registration level" but
  never designed it. Found the real mechanism (`ModuleInfo.requires`,
  already used by `sales`/`wms`) and added `index.ts` to Architecture
  and File Manifest.
- **Unrealistic risk mitigation (corrected)**: the konto-300 risk's
  mitigation assumed an account-balance UI that GL's own spec
  explicitly cuts from Phase 1 (`getAccountBalance`). Reworded to
  state the real, more limited mitigation (manual SQL report) and
  flagged the GL balance route as a cross-spec dependency worth
  closing.
- **Maker-checker gap (recorded, not fixed)**: neither this document
  nor the `sales.order-approval` precedent it mirrors prevents an
  invoice's creator from also completing their own approval task.
  Recorded as a new Risk entry rather than silently accepted; no
  code-level fix designed for Phase 1.
- **`FISCAL_PERIOD_LOCKED` contract (flagged, not resolved)**: GL's
  own spec rejects a locked-period posting but defines no typed error
  code for it — this document's `FISCAL_PERIOD_LOCKED` is a proposal,
  not a confirmed contract. Flagged inline in API Contracts as a
  cross-spec coordination item.
- **Dangling cross-reference (softened)**: the `sales-invoice-gl-posting.md`
  citation in the Related header pointed at a document that doesn't
  exist yet anywhere (not even on GL's own branch) — reworded to match
  how Contractor Registry's Related header already handles the same
  citation ("the future ...", not presented as an existing sibling).
- **Scope-cohesion SPLIT (escalated, then resolved 2026-09-08 — see
  below)**: both reviews independently leaned SPLIT for invoices vs.
  payments, and one of them found this document's own justification
  (an analogy to how GL kept `FiscalPeriod` bundled) misrepresented
  that precedent — GL's own check also returned SPLIT and was only
  kept bundled by an explicit stakeholder override. Recorded as **Q1**
  pending resolution, per `spec-checklist.md`'s escalation protocol.

### 2026-09-08 — Q1 resolved: split into two documents

- Resolved Q1: split the combined `accounts_payable` document into
  this document (`accounts_payable` — vendor invoice lifecycle only)
  and a new sibling, `2026-09-06-accounts-payable-payments.md`
  (`accounts_payable_payments` — payment batches, VAT-whitelist
  verification, payment posting). Removed `PaymentBatch`/
  `PaymentBatchLine` entities, `payments.*` ACL features,
  `createPaymentBatch`/`updatePaymentBatch`/`confirmPaymentBatch`/
  `markPaymentBatchSent`/`cancelPaymentBatch` commands,
  `payment_batch.*` events, the `contractorBankWhitelistCheck`
  `tryResolve` integration, and `defaultCashAccountId` — all moved to
  the sibling document verbatim (with its own Changelog crediting the
  same independent-review round). Kept `accounts_payable.liabilityAccountId`
  in this document as the intentionally shared config value the
  sibling document reads (documented explicitly in both, to avoid
  drift). Corrected the `goods_receipt_reference` column type in Data
  Models from `text` to `uuid` — a leftover inconsistency from the
  2026-09-07 goods-receipt correction that had updated the Entities
  prose and API contract but not the Data Models schema table itself.
  Removed the temporary Open Questions section; Internal Consistency
  Check and Verdict rewritten to be unconditional again.
- Translated the document to English (this pass) — the Polish version
  is superseded by this one; no content change beyond translation.

### 2026-09-08 (cont. — fresh-context review of the post-split, English
document; this pass)

Ran the `om-spec-writing` skill's Step 8 (checklist review, with the
scope-cohesion item delegated to a fresh-context subagent) and Step 9
(Compliance Gate) on this document for the first time since the split
— the split itself had never been through this formal process before.
Findings, each personally re-verified against the real repository
before being accepted (not taken on the reviewing agent's word alone):

- Fixed `index.ts`: real `ModuleInfo` has no `id` field (real field is
  `name`); added the full metadata shape matching `sales`/`wms`
  precedent.
- Fixed `encryption.ts`: real `ModuleEncryptionMap` is an array of
  `{entityId, fields}` objects (`fields` itself an array of `{field,
  hashField?}` rule objects), not a keyed object of plain string
  arrays — fixed to match `sales/encryption.ts` exactly.
- Fixed the approval-task widget sample in Backend Pages: the cited
  path `sales/widgets/injection/order-approval/` doesn't exist, and
  the underlying claim was backwards — the real precedent
  (`workflows/widgets/injection/order-approval/`) has the *workflow*
  module own and inject the widget into the consuming module's spot
  (`sales.document.detail.order:details`), not the consuming module
  defining its own widget. Corrected this module's sample to declare
  only the spot ID, matching the real division of ownership.
- Added a Risks entry for "no reversal path for a wrongly-posted
  invoice" — previously undocumented, symmetric to the same gap now
  also documented in the sibling payments document.
- Updated the Final Compliance Report (Compliance Matrix, Non-Compliant
  Items, Verdict) to record all of the above.

### 2026-09-08 (cont. — control-account / subsidiary-ledger design
decision)

Added a Design Decision documenting that `liabilityAccountId` (the
shared control account) together with `VendorInvoice.vendorId` (this
module's own tables) implement the standard control-account /
subsidiary-ledger accounting pattern — in response to a maintainer
question about the correct archetype for handling a contractor's
account/bank-detail changes. This confirms rather than changes the
existing architecture; cross-checked against `2026-08-18-general-
ledger-core-engine.md`'s Out of Scope section (which already
anticipated this design) and `2026-09-06-journal-entry-line-
dimension.md` (where contractor-data-change protection actually
lives, via `contractorSnapshot`) — both updated in the same round to
keep the three documents consistent.

### 2026-09-08 (cont. — external maintainer review of PR #5962, four
majors)

An external maintainer review of the split PR (invoices + payments,
review scope: both documents together) found four majors and six
minors/nits. This entry covers the fixes affecting this document (the
invoices half); the sibling document's Changelog covers the rest.
Every finding personally re-verified against the real repository
before being fixed, not accepted on the review's word alone:

- **ACL gap (major)**: the approval decision's real authorization gate
  was `accounts_payable.invoices.manage` (via `UPDATE_ENTITY`'s
  `requiredFeatures` check on the registered safe command,
  `activity-executor.ts:644-657`), not "no ACL feature of its own" as
  this document claimed — and the claimed `sales.order-approval`
  precedent for that framing was itself a latent bug in `sales`
  (`sales.orders.approve` exists but only gates the widget, never the
  transition). Fixed by adding `accounts_payable.invoices.approve`
  and registering `applyVendorInvoiceApprovalDecision` against it —
  see Access Control, Workflow definition, Risks, Compliance Matrix.
- **`commandBus.execute` signature (minor)**: both citations used a
  non-existent three-argument form; corrected to the real
  `execute(commandId, { input, ctx })` two-argument signature
  (`packages/shared/src/lib/commands/command-bus.ts:223-226`).
- **`workflows.ts` sample (minor)**: added the required `stepName` on
  every step and `name` on the trigger (both required by the real
  builder types); named which transition emits `.approved`/`.rejected`
  and which command (`postVendorInvoice`) emits `.posted`, previously
  left to an elided comment.
- **Widget-ownership contradiction (minor)**: the File Manifest and
  Implementation Plan step 5 still assigned creating the approval
  widget to this module, contradicting the Backend Pages correction
  from the prior review round. Dropped the File Manifest row; reworded
  step 5 to declare only the spot ID and name the widget's creation as
  a cross-module task belonging to `workflows`.
- **Dangling links (minor)**: annotated the Related header's GL/
  Contractor Registry/JELD links with their open PR numbers (#5663/
  #5955/#5972 — none merged as of this writing); marked
  `fixed-assets.md` and `posting-rules-engine.md` explicitly as
  planned, not written yet, wherever cited by path.
- Updated the Final Compliance Report (Compliance Matrix, Non-Compliant
  Items) to record all of the above.
