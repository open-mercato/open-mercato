# Execution plan — Enterprise key-rotation data verification

Source doc: .ai/specs/enterprise/2026-11-12-key-rotation-data-verification.md
Source PR: #9328
Backup prerequisite: #8910 (merged design; runtime is not implemented)
Status: in-progress — Phase 0 decisions required before production implementation
Engine: om-auto-create-pr (steps: 11, --loop: no)

## Goal

Implement complete, bounded Enterprise data-equivalence verification after rotation, retain deliberate unprotected Core rotation, and publish tested implementation with verification evidence. The design PR stays design-only; its file is materialized locally but not committed here while #9328 is unmerged.

## Scope and ownership

This branch owns Core rotation safety preflight/neutral bounded maintenance adapters and Enterprise `backups/lib/rotation-verification/`. A separate implementation branch owns the backup engine and bootstrap-free CLI from #8910. Coordinate the additive adapter contract before code; do not duplicate the engine or import Enterprise from Core. No online coordination, generic checksum tool, automatic key destruction or live restore.

## Phase-0 verification — observed 2026-11-12

- #9328 is an open design PR at 9b8c3cb584be39703ccafd1be7af6d32fe4dc3a8. Its comments explicitly retain security/dependency/custody and compatibility implementation gates; no recorded approval was found.
- #8910 merged as 25333cebaa, but its design and conversation retain Q2/Q3 human-confirmation gates. A spec merge is not dependency approval or proof of key custody.
- The planned Enterprise `backups` runtime module does not exist at this implementation base. Preparation cannot depend on a working backup artifact until that prerequisite ships.
- Current `TenantDek` has tenant ID, raw key and fetch time, with no immutable version identifier; fallback-capable KMS must not establish target-key identity. Core mapped rotation materializes a scope and chooses the first primary key; those are explicit refactor tasks below, not existing bounded guarantees.
- No production code, dependency, migration, crypto format or CLI contract has been changed. Whitespace and manual plan/source-link checks are the applicable validation for this preparatory commit; runtime correctness, recovery, performance and full gate are not claimed.

## Concrete decisions proposed for confirmation

1. **Entitlement:** retain the commercially licensed package boundary, explicit operator confirmation of rights for the installed version and DI capability availability. Do not invent a license server or treat module flags as licensing. Confirm that this is the supported Phase-0 policy; if a supported entitlement resolver already exists, supply that resolver instead. Subscription expiration alone does not revoke perpetual rights to an installed version.
2. **Fence:** v1 requires operator-provisioned dedicated maintenance credentials and an already stopped writer fleet. Preflight proves all relevant writer grants/access are denied, no in-flight/prepared writer transactions remain, and the reader has complete visibility including FORCE RLS; it refuses otherwise. The engine does not kill sessions or revoke production privileges automatically. Recheck role/policy/schema evidence before each phase and after reconnection; unexpected access or fence loss invalidates completion. Confirm this offline-only deployment contract.
3. **CLI compatibility:** the user-requested immediate mandatory `--acknowledge-unprotected-key-rotation` changes existing automation. Recommended compatible route is a first release with the red warning and explicit acknowledgment option while retaining existing invocation compatibility, followed by mandatory enforcement after at least one minor release, with dated upgrade/deprecation instructions. This changes the requested immediate refusal timing and therefore needs a specification decision before code. If immediate mandatory enforcement is required, a named maintainer must authorize a specific specification/compatibility amendment; the existing Emergency Security Exception is not assumed to cover this usage-risk tightening. This run cannot grant that amendment or exception to itself.
4. **Shared backup security:** Q2 requires security-owner approval of the exact age tool/library version/packaging and recipient custody; Q3 requires the data-key/escrow inventory and isolated drill criteria. The sibling backup run prepares that concrete decision packet. No production verifier implementation proceeds until the source spec's prerequisite is satisfied.

## Implementation Plan

### Phase 0 — prerequisite evidence and feasibility

1. Resolve source, audit duplicates and code reality; publish this plan and exact decisions in a draft implementation PR.
2. Record named security/custody/entitlement/fence/CLI compatibility decisions and the selected backup adapter contract. Confirm harness placement and test key custody using generated isolated fixtures; no live secrets in artifacts.
3. Spike typed baseline/final scans and bounded metadata on 1-GiB/20-GiB fixtures; measure overhead and prefetch bounds. Revise targets explicitly if infeasible, without reducing coverage.

### Phase 1 — encrypted expected-data verification

4. Implement typed canonical framing/golden vectors, run-key HMAC fingerprints with distinct concrete source/target keys, provider pinning and no-fallback verification. Cover wrong-but-valid ciphertext and unchanged-key negative controls.
5. Compose encrypted baseline/header/journal and trusted roots with the sibling backup engine; implement authenticated exact timestamp intents and expected lookup transitions. Reject swapped/tampered/replayed artifacts and unknown versions.
6. Implement indexed, server-prefetch-bounded persisted scans, exact identities/counts/roots and target-key-only reads, cancellation and sealed reports. Cover RLS/FORCE RLS subsets, all null/fallback/soft-delete/custom scopes and unsupported codecs.

### Phase 2 — Core and protected coordinator

7. Refactor neutral Core mapped/custom maintenance into composite-keyset batches, paged definitions/bounded caches, scoped conditional updates and durable batch callbacks; preserve existing semantics with regression tests.
8. Integrate Core red ERROR/exact per-invocation acknowledgment under the approved compatibility policy, plus mandatory Enterprise preparation/fence/backup/final verification through every real caller. No silent downgrade or skip-verification flag.
9. Implement journal reconciliation, ambiguous-commit handling and fresh full final scan on resume, with entitlement/provider/fence-loss recovery tests and retained original expectations/keys.

### Phase 3 — acceptance and publication

10. Run V01–V12, fault injection and quarantined recovery drill; publish cold/warm phase timings and process-tree resource measurements against the spec's targets.
11. Run every configured validation command in order, authoritative `om-auto-review-pr --autofix`, fix findings and publish exact evidence/limits in PR comments. Promote only when complete and required decisions resolved; no merge or QA self-approval.

## Risks and current limits

The main false-pass risks are shared codec errors, invisible RLS rows, fallback keys and mutable metadata exceptions; each has a named negative control. Backup runtime, explicit human decisions and compatibility approval are prerequisites, not optional follow-up work. This plan preserves every implementation step pending and grants no waiver.

## Progress

PR: #9334

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 0: prerequisites and feasibility

- [x] 0.1 Resolve source, audit duplicates/code reality, and publish implementation plan/gate report. — 8cdd245377
- [ ] 0.2 Record security/custody/entitlement/fence/CLI decisions and backup adapter contract.
- [ ] 0.3 Run isolated bounded-scan performance/codec spike.

### Phase 1: encrypted verification

- [ ] 1.1 Typed framing, concrete-key pinning and golden negative controls.
- [ ] 1.2 Encrypted baseline/journal and authenticated metadata/lookup expectations.
- [ ] 1.3 Independent bounded persisted scanner and complete scope comparison.

### Phase 2: rotation integration

- [ ] 2.1 Neutral bounded Core maintenance refactor and regressions.
- [ ] 2.2 Core risk acknowledgment and protected completion integration.
- [ ] 2.3 Resume/ambiguous commit/lost capability recovery.

### Phase 3: acceptance and publication

- [ ] 3.1 Full acceptance matrix, resources and quarantined restore drill.
- [ ] 3.2 Full configured gate, authoritative review/autofix and evidence report.
