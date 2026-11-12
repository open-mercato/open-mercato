# Execution plan — Enterprise key-rotation data verification

Source doc: .ai/specs/enterprise/2026-11-12-key-rotation-data-verification.md
Source PR: #9328
Backup prerequisite: #9333 implementation (stacked); #8910 merged design
Status: in-progress — implementation and integrated verification underway
Engine: om-auto-create-pr (steps: 11, --loop: no)

## Goal

Implement complete, bounded Enterprise data-equivalence verification after rotation, retain deliberate unprotected Core rotation, and publish tested implementation with verification evidence. The design PR stays design-only; its file is materialized locally but not committed here while #9328 is unmerged.

## Scope and ownership

This branch owns Core rotation safety preflight/neutral bounded maintenance adapters and Enterprise `backups/lib/rotation-verification/`. A separate implementation branch owns the backup engine and bootstrap-free CLI from #8910. Coordinate the additive adapter contract before code; do not duplicate the engine or import Enterprise from Core. No online coordination, generic checksum tool, automatic key destruction or live restore.

## Initial Phase-0 verification — before operator authorization, 2026-11-12

- #9328 is an open design PR at 9b8c3cb584be39703ccafd1be7af6d32fe4dc3a8. Its comments explicitly retain security/dependency/custody and compatibility implementation gates; no recorded approval was found.
- #8910 merged as 25333cebaa, but its design and conversation retain Q2/Q3 human-confirmation gates. A spec merge is not dependency approval or proof of key custody.
- The planned Enterprise `backups` runtime module does not exist at this implementation base. Preparation cannot depend on a working backup artifact until that prerequisite ships.
- Current `TenantDek` has tenant ID, raw key and fetch time, with no immutable version identifier; fallback-capable KMS must not establish target-key identity. Core mapped rotation materializes a scope and chooses the first primary key; those are explicit refactor tasks below, not existing bounded guarantees.
- No production code, dependency, migration, crypto format or CLI contract has been changed. Whitespace and manual plan/source-link checks are the applicable validation for this preparatory commit; runtime correctness, recovery, performance and full gate are not claimed.

## Concrete decisions proposed for confirmation

1. **Entitlement:** retain the commercially licensed package boundary, explicit operator confirmation of rights for the installed version and DI capability availability. Do not invent a license server or treat module flags as licensing. Confirm that this is the supported Phase-0 policy; if a supported entitlement resolver already exists, supply that resolver instead. Subscription expiration alone does not revoke perpetual rights to an installed version.
2. **Fence:** v1 requires operator-provisioned dedicated maintenance credentials and an already stopped writer fleet. Preflight proves all relevant writer grants/access are denied, no in-flight/prepared writer transactions remain, and the reader has complete visibility including FORCE RLS; it refuses otherwise. The engine does not kill sessions or revoke production privileges automatically. Recheck role/policy/schema evidence before each phase and after reconnection; unexpected access or fence loss invalidates completion. This offline-only contract is already selected by the source; enforcement and fixture evidence are autonomous implementation work, not a separate approval request.
3. **CLI compatibility:** the user-requested immediate mandatory `--acknowledge-unprotected-key-rotation` changes existing automation. Recommended compatible route is a first release with the red warning and explicit acknowledgment option while retaining existing invocation compatibility, followed by mandatory enforcement after at least one minor release, with dated upgrade/deprecation instructions. This changes the requested immediate refusal timing and therefore needs a specification decision before code. If immediate mandatory enforcement is required, a named maintainer must authorize a specific specification/compatibility amendment; the existing Emergency Security Exception is not assumed to cover this usage-risk tightening. This run cannot grant that amendment or exception to itself.
4. **Shared backup security:** Q2 requires security-owner approval of the exact age tool/library version/packaging and recipient custody; Q3 requires the data-key/escrow inventory and isolated drill criteria. The sibling backup run prepares that concrete decision packet. No production verifier implementation proceeds until the source spec's prerequisite is satisfied.

## Implementation Plan

### Phase 0 — prerequisite evidence and feasibility

1. Resolve source, audit duplicates and code reality; publish this plan and exact decisions in a draft implementation PR.
2. Record named security/custody/entitlement/CLI compatibility decisions and the existing offline-fence enforcement evidence and the selected backup adapter contract. Use the repository-native integration harness and test key custody using generated isolated fixtures; no live secrets in artifacts.
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

## Preparatory review

Independent parent-agent review found no blocker in this plan-only diff. Clarified that offline fencing is an existing requirement, not a new approval request; native integration harness placement follows AGENTS guidance. This is a preparatory review, not production code approval.

## Risks and current limits

The main false-pass risks are shared codec errors, invisible RLS rows, fallback keys and mutable metadata exceptions; each has a named negative control. Backup runtime, explicit human decisions and compatibility approval are prerequisites, not optional follow-up work. This plan preserves every implementation step pending and grants no waiver.

## Progress

PR: #9334

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 0: prerequisites and feasibility

- [x] 0.1 Resolve source, audit duplicates/code reality, and publish implementation plan/gate report. — 8cdd245377
- [x] 0.2 Record security/custody/entitlement/CLI decisions, offline-fence enforcement evidence and backup adapter contract. — 63100e7c32
- [ ] 0.3 Run isolated bounded-scan performance/codec spike.

### Phase 1: encrypted verification

- [x] 1.1 Typed framing, concrete-key pinning and golden negative controls. — 9d7a7183de
- [x] 1.2 Encrypted baseline/journal and authenticated metadata/lookup expectations. — 63100e7c32
- [x] 1.3 Independent bounded persisted scanner and complete scope comparison. — 63100e7c32

### Phase 2: rotation integration

- [x] 2.1 Neutral bounded Core maintenance refactor and regressions. — 0b5ef6c401
- [x] 2.2 Core risk acknowledgment and protected completion integration. — fb0d766ecb
- [x] 2.3 Resume/ambiguous commit/lost capability recovery. — 0b5ef6c401

### Phase 3: acceptance and publication

- [ ] 3.1 Full acceptance matrix, resources and quarantined restore drill.
- [ ] 3.2 Full configured gate, authoritative review/autofix and evidence report.


## Authorized continuation — 2026-11-12

The operator instructed: “yes go on, the modules go to enterprise / commercial i've got the rights to do so”. The driving agent recorded authorization for the proposed package-rights attestation/capability boundary, pinned age dependency and isolated custody-drill design, and immediate mandatory Core CLI acknowledgment through the specific dated compatibility amendment. This does not waive QA/CI, attest production key custody, authorize key retirement, or authorize a merge. Existing offline fencing and native harness requirements are implemented/tested autonomously.

Implementation milestones: 9d7a7183de typed/encrypted verification engine and tests; 63100e7c32 neutral Core guard/bounded adapters plus PostgreSQL dataset and coordinator; 46160d7873 merges #9333's recovery-engine prerequisite without copying its source/spec. #9333 must merge before this implementation to remove the inherited diff. New implementation uses actual pg_dump/COPY, age encryption and native persisted scans; source #9328 remains separate and is not committed here.

Verification underway: independent review found and corrected global-policy omission, numeric-PK text-alias pagination, quadratic custom-document size probes, provider-provenance and durable-report retry concerns. Native disposable PostgreSQL tests now include full production protection roundtrip, valid-but-wrong ciphertext, target-key-only failure, complete numeric-PK coverage, global policy coverage/refusal, writer grants, RLS/FORCE RLS and microsecond timestamp preservation. Runtime performance is being measured on real encrypted scalar/custom data at 1/20GiB; no unmeasured target is marked passed. Full configured gate and final authoritative review remain pending.

Final safety milestones: 0b5ef6c401 binds the offline admission fence before any scope reads, validates column/schema privileges and worker drain, preserves exact JSON numeric tokens and prototype-named properties, authenticates attempt-specific failure aggregates, and includes real Core CLI/Enterprise DI/MikroORM plus real SIGKILL journal evidence. d3192ddd0f makes the frozen CLI registry authoritative; 619583e34e budgets prefetched wire pages; fb0d766ecb adds authenticated empty-value maintenance support without altering the existing nonempty heuristic. Current source is frozen for the complete validation and performance gate.

Measured resource scope is the standalone coordinator with explicit Node heap flags, actual native recovery and real neutral Core maintenance helpers. The real CLI handler is tested functionally with actual ORM and DI; whole-application bootstrap memory is not claimed by the standalone measurement. Earlier exploratory timing files are preserved with `releaseAcceptance:false`, including a failed cold throughput result before the final prefetch implementation. Neither 20-GiB acceptance nor final release readiness is claimed until measured.
