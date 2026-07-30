# Run: enforce a cumulative capture ceiling on gateway transactions

Issue: [#4487](https://github.com/open-mercato/open-mercato/issues/4487) — `security(payment_gateways): enforce cumulative capture ceiling`
Follow-up to: #4486 (per-capture ceiling), #4083, #3880

## Goal

Make it impossible for repeated partial captures to add up past the authorized amount of a
gateway transaction. Today `assertCaptureAmountAllowed` compares each individual capture
request against the full `gateway_transactions.amount`, so `60 + 60` against an authorization
of `100` is accepted: each request passes the per-capture check in isolation.

## Scope

- `packages/core/src/modules/payment_gateways` only.
- Persist how much of a transaction has been captured so far and enforce
  `capturedToDate + requested <= authorized` before the provider is called.
- Make the check safe against two concurrent capture requests (distinct operation ids) and
  against retries of the same operation id.

### Non-goals

- No change to refund accounting (`refundedAmount` is not tracked cumulatively today; that is
  a separate concern and a separate issue if wanted).
- No change to how adapters report status, and no new derivation of `partially_captured`
  from the captured amount — `applyAdapterResultStatus` keeps trusting the adapter's status.
- No new API surface: the capture endpoint's request/response shape is unchanged.
- No changes to other modules, and no DB migration applied locally (`yarn db:migrate` is not run).

## Design

Two additive columns and one reservation step.

1. `gateway_transactions.captured_amount numeric(18,4) not null default '0'` — the
   captured-to-date ledger for the transaction. It is the single source of truth for the
   ceiling and is scoped by the row itself, so tenant/organization scoping is unchanged.
2. `gateway_payment_operations.reserved_amount numeric(18,4) null` — how much this specific
   capture operation reserved against that ledger. While the operation row is `in_progress`
   the reservation is outstanding; once it is `succeeded` the amount is settled into
   `captured_amount` and the column stays as an audit record.

Capture flow:

- Read the transaction (already done by `executeManualOperation`).
- `preparePaymentOperation` claims the operation (unchanged idempotency semantics: a
  `succeeded` row replays its stored result and never re-reserves).
- **Reserve before invoking the adapter.** `remaining = authorized - capturedToDate`;
  the requested amount defaults to `remaining` for a full capture. Reject with `409` when
  `requested > remaining`. Then, atomically, increment `captured_amount` with a
  compare-and-swap on its previous value and stamp `reserved_amount` on the operation row.
  A losing CAS means a concurrent capture moved the ledger — reject with `409` instead of
  charging the provider.
- A re-claimed operation (stale lease or previously failed attempt) that already holds a
  reservation reuses it instead of reserving twice.
- On success, settle: adjust `captured_amount` by the difference between the reserved amount
  and the `capturedAmount` the adapter actually reported, inside the existing
  `completePaymentOperation` transaction.
- On failure, release the reservation so the amount becomes capturable again. A crashed
  process leaves the reservation outstanding on purpose — holding it is the conservative
  choice when it is unknown whether the provider captured.

Money arithmetic runs on `bigint` minor units scaled to 4 decimals (matching `numeric(18,4)`),
never on floats.

## Implementation Plan

### Phase 1: schema

1.1 Add `capturedAmount` to `GatewayTransaction` and `reservedAmount` to
`GatewayPaymentOperation`, plus a hand-authored scoped migration that adds both columns and
backfills `captured_amount` from the existing succeeded capture operations (falling back to
`amount` for transactions that are already captured/refunded), and the matching
`.snapshot-open-mercato.json` update.

### Phase 2: ceiling enforcement

2.1 New `lib/capture-ledger.ts`: amount parsing/formatting on bigint minor units, the
remaining-amount computation, the reserve (CAS) / settle / release operations.
2.2 Wire it into `capturePayment` via `executeManualOperation`, replacing the per-capture
`assertCaptureAmountAllowed` with the cumulative check and the reservation.

### Phase 3: tests

3.1 Unit tests in `lib/__tests__`: sequential partial captures that exceed the ceiling,
a partial capture that fits, full capture of the remainder, idempotent replay of one
operation id, retry of a failed operation reusing its reservation, concurrent captures where
only one wins, release after a provider error, settlement when the adapter captures less
than requested.
3.2 Integration coverage `TC-PGWY-022`: two partial captures over the ceiling against the
mock gateway through `POST /api/payment_gateways/capture`.

### Phase 4: validation and PR

4.1 Run the configured validation gate.
4.2 Finalize the PR: body, labels, review pass, summary comment.

## Risks

- **Backfill accuracy.** Transactions captured before the operation ledger existed have no
  succeeded capture rows; they are backfilled to the full amount when their status is
  `captured`/`refunded`/`partially_refunded`, and to `0` otherwise. A historical
  `partially_captured` transaction therefore starts at `0` and could still be over-captured
  once; this is called out in the migration and cannot be resolved from stored data.
- **Leaked reservations.** A process that dies between reserving and settling leaves the
  amount reserved until the same operation id is retried. Conservative by design, but it can
  block further captures on that transaction until an operator reconciles.
- **Existing over-captured rows.** The backfill records the truth rather than clamping to
  `amount`, so an already over-captured transaction is simply blocked from capturing more.

## Progress

PR: #4508

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: schema

- [x] 1.1 Entities, migration, snapshot — 0a35681b4

### Phase 2: ceiling enforcement

- [x] 2.1 Capture ledger helper — 3a2af2aea
- [x] 2.2 Wire the cumulative ceiling into capturePayment — 3a2af2aea

### Phase 3: tests

- [x] 3.1 Unit coverage for cumulative, concurrent and retried captures — 3a2af2aea
- [x] 3.2 Integration coverage TC-PGWY-022 — 467d6f0fb
- [x] 3.3 Document the ceiling in the payment gateways API reference — 3c26b293a

### Phase 4: validation and PR

- [x] 4.1 Validation gate — f53e3ea04, 4ff5792fd
- [x] 4.2 PR finalization

### Phase 5: review round 1 (om-auto-review-pr, 2026-07-26)

- [x] 5.1 Blocker — stop releasing a settled capture reservation when a post-commit event or log
  call fails; add the regression test — d457a197c
- [x] 5.2 Major — `TC-PGWY-022` did in fact run on this PR; answered with CI evidence instead of a
  code change (see the note below)

### Phase 6: merge readiness (om-auto-fix-pr, 2026-07-30)

- [x] 6.1 Merge the latest `develop` into the branch (195 commits behind; no conflicts, no
  `payment_gateways` churn on the base since the merge base)
- [x] 6.2 Major — release the capture reservation only while the provider has not been called yet:
  a failure *after* a successful provider capture (completion transaction, lost operation claim)
  used to hand the slice back, so a fresh `operationId` could spend it again and over-capture —
  1a693013e
- [x] 6.3 Major — record provider-confirmed captures (webhook sync, status poller) in the ledger;
  `captured` is itself a valid capture target, so without this a webhook-confirmed capture left the
  whole authorization capturable again — 1a693013e
- [x] 6.4 Validation gate re-run on the merged head

Note on 6.4: `yarn i18n:check-usage` fails on two keys (`ui.customFields.phone.defaultCountry`,
`ui.customFields.phone.defaultCountryAuto`) referenced from `packages/ui/src/backend/fields/phone.tsx`,
which arrived on `develop` with #4147. This PR touches no file under `packages/ui`; the step is
advisory in CI (`continue-on-error: true`) and the breakage is tracked as a follow-up instead of
being fixed from this branch. Every other gate command exits `0`.

Note on 5.2: the review read the job name `ephemeral-integration (none)` as "no shard ran". `none`
is the matrix value CI uses for the PR-mode **single runner**, not an empty selection — the 15
numbered shards only exist for pushes to `main`/`develop`. Job `89659158994` for head `8b3d48427`
ran with `OM_INTEGRATION_MODULES: payment_gateways` and executed all four `TC-PGWY-022` cases
(`105 passed, 1 skipped`). No CI change is needed.
