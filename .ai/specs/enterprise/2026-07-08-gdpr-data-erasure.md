# GDPR Data Erasure Orchestration (Enterprise)

> **Superseded — design history only (2026-11-16).** Every operative section of this file is replaced: TLDR and Scope, Overview’s current-state claims, Proposed Solution and Design Decisions, User Stories, Architecture and coupling, Commands & Events, Data Model, API Contracts, durability framing, Security Considerations, Failure Scenarios, Phasing & Implementation Plan, Integration test coverage, Migration & Backward Compatibility, Risks & Impact Review and Final Compliance Report. No command, event, ledger or purge subscriber is implemented from this file.
> **Operation successor:** [`../2026-11-16-privacy-subject-erasure.md`](../GDPR/2026-11-16-privacy-subject-erasure.md) (C4) owns module-owned erasure, anonymization, audit-history stripping, the OSS command, `eraseSubjects` and the single `privacy.subject.erased` event.
> **Governance successor:** [`2026-11-16-privacy-dsr-engine.md`](GDPR/2026-11-16-privacy-dsr-engine.md) (C3/D5) owns enterprise policies, holds, the operation ledger, routes and admin UI.
> **Restore successor:** [`2026-11-16-erasure-restore-replay.md`](GDPR/2026-11-16-erasure-restore-replay.md) (C9) owns external manifests, restore detection and manual replay, including infrastructure restores. The old backup-bucket manifest is withdrawn from the companion backup spec.

Split from `2026-07-02-automated-backups-and-gdpr-erasure-propagation.md` (rev 5) on 2026-07-08. The rationale below is retained as history. Successor approval gates remain binding; this annotation does not approve their implementation.

## TLDR

Erasure needs module-owned cleanup, evidence that does not recreate the cleared data, and an explicit restore procedure. The current designs are the three successor specs above. The earlier `erasure_request` ledger, `/api/data_erasure/requests`, `privacy.subject.purged` confirmations and asynchronous audit-log purge subscriber are withdrawn designs, not released contracts.

## Overview and Problem Statement

The July design combined an enterprise erasure command with eventual cross-module cleanup and a backup-bucket manifest. The November program separates the OSS operation from enterprise governance and restore handling. This file no longer describes today’s code or orders implementation.

## Proposed Solution — retained rationale

- A subject action must let each owning module enforce its own retention and business rules.
- Erasure must not create a fresh snapshot of the data it clears.
- Evidence must distinguish completed work, failures and retained data; an event alone is not proof that every store was cleared.
- A restore can bring erased data back. External evidence and a reviewed replay procedure are separate from archive expiry.
- Per-subject crypto-shredding and rewriting backup archives remain outside this program’s scope.

The earlier fail-with-guidance decision for deal-linked people is superseded. C4’s erase operation anonymizes such a root when needed; ordinary person DELETE keeps its existing deal refusal. Do not add a `.purged` confirmation event or infer an asynchronous audit strip from this history. C4 owns DEC-B — The audit-history strip routine, R3-1 — The audit-history rule for every erasure, and R3-14 — The `eraseSubjects` entry point; other specs cite those contracts.

## Architecture

| Responsibility | Authoritative carrier |
|---|---|
| Read/export contract and registry | `../2026-11-16-privacy-data-class-contract.md` (C1); R3-2 — The registry carries the whole `privacy.ts` default export; R3-3 — Tenant privacy settings live in `module_configs` |
| Erase command, service, roots and history | `../2026-11-16-privacy-subject-erasure.md` (C4; DEC-B, R3-1, R3-14) |
| Domain-owned dependants | The five privacy coverage specs named by the program; no generic cross-module table mutation |
| Policies, holds, operation ledger and UI | `2026-11-16-privacy-dsr-engine.md` (C3/D5); DEC-C — Retention sets and holds; R3-9 — Organization-scope guard on every DSR route; R3-10 — One definition of a stale hold; R3-13 — No `related_subjects: include` anywhere |
| External manifest and replay | `2026-11-16-erasure-restore-replay.md` (C9); its assumption 9 and OSS awaited-capture/verification-time handoff remain gated by the program |

## Data Model and API Contracts

No active entity, route, event or DI contract is specified here. Use the successors’ Data Models and API Contracts. The old masked-label ledger was not anonymous: internal ids and masked labels can remain personal data. Do not carry its blanket "PII-free / encryption not needed" claim into the operation ledger.

## Security Considerations and Failure Scenarios

Follow the operation successor’s preflight, tenant scope, confirmation, module-owned service calls, file-deletion reporting and history-strip rules. Follow the governance successor’s organization-scope guards and fail-closed holds. Holds exist only with the enterprise engine and do not protect every operational pruner; the program’s Known limits (R3-5 — Holds, honestly) is authoritative.

Failure, incomplete cleanup and retained business records use the successors’ result semantics. A deal-linked root is not failed merely because ordinary DELETE would refuse it. No subscriber confirmation named `privacy.subject.purged` is required.

## Phasing & Implementation Plan

There is no remaining implementation phase in this historical spec. Implement C1/C5, C4 and its coverage, C3 and C9 in the program’s gated order. Their unit tests, fixtures, migrations and file manifests replace the withdrawn July plan.

## Integration test coverage

Use C4’s linked-deal anonymization, history-strip and tenant-isolation unit/integration cases, C3’s `TC-PRIVACY-GOV-001` through `011` for the applicable holds, route/scope, settings and policy paths plus `/backend/security/privacy`, and C9’s `TC-PRIVACY-REPLAY-001` plus the program’s crash/restore-before-repair and missing-event cases. Each creates its own subject, dependent records, users and storage fixtures and removes them in `finally`. The old `/requests` and `.purged` tests are not scheduled. This documentation revision adds no API or UI path.

## Migration & Backward Compatibility

These are unimplemented design replacements, not removal of shipped API contracts. No runtime bridge is owed for the withdrawn July shapes. Each successor owns the backward-compatibility protocol for the actual code it changes, including irreversible history edits and unchanged frozen event fields.

## Risks & Impact Review

| Scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| An implementer follows an old request route, deal refusal or purge-confirmation design | High | Erasure operation and audit history | All operative sections are replaced by this successor map; implementation reads C4 and C3 | External copies of the July design can remain stale |
| An operator treats archive expiry or replay as an unconditional erasure guarantee | High | Restore operations | C9 now proposes awaited durable external capture before protected completion, then completed-audit settlement/repair; assumption 9 approval and the C4-owned `privacyErasureCompletionCapture.capture` / `verifiedAt` handoff remain gates. Use `restore-status --refresh` and reviewed replay before reopening; settled evidence expires and pending work does not | Unread runbooks, lost external evidence or an operator bypass can resurrect data |

## Final Compliance Report — 2026-11-16

This enterprise file retains history and rationale only. The OSS erase operation stays in its OSS carrier; enterprise governance and replay stay in enterprise carriers. No obsolete event, API, entity, encryption exemption or implementation gate remains normative here. Tests and risks point to the current designs; their unresolved approvals are not cleared by this note.

## Changelog

- 2026-07-08: Split from `2026-07-02-automated-backups-and-gdpr-erasure-propagation.md` (rev 5) — this file carries the `data_erasure` module, the generic OSS erasure events, the core purge subscribers, and the GDPR guarantee/control framing; the backup pipeline, manifest mechanism, and restore-time diff live in [`2026-07-08-automated-database-backups.md`](2026-07-08-automated-database-backups.md).
- Inherited history (combined spec): 2026-07-02 initial + full spec (PR #3742); 2026-07-03 rev 2 (gap-analysis corrections: `skipLog` no-PII-resurrection rule, per-id index delete events instead of `purgeIndexScope`, fail-with-guidance for persons with deals) and rev 3 (market research settled the deals/ledger/message-purge decisions; masked display label adopted); 2026-07-04 rev 4 (automated replay descoped to guided re-run; HMAC/blind-index/pepper removed) and rev 5 (executor+advisor review: completion semantics resolved market-style — `executed` = sync sweep, eventual subscriber propagation with `purged` confirmations; core-subscribing-to-enterprise ruled out on layering grounds → generic OSS events with Gate B; "one guarantee, one control" framing); 2026-07-06 market references generalized to pattern descriptions.

### 2026-11-16
- Council round two fixes (GPT-6.1 Sol workers): r0-20 replaces every operative July section with C4/C3/C9 successor pointers; withdraws deal-linked refusal, `.purged` confirmations, snapshot-purge subscriber and the old ledger/routes.

- Council round two fixes, pass two (GPT-6.1 Sol workers): cited exact DEC-B/R3-1/R3-14 owner names and aligned the historical replay warning with C9's new audit reconciliation while retaining the unresolved external-durability gate.

- Council round two fixes, pass three (GPT-6.1 Sol workers): replaced withdrawn row-first replay framing with the current awaited-capture/verifiedAt approval dependency and fresh status/reapply boundary; aligned governance coverage with its expanded eleven-case catalog.
