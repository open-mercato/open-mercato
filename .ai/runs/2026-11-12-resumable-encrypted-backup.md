# Implement resumable encrypted Enterprise backup and restore

Source doc: .ai/specs/enterprise/2026-11-06-cli-backup-restore.md
Spec PR: #8910
Status: complete
Engine: om-auto-create-pr (steps: 12, --loop: no)

## Goal and scope

Implement the complete #8910 recovery engine: bootstrap-free Enterprise bin, app wrapper, encrypted bounded chunks/index/journal, honest consistency, durable backup and restore resume, per-entity progress, artifact verification and quarantined exercise. Core rotation acknowledgment and Enterprise data-equivalence verification are coordinated with the separate #9328 implementation; this PR owns the backup engine and its facade only. No live restore, production key export, automatic key retirement, scheduling/S3/retention scope expansion or direct Core import of Enterprise.

## Prerequisite verification — 2026-11-12

The merged source explicitly marks Q2 and Q3 NEEDS HUMAN CONFIRMATION. PR conversation and review sweep found design approval but no age dependency/custody approval; current reviews explicitly retain these implementation gates. Merging a design did not approve those decisions. The `backups` module is absent in the inspected base. No existing open implementation PR or occupied branch slot was found.

Concrete proposal for security-owner approval:

- Pin `age-encryption` 0.3.1 (the npm registry currently reports this release; source repository FiloSottile/typage), audit exact tarball/dependency provenance before use. Approve the supported version and security boundary explicitly; the version observation is not an endorsement or completed security audit.
- Use X25519 recipients with separate operator and offline escrow recipients; no plaintext identities/DEKs in artifacts, reports, argv or logs. Do not change the spec to a custom cipher.
- Use disposable PostgreSQL plus generated test identities and synthetic historical application keys for a self-contained backup/restore/canary escrow drill. Native integration harness: module-owned Playwright tests driving the CLI with disposable-Postgres fixtures, plus existing CLI unit contract tests. No developer DATABASE_URL, real customer data or production custody is required for this implementation proof. Harness placement is resolved: executable Playwright tests belong in `packages/enterprise/src/modules/backups/__integration__/`, per `.ai/qa/AGENTS.md`; unit contracts belong in module `__tests__`. No harness-location approval is needed.
- Deployment-specific custody inventory and real operational escrow drill remain deployment acceptance, separate from synthetic implementation feasibility. Implementation must never claim a synthetic drill proves a real deployment recoverable.

Local tool probe: `age`, `pg_dump` and `psql` are absent from PATH; Docker CLI exists. Disposable container/client provisioning is an implementation prerequisite, not evidence of a completed drill. Runtime unit/integration/performance gates have not run; no runtime code is committed while Q2/Q3 implementation approval is unresolved.

## Dependency investigation — 2026-11-12

Candidate `age-encryption@0.3.1` is BSD-3-Clause and maps to official `FiloSottile/typage` tag `v0.3.1`, commit `38b8b10cb22409de0eaa8a617a01f16dc2e3f9f4`. Registry integrity: `sha512-bYgd7lxM7tEANmb9bXf7xTFB3Qpq+JGKinVSdFh5MV+t2fJJZSTdKhWkvXTFJQGysZd+K9Dt3F+n+4DKazXlnQ==`. Direct dependency ranges include Noble ciphers/curves/hashes/post-quantum and Scure base. An isolated temporary package-lock resolved this exact candidate using `npm install --package-lock-only --ignore-scripts`; `npm audit --json` reported zero known advisories (0 critical/high/moderate/low) for that resolution. No repository dependency or scripts were installed/executed. Advisory absence is not a cryptographic/security approval; exact tarball/source review and supported version selection remain Q2.

Synthetic Q3 drill proposal: generate two X25519 recipient identities and historical application test DEKs; create two-tenant fixtures with encrypted canaries; produce a quiesced encrypted artifact; remove the primary identity from the recovery host; restore to a fresh network-isolated database using only offline escrow identity plus retained historical test DEKs; compare logical fixture values and verify zero callback/queue effects. Clean all generated keys/databases/files in `finally`. An implementation approval may accept this protocol without supplying any production custody material. Real deployment escrow ownership remains deployment acceptance.

## Implementation plan and risks

Follow phases in source order; no dependency addition, crypto implementation, key mutation or production runtime work before approval. The 20-GiB spike must establish snapshot-export/chunk encryption throughput and honest resume labels. All reported completion evidence must name the tested head, environment and actual limitations. Keep required CI and independent review gates intact.

## Progress

PR: #9333

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 0: approval and feasibility

- [x] 0.1 Obtain explicit Q2 age version/recipient/custody approval, Q3 synthetic-vs-deployment escrow acceptance, ; record evidence without secrets.
- [x] 0.2 Provision disposable PostgreSQL and run the 20-GiB snapshot/chunk/age feasibility spike with published resource measurements. — ece9ca7d41; pinned eight-entity/eight-worker 20-GiB stress passed at215.27MiB with complete content equality; final full matrix remains3.2.

### Phase 1: bootstrap and encrypted backup

- [x] 1.1 Register the Enterprise backups module/bin and disabled capability flags; sync create-app template and generated registries via native commands.
- [x] 1.2 Implement versioned schemas, process/resource adapters, preflight and encryption policy with B01/B03/B12/B13/B15 tests. — e5dcca649d
- [x] 1.3 Implement bounded snapshot/chunk pipeline, encrypted journal, sealing and per-entity progress with B01/B10/B18 tests.
- [x] 1.4 Implement resume epochs, conservative consistency proof, DDL restarts, sequence reconciliation and lock recovery with B04/B05/B06/B11.

### Phase 2: verification and recovery

- [x] 2.1 Implement offline verify/status and bootstrap-free entry point with B09/B17 contract tests.
- [x] 2.2 Implement identity challenge, restore journal, chunk transactions, post-data/FKs and progress with B02/B07/B08/B10.
- [x] 2.3 Implement declarative exercise and synthetic escrow/canary drill with isolation assertions B14.

### Phase 3: integration and release verification

- [x] 3.1 Expose the backup facade for the automated pipeline and protected rotation; coordinate Core acknowledgment/verifier boundary B19/B20 with #9328 implementation without duplicate code ownership.
- [x] 3.2 Complete B01–B20, benchmarks, operator documentation, custody guidance and configured full validation commands.
- [x] 3.3 Run authoritative om-auto-review-pr --autofix, post verification/outcome comments, publish ready only when every step is complete and gates pass.

## Resume

Current resume: Q2/Q3 are explicitly authorized below. Finish final performance evidence, configured validation, independent review and verification/report comments via `om-auto-continue-pr`; never merge.

## Authorization — resumed 2026-11-12

User explicitly approved all pending proposals: “yes go on, the modules go to enterpirse / commercial i've got the rights to do so”. Q2/Q3 implementation policy is authorized; real deployment custody acceptance remains separate. Harness is repository-native. Production implementation now proceeds without requesting these approvals again.

## Implementation checkpoint — e5dcca649d

Engine/native facade/CLI and14 artifact-security tests landed; independent native6-case PostgreSQL16 suite passed (generated/composite/FK/heap/JSON/LO roundtrip, COPY rollback+retry, binding refusal, staging cap, RLS rejection and LO rollback). Precommit i18n/template parity passed. Full configured validation and source acceptance/performance evidence remain pending; no ready/runtime completion claim. Runner: local; no configured compose app running for this task. Initial generate before builds refused correctly because CLI was not built; ordered full gate now starts with build:packages.

## Final correctness checkpoint — 2026-11-12

Implemented mandatory offline schema TOC parsing without a DB connection, cumulative restore/verify progress, complete recovery-report metadata and bound selective resume. Actual PostgreSQL tests cover read-only resume binding, stale challenge invalidation, terminal-receipt recovery, and a full encrypted restore interrupted after a committed COPY: deleting that already-loaded artifact chunk still resumes correctly with matching SQL content, resumeCount=1 and journal cleanup. Artifact tests verify separately supplied historical canary custody and truthful report outcomes. Validation currently: native25 + TOC4 passed; new focused native resume tests4 passed; artifact/progress19 passed; Enterprise TypeScript and diff checks passed. Full ordered gate, final four-state benchmark report and independent current-head review remain pending, so status remains in-progress.

Known resource scope: pg-protocol delivers whole per-row COPY frames, which can exceed stream high-water marks. A separate two-row16-MiB-field probe reached ~251MiB native-only RSS at jobs1; this does not certify all legal PostgreSQL field sizes or jobs8 giant-row workloads. Operational documentation records this limitation. No deployment custody or production-data acceptance is claimed.

## Concurrency and resource verification checkpoint — 2026-11-12

Restore now uses1–8 independently connected, identity/run-bound chunk workers while the controller holds the target lock. Each entity stays ordered, peers stop dispatching new chunks after a failure, all workers finish/close before post-data, and target connection capacity is checked before mutation. Actual PostgreSQL eight-way concurrency, selective recovery and peer-failure tests pass. Both directions and offline verification emit aggregate counts for the localized overall TTY bar.

Independent review found an earlier native COPY input-pump lifetime bug: PostgreSQL refusal or cancellation returned while the producer kept consuming data. Query/socket cancellation now stops dispatch, aborts drain waits and awaits the owned generator's finally block before rollback/API return. Both actual PostgreSQL negative controls failed before the fix and pass after it. Stable owned stream outputs avoid redundant buffer copies; transform adapters use explicit byte mode/high-water marks. Pinned Node24 Readable.from defaults to one object, so no sixteen-object queue claim is made.

All seven module suites pass with actual PostgreSQL enabled:65 tests in51.1s, including corruption protection, eight-way restore and input cleanup. The earlier complete eight-command gate passed before these final concurrency/resource changes; final current-head full validation is required and pending. Fresh1GiB jobs6/7/8 runs now meet coordinator RSS at~211/227/239MiB with complete ordered SQL digests and actual matching backup/restore concurrency. Full20GiB matrix and final benchmark artifacts remain in progress under the parent run. Keep status in-progress until those and final review/report are complete.

## Frozen engine verification — ece9ca7d41

All seven backup suites passed with actual PostgreSQL:69 tests in49.594s. The exact frozen engine passed all eight configured validation commands, including the full repository test gate (280.04s) and production app build. Earlier uncached production build also passed. The final independent targeted code read found no unresolved blocker/major in the reviewed changes; earlier native/TOC authorship was explicitly disclosed, and the formal final verdict awaits performance evidence.

Quiesced partial keyset resume now verifies every retained file's authenticated SHA/size before opening a new epoch; checks contiguous paths/sequences/cursor links; reuses the prefix only with exact source/schema and continuous postmaster lifetime; re-bases suffix sequences; and proves independent full COUNT = retained rows + remaining snapshot COUNT. Stable physical-origin collision checks remain conservative across old/new lifetime formats. Changed lifetime, unproven visibility or non-keyed entities never silently reuse a prefix.

Actual standalone CLI SIGKILL proof: after two durable chunks, CLI resume retained1,022 rows without rewriting those ciphertext inodes/mtimes;17 contiguous chunks restored all8,192 synthetic rows with equal complete ordered content; JSON runId matched backupId. Reproducible guarded crash.mts uses only its own random databases and exclusive loopback Docker fixture, temporarily quiesces autovacuum and restores it in finally. An unquiesced attempt correctly refused before reuse. No claim is made for power failure/every filesystem boundary.

Actual20-GiB restore resume:705ms overhead including challenge, authenticated metadata, journal binding, pending-only verification and initialization; one committed chunk skipped; full ordered digest matched;180.25MiB peak coordinator RSS. Pinned20-GiB/eight-entity/eight-worker stress after256-KiB burst bounds:215.27MiB coordinator RSS, correct8/8 concurrency in both directions, all ordered content digests matched. Earlier over-budget runs are preserved in the parent benchmark audit. Full jobs1–8 matrix and final matched warm/cold latency evidence remain3.2, so Status remains in-progress.

Verification comment: https://github.com/open-mercato/open-mercato/pull/9333#issuecomment-6825226947
Source backlink: https://github.com/open-mercato/open-mercato/pull/8910#issuecomment-6825998376


## Final release verification — source d6c6e3e0bb

All twelve steps are complete. The final source passed96/96 tests across eight backup module suites against real PostgreSQL in61.774s. Every configured command passed in order: build:packages2.53s, generate9.02s, build:packages0.96s, i18n:check-sync0.97s, i18n:check-usage3.06s, typecheck2.01s, full test304.81s, production build:app20.80s. Generated files and diff checks are clean. This final evidence supersedes the earlier in-progress checkpoints without rewriting their history.

All16 actual eight-entity1/20-GiB jobs1–8 worker runs passed full ordered content equality, observed requested concurrency in both directions and coordinator RSS≤256MiB (maximum227.44MiB). Matched warm/cold1/20-GiB latency and production progress CPU pass; final20-GiB cold backup/restore32.248/30.405s, RSS198MiB. Exact artifact hashes, runtime/image provenance, safe aggregate reports and fixture/cache/row-width limits are committed under `.ai/qa/2026-11-12-cli-backup-restore/`. The final cold measurement includes the public summary and multi-entity renderer.

Fresh Enterprise build and actual packed Node24 binary outside the application checkout passed all five locale help checks, single JSON stdout on development/production errors even with caller stdout logging selected, encrypted create128rows, offline schema TOC verification without DB configuration, completed status and no files/.env created in the outside working directory. The actual final built-bin PTY capture shows simultaneous workers/queued summary, three recent completions and final143/143; screenshot evidence is linked from the verification report.

Final sequence safety tests cover signed int8 values, exact non-unit positive/negative progressions, values beyond JS safe integers, captured empty is_called=false, source reset/deletion across snapshots, all-plan validation before nontransactional writes, and lost acknowledgment after a successful setval followed by idempotent replay. Owned cyclic/non-base-integer sequence configurations fail before backup streams. Target unsafe plans remain quarantined with exit6. Restore now checks authenticated expected SHA/count against each committed chunk checkpoint before skipping; a tampered checkpoint is rejected with integrity context, while a valid committed chunk need not be reread from the artifact.

The backup facade is consumed by companion #9334. Parent executed actual Core CLI, real Enterprise DI and MikroORM integration against a separate disposable database; this PR remains scoped to the backup engine and registration contract. The July automated-backup design remains a separate spec; B16's scheduler/S3/retention/chunk-store pipeline is not folded into this manual CLI implementation.

Authoritative final review: https://github.com/open-mercato/open-mercato/pull/9333#pullrequestreview-5878610354 — APPROVED recommendation, no unresolved blocker/major, recorded as COMMENT because the authenticated account is the PR author. Independent review scopes and older native-adapter authorship limitations are disclosed. Required CI and manual QA remain external merge gates; no self-QA approval or merge is claimed. The documented giant-row/performance/custody limitations remain applicable.

Final publication uses the existing verification and source-backlink comments above, completes this plan, publishes the PR ready for manual QA and releases only this run's atomic claim. No production source changed after d6c6e3e0bb; this final commit records verification only.
