# Contractor Registry — implementation guide

**Related:** [Contractor Registry](2026-09-06-contractor-registry.md) (full spec — read this for the *why* behind every decision below; this document is the *what* and *in what order*, for someone about to write the code)

## What you're building, in one paragraph

A new, independent module (`contractors`) with two things a developer
touches directly: a **contractor record** (`Contractor` — tax
identity: NIP, name, address, GUS/VIES verification status) and its
**bank accounts** (`ContractorBankAccount` — 0..N per contractor,
checked live against the Biała Lista VAT whitelist). Nothing else in
this module calls into AP, AR, or any other module — it's a shared
service other modules resolve by FK-id or by DI token, not a consumer
of them.

## The two entities, one sentence each

- **`Contractor`** — `isVendor`/`isCustomer` (bool, not exclusive),
  `nip`/`nipHash` (unique per organization while `deletedAt` is null,
  immutable once set), `name`, `address`, `contactEmail`/`contactPhone`,
  `verificationStatus` (`PENDING`/`VERIFIED`/`FAILED`),
  `lastCheckStatus`/`lastCheckedAt`/`lastCheckRequestId` (typed,
  non-PII diagnostic fields — **not** the raw GUS/VIES response, see
  the pitfall below), `approvalStatus`
  (`PENDING_APPROVAL`/`APPROVED`/`REJECTED`), `createdByUserId` (backs
  the self-approval guard).
- **`ContractorBankAccount`** — `contractorId` (FK), `accountNumber`
  (encrypted), `isPrimary` (exactly one `true` per contractor,
  enforced by both the command and a partial unique index — see the
  pitfall below, this one changed), `lastVerifiedAt`/
  `lastVerificationStatus` (UX cache only — see the pitfall below, this
  one matters most), its own `organizationId`/`tenantId` (not just
  inherited via `contractorId`).

For exact fields/types, see the full spec's Architecture → Entities
and Data Models. Don't re-derive them here — copy from there.

## One flow, start to finish

Registering a new vendor and paying them for the first time:

1. AP staff enters a NIP. `createContractor` checks `nipHash`
   uniqueness for `(tenant, organization)`, persists the contractor
   with `verificationStatus: 'PENDING'`, and enqueues
   `workers/verifyContractorRegistry.ts`.
2. The worker calls GUS (and VIES, if applicable), fills in
   `name`/`address` if missing, sets `verificationStatus` to
   `VERIFIED` or `FAILED`. This never blocks step 1 — GUS/VIES being
   down does not stop a contractor from being created.
3. AP staff adds a bank account via `createContractorBankAccount`.
   `isPrimary: true` on this call automatically unsets any other
   primary for the same contractor, inside the same transaction.
4. `createContractor` (step 1) also emitted
   `contractors.contractor.created`, triggering the
   `contractors.vendor-approval` workflow — a `USER_TASK` sitting on
   the contractor's own detail page. Someone with `contractors.approve`
   (**not** `contractors.manage` — a different feature, deliberately,
   so the person who registered the vendor can't also approve it)
   completes the task via `POST /api/workflows/tasks/:id/complete`,
   calling `applyContractorApprovalDecision` from inside the workflow.
   This is independent of steps 2–3 above and can happen before or
   after them — but not before what comes next.
5. Before the first payment, AP resolves `contractorBankWhitelistCheck`
   from this module's `di.ts` (via its own local `tryResolve` wrapper —
   **not** an HTTP call to this module's own API) and invokes it. **This
   command now rejects outright, before making any network call, if
   `approvalStatus` isn't `APPROVED`** — step 4 above is a hard
   prerequisite, not a parallel nice-to-have. Once past that check, it
   performs a **live** call to the Ministry of Finance's Biała Lista
   API for the exact `accountNumber`/`nip` pair, returns the fresh
   result, and — only as a side effect — updates
   `lastVerifiedAt`/`lastVerificationStatus` for the UX badge. AP
   blocks the payment on anything other than a fresh `WHITELISTED`
   result.
6. AP posts the payment in GL and writes a `contractorSnapshot` (name,
   NIP, account, verification status *at that exact moment*) onto the
   `JournalEntryLine` it creates — that snapshot, not a live join to
   `Contractor`, is what an accountant sees when reopening this
   invoice six months later, even if the vendor's account changes
   after.

That's the whole write path this module owns.

## Build order

Follow `Implementation Plan → Phase 1` in the full spec — it's now
numbered 1–11 (grew by one step for the approval workflow, confirmed
in scope 2026-09-08) and matches the `File Manifest` table 1:1. Don't
reorder it; steps 1–2 (entities/migration, ACL/setup) have to exist
before anything else compiles or is reachable. High-level shape:

1. Entities + migration (both tables, plus the two supporting indexes
   named in Data Models, **plus the two partial unique indexes** —
   `contractor_bank_account_one_primary_uq` and the `nip_hash`
   uniqueness scoped `where deleted_at is null`, see the `isPrimary`
   pitfall below) + `encryption.ts` (`nip` → `nip_hash`,
   `account_number`) — write the encryption map in this same step, not
   deferred to a later one.
2. `acl.ts` (**three** features — `contractors.view`/`.manage`/
   `.approve`, not two; see the four-eyes pitfall below) + `setup.ts` +
   `di.ts` (registers `contractorBankWhitelistCheck` — read the DI
   pitfall below before you build the HTTP route, not after)
3. `createContractor` / `updateContractor`
4. `createContractorBankAccount` / `updateContractorBankAccount`
5. `workers/verifyContractorRegistry.ts` (queue-backed, idempotent)
6. `checkBankAccountWhitelist` command — **gate this on
   `approvalStatus === 'APPROVED'` from the start** (see the approval
   pitfall below), not as an afterthought once step 7 below exists
7. `workflows.ts` (`contractors.vendor-approval` definition,
   `registerWorkflowSafeCommands` on `applyContractorApprovalDecision`)
   + `events.ts` (`contractors.contractor.created`) + the injected
   approval-task widget (owned by `workflows`, not this module — same
   division as `sales.order-approval`)
8. API routes + `api/openapi.ts`
9. Backend pages (list/create/edit + inline bank-account sub-list +
   "verify now" row action)
10. `i18n/` — every status label, the "last checked" badge, the
    "verify now" button, and 400/409/502 error copy; don't leave these
    for a cleanup pass, `yarn i18n:check-hardcoded` will catch them
    later anyway
11. GL side: add `contractorSnapshot` to `JournalEntryLine` per #5663
    (only once #5663 itself is implemented — see "When you're done")
    + unit/integration test coverage, including the reserved
    `TC-CONTRACTOR-*` category and the `CRUDFORM` spec

## Things that will bite you if you skip them

- **`checkBankAccountWhitelist` is a DI-resolvable service, not just an
  HTTP route.** An earlier draft of the full spec designed it as a
  plain HTTP route AP would call at payment time — an independent
  review caught this as the wrong cross-module mechanism (no degrade
  path if `contractors` is ever disabled). Build `di.ts` first, wire
  AP's payment command to resolve it via a local `tryResolve` in
  `try/catch`, and keep the HTTP route scoped to this module's own
  "verify now" button only. Don't let the two drift back apart.
- **Never read `lastVerifiedAt` to skip the live Biała Lista call —
  not even if it was checked five minutes ago.** This is the single
  most safety-critical rule in the module (Art. 96b requires
  verification "on the day of transfer," not "recently"). Write the
  regression test for this before anything else: seed a fresh
  `lastVerifiedAt: now()`, call `checkBankAccountWhitelist`, assert the
  live API client was actually invoked anyway.
- **`nip` is unconditionally immutable, with no "unlocks if nothing
  posted yet" exception.** This is stricter than GL's own
  posted-entries-gated guards (e.g. `LedgerAccountType.normalBalance`)
  — don't copy that pattern here. `updateContractor` rejects any `nip`
  change outright; changing it means creating a new contractor.
- **`isPrimary` uniqueness needs both the command AND a partial
  unique index — this changed 2026-09-08.** An earlier draft relied on
  the command alone (`createContractorBankAccount`/
  `updateContractorBankAccount` re-reading and unsetting any existing
  primary in the same transaction); a maintainer review pointed out
  this repo has no such "command-only" preference — both real
  precedents for an "exactly one primary" invariant
  (`communication_channels_one_primary_per_user_uq`,
  `customer_deal_people_primary_uq`) use a partial unique index. Add
  `contractor_bank_account_one_primary_uq` in the migration (step 1)
  and keep the command's unset-logic too — the index is the safety
  net, the command is what makes a normal request never hit it.
- **`nip`/`nipHash` uniqueness is a *partial* index — `where deleted_at
  is null` — not a plain unique constraint.** Same review round: a
  plain constraint would permanently burn a NIP the moment its
  contractor is soft-deleted, since `nip` can't be corrected on the
  old row either (see the immutability pitfall above). Scope the index
  to match `deletedAt`, same shape as
  `communication_channels_one_primary_per_user_uq`.
- **`contractorSnapshot` on `JournalEntryLine` is `json`, not
  `jsonb`.** This field belongs to the GL core engine spec (#5663),
  not this module — #5663 itself is still spec-only as of this
  writing, so there's nothing to migrate here yet. Don't add it to
  this module's own migration.
- **There is no `gusData`/`viesData` raw-payload column — this
  changed 2026-09-08.** An earlier draft stored the full GUS/VIES API
  response verbatim for diagnostics; a maintainer review caught that
  for a sole proprietorship (JDG) that response carries the owner's
  personal name/address in plaintext, duplicating exactly what
  `encryption.ts` already encrypts on `name`/`address`. Use
  `lastCheckStatus`/`lastCheckedAt`/`lastCheckRequestId` instead —
  typed, non-PII fields only. No command may branch on their contents;
  they exist only to be displayed in the UI. If you find yourself
  wanting to persist the raw response for real diagnostic need, it
  must go through `encryption.ts` like every other PII field, with a
  stated retention policy — it is not a shortcut around that.
- **`ContractorBankAccount.deletedAt` is a soft "deactivate," not a
  real delete.** Account history has audit value — don't hard-delete
  rows here even if the UI action is labeled "remove."
- **`Contractor`'s delete guard checks `ContractorBankAccount` only —
  never `ledger`'s `JournalEntryLine`.** An earlier draft also blocked
  deletion on posted `JournalEntryLine` references; a maintainer
  review caught that as backwards (this upstream module reaching into
  a downstream consumer's table, exactly what
  `packages/core/AGENTS.md` → Cross-Module Coupling forbids, and a
  guaranteed `module-decoupling.test.ts` failure with `ledger`
  disabled). `contractorSnapshot` already makes this unnecessary — a
  historical journal entry never needs the `Contractor` row to still
  exist. Don't add the `JournalEntryLine` check back in.
- **`contractors.approve` is a separate ACL feature from
  `contractors.manage` — and `applyContractorApprovalDecision` also
  rejects self-approval.** The person who registers a vendor
  (`contractors.manage`) must not be able to approve their own
  registration; that's the entire point of the gate, and the fraud
  scenario it exists to close. Require `contractors.approve` on the
  approval command specifically, and check the acting user against
  `Contractor.createdByUserId` before allowing the decision — even for
  a user who happens to hold both features.

## When you're done with this spec

`2026-09-06-accounts-payable.md` already assumes this registry exists
and is written against it — it's next. It resolves
`contractorBankWhitelistCheck` via `tryResolve`, references
`Contractor` by FK-id only, and writes `contractorSnapshot` onto
`JournalEntryLine` at posting time. The GL side of this (the
`contractorSnapshot` column itself) depends on #5663
(`2026-08-18-general-ledger-core-engine.md`) being implemented first —
that module doesn't exist in code yet, so build order step 11 above
waits on it.
