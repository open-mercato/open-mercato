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

The main false-pass risks are shared codec errors, invisible RLS rows, fallback keys and mutable metadata exceptions; each has a named negative control. Backup runtime, explicit human decisions and compatibility approval are prerequisites, not optional follow-up work. Implementation progress is recorded below; remaining acceptance and publication steps stay pending and no gate is waived.

## Progress

PR: #9334

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 0: prerequisites and feasibility

- [x] 0.1 Resolve source, audit duplicates/code reality, and publish implementation plan/gate report. — 8cdd245377
- [x] 0.2 Record security/custody/entitlement/CLI decisions, offline-fence enforcement evidence and backup adapter contract. — 63100e7c32
- [x] 0.3 Run isolated bounded-scan performance/codec spike. — 994bceafe2 (fresh final resource/performance acceptance remains step 3.1)

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


Acceptance checkpoint: 994bceafe2 fixes a measured 20-GiB custom query-planner problem by materializing the light primary-key frontier before eligibility or TOAST projection; full ineligible pages still advance/checkpoint. Actual 20-GiB EXPLAIN confirms bounded index reads, and 38 Core/37 native dataset tests pass. The interrupted run resumed against its original encrypted recovery artifact and authenticated baseline, then compared all 327,680 persisted rows successfully. Its measured overhead failure is retained in diagnostic JSON and is not accepted as a fresh performance run. Fresh final 1/20-GiB warm/cold runs remain pending.

179317643a rejects unpaired UTF-16 surrogates before canonical UTF-8 framing; real Core CLI/ORM/Enterprise DI proves refusal before mutation. The final backup operator/sequence prerequisite 917e126886 and main 825240d58b are reconciled without deleting either upgrade entry. Node 24.22.2 immutable installation, the first seven configured commands, the two actual CLI-native cases and the unchanged seven-case compatibility-context guard pass. A later upstream backup integrity milestone requires one final source merge and full eight-command rerun; release readiness and authoritative review remain pending.


## Current verification checkpoint — runtime 243661d18a

The implementation now includes strict authenticated UTF8 decoding, fixed built-in PostgreSQL type/array support, ISO timestamp and round-trip float projection, and frozen output-format bindings. Actual float and historical timezone-abbreviation collision fixtures refuse before mutation. Fused exact-snapshot page guards withhold all contents on overflow, preserve native composite ordering and exact counts, and keep all guarding time inside the final verification stream. Bounded Core readback CTEs retain separate committed-value checks and all original typed/scope/timestamp predicates.

- Final integrated PostgreSQL dataset suite: **68/68 passed** (55.463 s), including shadow relations/catalogs, malformed codecs, composite and typed late corruption, exact-page sentinels and native bounded-index plans.
- Real Core CLI/MikroORM/Enterprise DI/native backup integration: **3/3 passed** on runtime243. Separate Core committed-readback native cases: **3/3 passed**; Core regression packet: **46 passed**.
- Actual process-death matrix remains all36 cases with unchanged15-second child and30-second case bounds. The full workspace attempt overlapped a confirmed1032-second host suspension and timed out; test-only be6aca022b compiles the actual production-backed child once per suite while preserving fresh Node processes and every assertion. Focused36 and detectOpenHandles36 passed; the full configured rerun is still pending.
- Persistent named PGDATA and artifact volumes now have explicit runner/image provenance.42 Node/PostgreSQL/runtime binaries and libraries match the previous image byte-for-byte. The old stopped container, encrypted artifacts and failed overlay-filesystem measurements remain preserved.
- Runtime243 1 GiB warm and true-cold runs passed every numeric gate. Warm:14.250 s incremental overhead,4.044 s final/reference2.840 s (70.236%),211.95 MiB coordinator/225.61 MiB sampled process tree. Cold:14.210 s overhead,3.935 s final/reference2.854 s (72.53%),206.78/212.19 MiB. All fused guard time is included, with no separate preflight subtraction. Node24.22.2 uses the disclosed128 MiB oldspace/semi4 flags; the full application bootstrap memory is not inferred.
- Earlier20 GiB failures remain explicit nonacceptance artifacts, including the fully quiet0eb overhead/throughput failure. Fresh24320 GiB warm source is seeded but no measurement starts until the current configured gate finishes. True-cold20 GiB, near-limit large-row stress and final authoritative review/report remain pending.

No key retirement, fence release, production promotion or merge is authorized by a passing fixture.


## Frozen acceptance candidate — cc62df6e86

The profile-driven candidate removes repeated raw-string progress byte scans using the exact fused SQL projection byte count, without changing the wire/page cap or public progress totals. Canonical columns are preordered separately from schema and native-key order. Single-allocation framing and the local public-empty-metadata HMAC reuse preserve prior protocol bytes, key binding and all metadata checks. The source-first baseline still accepts mixed valid keys; the separate read-only target iterator makes the reference comparison target-only without intent/HMAC work. Production final verification remains mandatory and target-key-only.

Actual integrated dataset tests pass70/70 (53.975 s), canonical/verifier43/43 pass, strict TypeScript passes, and real Core CLI/DI/ORM/native protection passes3/3 (7.889 s). All eight configured commands pass on cc62. An unchanged fullgate retry passed the earlier unrelated module-decoupling assertion without any fixture, assertion or production attachment edit; the failed attempt and isolated13/13 proof remain retained.

One consistent Node128 MiB oldspace/semi4 policy is pinned for final acceptance. Fresh1 GiB warm/cold cases pass all numeric gates: warm12.972 s overhead and3.580/2.565 s final/reference (71.63%), coordinator208.39 MiB; cold12.636 s overhead and3.458/2.481 s (71.75%), coordinator209.71 MiB. There is no host-sleep overlap or heavy measured-phase concurrency. Earlier semi8 and other failed cases remain nonacceptance evidence; passing cases are not assembled across policies.

Fresh20 GiB warm/cold, same-bundle near-limit large-row stress, and concluding authoritative review/report remain pending. No20 GiB performance pass is inferred from the small cases.


## Performance gate checkpoint — 2026-11-13

The complete, quiet cc62 20 GiB warm run compared all327,680 rows correctly, but failed both unchanged timing gates: final70.262 s/reference48.437 s (68.94%), overhead271.444 s versus259.616 s allowance. No20 GiB cold run followed. Actual timestamped host sleep logs show no sleep/wake event inside the cc62 warm/cold1 GiB or failed20 GiB envelopes; this audit is independent of the ordinary-idle lease. Failed raw results remain in QA artifacts.

A bounded private checksum-worker spike in3ae3af3535 preserves the exact canonical/HMAC/chunk/root protocol. Independent lifecycle review required lazy startup plus an independent failure signal; actual PostgreSQL proves that terminating an idle worker after a successful digest cancels an in-flight query, joins source/worker cleanup, and releases a pool-one connection within15 seconds. Focused124 cases, strict TypeScript, native70 and actual CLI3 pass. Benchmark-only73d3ec7a2c conservatively measures the maximum of source lifetime and complete verifier receipt duration, so worker tail/startup/IPC/normal exit cannot fall outside the final timing gate.

The fresh1 GiB worker spike fails release acceptance: all16,384 rows compare, but final4.679 s/reference3.119 s (66.65%) and300.75 MiB coordinator RSS fail the unchanged70%/256 MiB targets. Its15.798 s overhead passes. The process-tree sample is299.55 MiB and includes worker threads in the same process RSS. A separate, nonacceptance memory diagnostic shows RSS remaining268.79 MiB after baseline worker exit while main-thread heapUsed is20.18 MiB, external24.06 MiB and ArrayBuffers6.27 MiB. This suggests retained native/transfer allocation footprint; it does not identify an exact allocator cause. No child-process/slab architecture or threshold change is accepted from this evidence. Bounded synchronous alternatives are being measured separately.

The worker runtime still needs a renewed full configured gate and a complete consistent resource/performance matrix if retained. Neither implementation readiness nor a20 GiB acceptance pass is claimed. The spec materialization stays untracked and the implementation PR stays draft.


## Synchronous acceptance candidate — f89de9e887

The failed checksum-worker runtime is reverted in ae89b8ca00, with its full timing/resource evidence retained. The current synchronous codec coalesces exact canonical frames into a bounded4KiB scratch buffer only for large leaves, and preserves the existing full-buffer path for small/wide rows. Independent old-frame tests retain byte-for-byte HMAC/chunk/root equivalence, Unicode/number/prototype/duplicate checks and the one-MiB row cap. The parser skips a byte rescan only when the mathematical UTF16-to-UTF8 upper bound proves the original one-MiB cap; longer inputs retain the exact original byte check. Per-reader cancellation composition remains, with an actual PostgreSQL pool-one query-abort/cleanup proof.

Actual native71, canonical/verifier47, parser8, strict TypeScript and Core CLI3 pass. All eight configured commands pass on exact production f89/Node24.22.2:51workspace tasks in5m39.885s and app build25.996s. Earlier unrelated full-suite isolation-flake evidence stays preserved; no assertion or fixture is weakened. The benchmark conservatively counts complete verification duration, not just source iterator lifetime.

Fresh final-source1/20GiB warm/cold and near-limit-row acceptance remain pending. The exact frozen bundle is f58d62b0ff47cf1ade82a79d0fa20b601ec7fa476f90b2902cb375552b249cd3. No timing measurement is launched while unrelated heavy host tests/builds continue. The final external process-tree sampler now requires observed process completion rather than timing out before a long20GiB run finishes; host-load and actual sleep-envelope audits accompany new cases. The implementation remains draft and no20GiB performance pass is inferred.


## Approved operator presentation and documentation amendment — 2026-11-13

The owner reviewed the setup-style terminal mockups and explicitly approved implementation. Scope: colored titles, phase headings, status icons, divider/result/error cards, truthful progress, strict plain/NO_COLOR/dumb fallback and machine-progress purity, preserving existing stdout, commands and exit codes. Official operator documentation and Enterprise licensing/feature lists are also requested. This does not approve the separately proposed isolated CI automation. No backup archives, dumps, keys or large fixtures are uploaded.

- [x] A.1 Implement the approved terminal presentation and output-contract regressions.
- [x] A.2 Publish official feature documentation and Enterprise feature listings.
- [x] A.3 Run configured validation, independent review and actual CLI screenshot checks.
- [x] A.4 Publish verification and executable manual-test instructions in the PR comment.


### Presentation amendment verification — source c69d4f6ee3

All eight configured commands passed in order with local Node 24.22.2, including the 51-task workspace test and production application build. Separate-agent source review found no unresolved blocker or major. Official operator guides/navigation and Enterprise overview, README and subscription feature lists pass documentation checks. Current-source actual terminal/JSON proof and immutable screenshots are recorded in `.ai/qa/2026-11-13-cli-presentation/`. Manual test instructions and the actual-output screenshots are published at https://github.com/open-mercato/open-mercato/pull/9334#issuecomment-6852295266. No archives, dumps, keys or raw private logs were uploaded. Required CI and manual QA remain separate; no merge was performed.

This presentation/documentation amendment is complete. Original performance/resource acceptance and concluding release review remain open; the full fresh final-source cohort is not claimed. No isolated CI/workflow change was authorized or dispatched.
