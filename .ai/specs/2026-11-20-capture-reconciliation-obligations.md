# Capture reconciliation obligations

## TLDR

Persist an actionable obligation when a confirmed capture cannot update the payment status.
Keep cancellation, captured funds, provider identity and the immutable completion response.
An authorized finance operator may attest a confirmed full external refund; this application
never issues a compensating refund. Operator authorization: Recovery contract approved in
the PR 10103 task on 2026-11-20. This does not replace independent review or financial QA.

## Overview and problem

Source PR 9464 is merged. Its v0.10.x backport 10103 retains R1: a succeeded capture
may preserve a cancelled transaction without a supported resolution path. Existing logs
and the nonterminal poller do not constitute reconciliation.

## Proposed solution and architecture

Use the existing gateway payment operation's result JSON for a versioned internal
reconciliation record. Create it in the operation completion transaction. Return an optional
stable reconciliation reference on first completion and replay, including legacy outcomes.
The payment status and provider result remain unchanged. A bounded, scoped worklist includes
legacy outcomes and operations whose transaction was soft-deleted. No new database schema,
permission, provider method, scheduling or checkout state transition is introduced.

## Data models

The internal record stores required/resolved status, detection time, observed status,
exact captured amount, currency, and immutable resolution evidence. Cases use the existing
operation UUID and updatedAt. Legacy succeeded captures with an incompatible settled-status
marker are derived from existing records, never inferred from a reservation alone.
Full refund evidence contains a reference, exact amount, currency, final settlement time,
and authenticated attesting user. Partial, pending or ambiguous evidence cannot close a case.
Existing result data and provider idempotency keys are retained. No arbitrary customer notes
or credentials are collected. Evidence is never sent to telemetry.

## API contracts

- GET /api/payment_gateways/reconciliations: view permission, pagination <=100, status filter.
- POST /api/payment_gateways/reconciliations/[id]/resolve: existing refund permission,
  authenticated tenant/organization, mutation guards, audited irreversible command.
- CaptureResult gains only an optional reconciliation reference; providers may omit it.
- Resolution checks the operation's updatedAt, serializes receipt reuse in PostgreSQL,
  returns the original evidence on identical retries, and rejects conflicting resolution.
- Case resolution never calls a payment adapter or emits captured/refunded checkout events.

## UI/UX and frontend architecture

Keep the existing transaction page and its client boundary. Its capture handler reads the
optional reference and shows an action-required message. Add a linked worklist with DataTable
and CrudForm, translated copy, semantic tokens, loading/error states, and the operation's own
optimistic version. The new page uses existing UI dependencies; no global providers or SDKs.
The finance queue remains the source of discoverability when telemetry/logging fails.

## Migration & Backward Compatibility

No migration or destructive data rewrite. Existing operation hashes, keys, status values,
result fields and exported helper signatures remain supported. New completion metadata is
optional. Legacy replay retains its original provider fields and derives the same reference.
The result's immutable reference identifies the historical reconciliation obligation;
current required/resolved state is read from the worklist. Existing clients may ignore it.
Deploy the repaired code consistently; legacy cases remain discoverable without a backfill.
Document the recovery and client behavior in UPGRADE_NOTES.md. Keep version 0.10.0 on release.

## Implementation plan

1. Implement typed JSON handling, atomic settlement and supported legacy discovery.
2. Add guarded, audited evidence resolution and bounded reads.
3. Integrate capture feedback and finance worklist; add unit, PostgreSQL, API and UI coverage.
4. Independently review the main correction; prepare the same correction on the backport.
   Do not push shared branches without Guard approval, merge or record others' approvals.

## Integration coverage and acceptance

Synthetic fixtures only. Test settlement commit/rollback and lost claims; immutable first
completion/replay; legacy case discovery; required/resolved pagination including deleted
parents; correct tenant/organization and permission boundaries; full exact-decimal evidence;
pending/partial/wrong-currency refusal; same-evidence retry; stale/conflicting resolution;
receipt reuse across operations; no provider calls or checkout events during resolution.
Route tests cover both new endpoints and the capture result. UI tests cover the real capture
callback, worklist load/error, required form, resolved display and conflict handling.
Human financial QA must pin the repaired main and release heads, exercise synthetic cases,
and explicitly accept the human-attestation trust model and ownership of unresolved cases.

## Risks & Impact Review

- High: a false attestation could incorrectly close an obligation. Restrict to existing refund
  permission, require confirmed exact evidence, audit the actor and retain immutable data.
  The application validates an attestation; it does not claim to verify a live provider.
- High: duplicate resolution/receipt reuse. Serialize in the database, pin the operation
  version, and test two independent database connections.
- High: lost notification. Obligation persistence shares the settlement transaction; reads
  inspect operation records directly. Notifications are not the source of truth.
- Medium: unindexed JSON worklist queries. Scope and paginate; no per-row network calls.
  Measure query plans on representative data before expanding workload.
- Medium: partial/aggregated refunds remain open. Escalate to finance; never infer settlement.

## Final Compliance Report

Schema-free, scoped, additive contracts; existing refund permission and idempotency machinery;
guarded mutations, audited command, optimistic locking and no automatic payment operations.
Implementation and fresh validation/review/QA evidence are pending.

## Changelog

- 2026-11-20: Approved recovery contract documented; implementation started for source R1.
