# GDPR Data Erasure Orchestration (Enterprise)

> **Status:** Superseded. C4, C3 and C9 own the current implementation contracts and approval gates.
> **Operation successor:** [`../GDPR/2026-11-16-privacy-subject-erasure.md`](../GDPR/2026-11-16-privacy-subject-erasure.md) (C4) owns module-owned erasure, anonymization, audit-history stripping, the OSS command, `eraseSubjects` and the single `privacy.subject.erased` event.
> **Governance successor:** [`GDPR/2026-11-16-privacy-dsr-engine.md`](GDPR/2026-11-16-privacy-dsr-engine.md) (C3/D5) owns enterprise policies, holds, the operation ledger, routes and admin UI.
> **Restore successor:** [`GDPR/2026-11-16-erasure-restore-replay.md`](GDPR/2026-11-16-erasure-restore-replay.md) (C9) owns external manifests, restore detection and manual replay, including infrastructure restores. The old backup-bucket manifest is withdrawn from the companion backup spec.

## TLDR

Erasure needs module-owned cleanup, evidence that does not recreate the cleared data, and an explicit restore procedure. The current designs are the three successor specs above. The earlier `erasure_request` ledger, `/api/data_erasure/requests`, `privacy.subject.purged` confirmations and asynchronous audit-log purge subscriber are withdrawn designs, not released contracts.

## Overview and Problem Statement

The program separates the OSS erasure operation, Enterprise governance and external restore replay. Use the carrier specs for implementation.

## Proposed Solution

- A subject action must let each owning module enforce its own retention and business rules.
- Erasure must not create a fresh snapshot of the data it clears.
- Evidence must distinguish completed work, failures and retained data; an event alone is not proof that every store was cleared.
- A restore can bring erased data back. External evidence and a reviewed replay procedure are separate from archive expiry.
- Per-subject crypto-shredding and rewriting backup archives remain outside this program’s scope.

The earlier fail-with-guidance decision for deal-linked people is superseded. C4’s erase operation anonymizes such a root when needed; ordinary person DELETE keeps its existing deal refusal. Do not add a `.purged` confirmation event or infer an asynchronous audit strip from this history. C4 owns DEC-B — The audit-history strip routine, R3-1 — The audit-history rule for every erasure, and R3-14 — The `eraseSubjects` entry point; other specs cite those contracts.

## Architecture

| Responsibility | Authoritative carrier |
|---|---|
| Read/export contract and registry | [`../GDPR/2026-11-16-privacy-data-class-contract.md`](../GDPR/2026-11-16-privacy-data-class-contract.md) (C1); R3-2 — The registry carries the whole `privacy.ts` default export; R3-3 — Tenant privacy settings live in `module_configs` |
| Erase command, service, roots and history | [`../GDPR/2026-11-16-privacy-subject-erasure.md`](../GDPR/2026-11-16-privacy-subject-erasure.md) (C4; DEC-B, R3-1, R3-14) |
| Domain-owned dependants | The five privacy coverage specs named by the program; no generic cross-module table mutation |
| Policies, holds, operation ledger and UI | [`GDPR/2026-11-16-privacy-dsr-engine.md`](GDPR/2026-11-16-privacy-dsr-engine.md) (C3/D5); DEC-C — Retention sets and holds; R3-9 — Organization-scope guard on every DSR route; R3-10 — One definition of a stale hold; R3-13 — No `related_subjects: include` anywhere |
| External manifest and replay | [`GDPR/2026-11-16-erasure-restore-replay.md`](GDPR/2026-11-16-erasure-restore-replay.md) (C9); its assumption 9 settles the OSS awaited-capture/verification-time handoff, and protection is claimed only once C4 delivers that handoff and C9's crash/restore-before-repair tests pass |

## Data Model and API Contracts

No active entity, route, event or DI contract is specified here. Use the successors’ Data Models and API Contracts. The old masked-label ledger was not anonymous: internal ids and masked labels can remain personal data. Do not carry its blanket "PII-free / encryption not needed" claim into the operation ledger.

## Security Considerations and Failure Scenarios

Follow the operation successor’s preflight, tenant scope, confirmation, module-owned service calls, file-deletion reporting and history-strip rules. Follow the governance successor’s organization-scope guards and fail-closed holds. Holds exist only with the enterprise engine and do not protect every operational pruner; the program’s Known limits (R3-5 — Holds, honestly) is authoritative.

Failure, incomplete cleanup and retained business records use the successors’ result semantics. A deal-linked root is not failed merely because ordinary DELETE would refuse it. No subscriber confirmation named `privacy.subject.purged` is required.

## Phasing & Implementation Plan

There is no remaining implementation phase in this historical spec. Implement C1/C5, C4 and its coverage, C3 and C9 in the program’s gated order. Their unit tests, fixtures, migrations and file manifests replace the withdrawn July plan.

## Integration test coverage

Use C4’s linked-deal anonymization, history-strip and tenant-isolation unit/integration cases, C3’s **Integration Coverage** cases (`TC-PRIVACY-GOV-001` through `013`) for the applicable holds, route/scope, settings, policy and governance-evidence paths plus `/backend/security/privacy`, and C9’s `TC-PRIVACY-REPLAY-001` plus the program’s crash/restore-before-repair and missing-event cases. Each creates its own subject, dependent records, users and storage fixtures and removes them in `finally`. The old `/requests` and `.purged` tests are not scheduled. This documentation revision adds no API or UI path.

## Migration & Backward Compatibility

These are unimplemented design replacements, not removal of shipped API contracts. No runtime bridge is owed for the withdrawn July shapes. Each successor owns the backward-compatibility protocol for the actual code it changes, including irreversible history edits and unchanged frozen event fields.

## Risks & Impact Review

| Scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| An implementer follows an old request route, deal refusal or purge-confirmation design | High | Erasure operation and audit history | All operative sections are replaced by this successor map; implementation reads C4 and C3 | External copies of the July design can remain stale |
| An operator treats archive expiry or replay as an unconditional erasure guarantee | High | Restore operations | C9 now proposes awaited durable external capture before protected completion, then completed-audit settlement/repair; C9's assumption 9 settles that design, and delivery of the C4-owned `privacyErasureCompletionCapture.capture` / `verifiedAt` handoff with C9's crash/restore-before-repair tests remains the gate. Require C9’s scoped replay, strict cutover clearance and live admission check before reopening. Settled evidence expires and pending work does not | Unread runbooks, lost external evidence or an operator bypass can resurrect data |

## Final Compliance Report — 2026-11-16

This enterprise file retains history and rationale only. The OSS erase operation stays in its OSS carrier; enterprise governance and replay stay in enterprise carriers. No obsolete event, API, entity, encryption exemption or implementation gate remains normative here. Tests and risks point to the current designs; their unresolved approvals are not cleared by this note.

## Changelog

- 2026-11-20 — Assign subject erasure, governance and restore replay to the C4, C3 and C9 specifications.

- 2026-07-08: Split from `2026-07-02-automated-backups-and-gdpr-erasure-propagation.md`. The original design separated the `data_erasure` module, OSS erasure events and Core cleanup from the backup design in [`2026-07-08-automated-database-backups.md`](2026-07-08-automated-database-backups.md).
