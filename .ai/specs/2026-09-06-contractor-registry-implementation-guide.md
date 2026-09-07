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
  `nip`/`nipHash` (unique per organization, immutable once set),
  `name`, `address`, `contactEmail`/`contactPhone`, `verificationStatus`
  (`PENDING`/`VERIFIED`/`FAILED`), `gusData`/`viesData` (raw diagnostic
  copies, never a source of truth for any command).
- **`ContractorBankAccount`** — `contractorId` (FK), `accountNumber`
  (encrypted), `isPrimary` (exactly one `true` per contractor,
  command-enforced), `lastVerifiedAt`/`lastVerificationStatus` (UX
  cache only — see the pitfall below, this one matters most), its own
  `organizationId`/`tenantId` (not just inherited via `contractorId`).

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
4. Before the first payment, AP resolves `contractorBankWhitelistCheck`
   from this module's `di.ts` (via its own local `tryResolve` wrapper —
   **not** an HTTP call to this module's own API) and invokes it. This
   performs a **live** call to the Ministry of Finance's Biała Lista
   API for the exact `accountNumber`/`nip` pair, returns the fresh
   result, and — only as a side effect — updates
   `lastVerifiedAt`/`lastVerificationStatus` for the UX badge. AP
   blocks the payment on anything other than a fresh `WHITELISTED`
   result.
5. AP posts the payment in GL and writes a `contractorSnapshot` (name,
   NIP, account, verification status *at that exact moment*) onto the
   `JournalEntryLine` it creates — that snapshot, not a live join to
   `Contractor`, is what an accountant sees when reopening this
   invoice six months later, even if the vendor's account changes
   after.

That's the whole write path this module owns. `approveContractor`
(pending team confirmation) is an optional extra gate before step 3,
not a replacement for any of the above.

## Build order

Follow `Implementation Plan → Phase 1` in the full spec — it's already
numbered 1–10 and matches the `File Manifest` table 1:1. Don't reorder
it; steps 1–2 (entities/migration, ACL/setup) have to exist before
anything else compiles or is reachable. High-level shape:

1. Entities + migration (both tables, plus the two supporting indexes
   named in Data Models) + `encryption.ts` (`nip` → `nip_hash`,
   `account_number`) — write the encryption map in this same step, not
   deferred to a later one.
2. `acl.ts` (two features) + `setup.ts` + `di.ts` (registers
   `contractorBankWhitelistCheck` — read the DI pitfall below before
   you build the HTTP route, not after)
3. `createContractor` / `updateContractor`
4. `createContractorBankAccount` / `updateContractorBankAccount`
5. `workers/verifyContractorRegistry.ts` (queue-backed, idempotent)
6. `checkBankAccountWhitelist` command
7. API routes + `api/openapi.ts`
8. Backend pages (list/create/edit + inline bank-account sub-list +
   "verify now" row action)
9. GL side: add `contractorSnapshot` to `JournalEntryLine` per #5663
   (only once #5663 itself is implemented — see "When you're done")
10. Unit + integration test coverage

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
- **`isPrimary` uniqueness is enforced in the command, not a database
  constraint.** `createContractorBankAccount`/
  `updateContractorBankAccount` must re-read and unset any existing
  primary inside the same transaction as the write. A partial unique
  index would also work but isn't what this spec calls for — don't add
  one unless you're deliberately revisiting that decision.
- **`contractorSnapshot` on `JournalEntryLine` is `json`, not
  `jsonb`.** This field belongs to the GL core engine spec (#5663),
  not this module — #5663 itself is still spec-only as of this
  writing, so there's nothing to migrate here yet. Don't add it to
  this module's own migration.
- **`gusData`/`viesData` are diagnostics, never a source of truth.**
  No command may branch on their contents; they exist only to be
  displayed in the UI. If you catch yourself reading `gusData` inside
  a command, that's a sign something else is wrong.
- **`ContractorBankAccount.deletedAt` is a soft "deactivate," not a
  real delete.** Account history has audit value — don't hard-delete
  rows here even if the UI action is labeled "remove."

## When you're done with this spec

`2026-09-06-accounts-payable.md` already assumes this registry exists
and is written against it — it's next. It resolves
`contractorBankWhitelistCheck` via `tryResolve`, references
`Contractor` by FK-id only, and writes `contractorSnapshot` onto
`JournalEntryLine` at posting time. The GL side of this (the
`contractorSnapshot` column itself) depends on #5663
(`2026-08-18-general-ledger-core-engine.md`) being implemented first —
that module doesn't exist in code yet, so build order step 9 above
waits on it.
