# Canonical module requirements

Goal: Match module requirements by module ID or canonical package/repository origin, preserve one enabled provider per runtime ID throughout installation and generation, and support explicit provider replacement without overwriting local source.

Source doc: `.ai/specs/implemented/SPEC-065-2026-03-14-official-modules-cli-install-and-eject.md`

Scope: Additive locator metadata/configuration, distinct npm and GitHub requirement identities, dependency checks in installation and generation, inspected-artifact installation, package-binding preservation, alias enablement, safe ejection, actionable recovery guidance, and the aligned create-mercato-module companion PR.

Plan: Preserve legacy IDs; normalize npm locators to package identities and GitHub aliases to owner/repository identities. Keep version/ref selectors for installation guidance without introducing version constraint validation. Read origin from dependency specifications and optional retained provenance, checking installed manifest identity; repository metadata alone does not establish a GitHub source. Preserve provenance for ejected modules. Inspect npm artifacts without lifecycle scripts, preserve requested selectors and recheck the installed version, inspect local file sources directly, and pin GitHub commits. Reject ID or binding collisions before Yarn, and reject duplicate enabled IDs before every generator writes output. Cover the real CLI/generator flows with focused tests and run the configured gate.

Risks: Short IDs remain intentionally origin-agnostic. An npm package repository field cannot establish GitHub installation provenance. Package aliases do not namespace runtime IDs. Failures after Yarn may leave a dependency installed without completed enablement; failures after registration may leave stale generated output. Neither case is successful completion, and recovery must preserve local source and restore dependency bindings through the package manager. Disabling generated discovery does not remove manual imports or migrate data. Full repository validation may encounter environment failures, which must be recorded without claiming success.

## Progress

PR: #7283

### Phase 1: Canonical identity

- [x] 1.1 Add shared normalization and optional locator metadata/configuration. — 312ad6a3ba
- [x] 1.2 Resolve canonical requirements in all generator validation and ordering paths. — 312ad6a3ba (all three validation paths; existing generators have no dependency topological ordering)

### Phase 2: Installation and alignment

- [x] 2.1 Add origin-aware preflight, install guidance and collision protection. — 312ad6a3ba, 55c2e1ca3d
- [x] 2.2 Align create-mercato-module and open companion PR if needed. — companion PR https://github.com/open-mercato/create-mercato-module/pull/6, commit 10d2157

### Phase 3: Verification

- [x] 3.1 Run focused unit/integration coverage and configured validation gate. — configured test command encountered worker SIGSEGV; complete CLI passed serially (112 suites, 2098 tests), supplementary remaining-package verification recorded below.
- [x] 3.2 Review changes, publish evidence and update PR. — independent final source review: no remaining blocker/major; final provenance/discovery fixes 14680ab6c2.

## Related deliverables

Collision policy specification: https://github.com/open-mercato/open-mercato/pull/7289 (`.ai/specs/2026-10-12-module-source-collision-policy.md` on its branch). The October 22 alignment implements its lifecycle-wide ID and binding collision policy, aliases, explicit replacement, optional provenance, and disable semantics. Automatic runtime namespacing, provider data migration, and arbitrary application import rewriting remain outside the supported flow.

## Verification evidence

Runner: local. Focused CLI unit tests: 117 passed. Shared canonical parser: 24 passed. App/scaffold TypeScript compatibility: 6 passed (failure-first TS2353 baseline confirmed). CLI integration: all 8 passed with an exact-file Playwright configuration; the broad repository configuration stalled during discovery and is not reported as passed. Companion generator: 175 passed, 5 environment-gated skips; typecheck, lint and pack passed. Package builds, generation, i18n sync/usage, typecheck and production app build passed. Default yarn test failed twice with Jest worker SIGSEGV in varying CLI suites; no assertion failures remained. The entire CLI suite passed with --runInBand: 112 suites, 2098 tests, 2 snapshots. Independent final source review found no remaining blocker/major. Remaining packages passed separately: 47 Turbo tasks, including core (2243 suites / 20839 tests) and create-app (909 passed / 5 skipped). Companion CI is green. Details are recorded in the PR run summary; the default parallel test gate is not claimed green.

## October 22 collision-policy alignment

### Phase 4: Specification alignment and merge readiness

- [x] 4.1 Inspect the resolved collision policy and route the implementation changes through the CLI's actual install, enable, eject, resolver, and generator entrypoints.
- [x] 4.2 Document exact-artifact preflight, binding consumers, aliases, optional provenance, explicit disable/replacement, and recovery from partial installation or stale generation.
- [ ] 4.3 Complete focused CLI regressions, the configured validation gate, final review, and published-head CI checks; record the new evidence separately from the historical verification above.

Implementation contract:

- npm preflight inspects the requested artifact using `npm pack --ignore-scripts`, selects its shipped module descriptors, and verifies the installed version against the inspected artifact while preserving the requested selector. Local `file:` sources are inspected directly. GitHub preflight resolves the chosen repository/ref to a pinned commit.
- Before Yarn changes a binding, every enabled consumer must retain its canonical origin and module layout. Same-source npm updates and same-repository GitHub updates are supported; switching providers requires disabling the affected entries first.
- Installed aliases resolve through the dependency binding while retaining the canonical package manifest name. They do not create another runtime ID or make two providers with the same ID coexistent.
- Generation rejects duplicate enabled IDs before output writes, including same-source duplicates. A valid single-entry package/local overlay remains supported, and an explicitly empty enabled-module list stays disabled.
- Ejection validates configuration and provenance before copying source, preserves an existing destination, and retains available optional source identity when switching one entry to `@app`.
- npm and GitHub requirements remain distinct; package repository metadata does not add a second origin. Existing provenance-free registrations remain valid. Observable origin/manifest contradictions fail with recovery guidance.
- Disabling removes the entry from generated discovery. Dependency uninstallation, manual imports, local source, database contents, and provider data migration remain operator-owned decisions.

### Standalone harness coverage assessment

OMH-239 was expanded in its existing `.ai/guides/module-tool.md` owner to cover alias bindings, distinct npm/GitHub installation origins, duplicate enabled IDs, explicit binding replacement, and ejection provenance. The guide links exact installed installation, identity and ejection sources. Replacement requires resolving old-origin dependants/manual imports and successful generation/build while the old provider remains installed, followed by replacement and verification again. Failure-first owner and order-sensitive regression evidence was captured before the corresponding guidance changes. That checkpoint retained 239 cases, including 49 writable cases; the subsequent shared-spec alignment below expands it to 240/49.

### October 22 verification snapshot

Runner: local for focused regressions; isolated Linux for live standalone checks. Final CLI implementation source: `517a3b5397335041c574a241fb7e1f0838affa58`; the standalone harness fixes are still being verified separately.

- All 20 self-contained CLI integration cases passed, including the unchanged existing TC-INT-008 suite and file-directory/archive unknown-origin regressions in TC-INT-009.
- The six focused CLI suites passed 145 tests; CLI typecheck and build passed. Local file artifacts remain origin-unknown and cannot satisfy an npm-qualified requirement or replace an enabled binding without proven continuity before Yarn. Interrupted broad runs are not counted as successful gates.
- Fresh locally packed classic/empty/CRM/WMS presets at published head `8fd9fc54adb2063d8c6b540bc1700f5822835e3a` passed source/link/hash checks. Its controller passed all 239 deterministic cases. A separate diagnostic cohort completed 65 routing cases with 42 passes and 23 failures; it does not certify the full release suite or the subsequent uncommitted fixes.
- The preceding 27-file machine knowledge-change proof at `2b23c2e86` failed: 24 head commands passed and three stale tests/fixtures failed; all base commands failed as required. The subsequent exact-source 29-file pass is recorded below; no final combined-source release pass exists. Independent review of the CLI source found no remaining blocking finding, while harness fixes and their complete evidence remain open.
- Published predecessor `8fd9fc54adb2063d8c6b540bc1700f5822835e3a` has a failing unit-test job from stale harness assertions, whose updated policy/surface tests pass locally. All 15 integration shards passed on that exact predecessor. The required full live `harness:release` suite remains incomplete. Phase 4.3 stays unchecked until actual current-head results and final review are recorded. Formal author self-approval is not claimed.

### Shared specification alignment with #7125

The updated shared harness specification in #7125 adds production-readiness case OMH-240 and its emitted operational guide. The implementation branch incorporates that contract as 240 cases with the existing 49 writable cases, preserving the collision-policy implementation and its regressions. Production guidance does not change application runtime, database, HTTP API, or CLI defaults. Exact SQLite cache-output guards remain in force during release validation.

The earlier 239-case evidence above belongs to its recorded predecessor. Fresh packed-preset checks, the machine knowledge-change proof, live routing, the complete 240-case/49-writable release suite, and published-head CI must certify the combined source before phase 4.3 can close.

The first combined-source live qualification was stopped after 18 diagnostic cases because pinned external skills had been omitted during preparation (10 pass, 8 fail; no certification). Preparation is corrected and exact external directory hashes verified. Failed-read accounting and specification-index navigation are being repaired with failure-first coverage before a fresh combined machine proof and live release.

The reviewed refusal-accounting repair passes 191 runtime checks (178 existing and 13 new), with no skipped tests; typecheck passes. The source-only evaluator fixture repair passes 166 checks without dist, and root/workflow checks pass 21/21. Exact-path specification discovery has a genuine failing index regression and passes 3/3 after linking the shipped covering specification. These are focused checks pending the next committed combined machine and release proof.

Published-head CI at `2b23c2e86` passed lint, audits, Docker build, and multi-instance Documents validation; its unit job failed four create-app assertions. Three overlap the repaired machine assertions; the fourth legacy compatibility fixture now checks its legitimate writing closure and the existing 12 KiB root bound without changing any case cap. Both compatibility tests pass (OMH-057: 119,822 measured / 120,488 root-bound bytes against 122,880, leaving 2,392 bytes). The completed result is 14 of 15 integration shards passing; the remaining shard failed the existing portal oversized-stream upload test before an HTTP response. Its relevant source and test match main; no unrelated code change is made.

### Subsequent exact-source proof and current blockers

The actual 29-file machine proof at `88ab5a428d5069f04c9412f761d1e2dfbb294e41` passed with 29 genuine base failures, 29 head passes, and zero errors. The source-specific sanitized export is retained under `.ai/analysis/standalone-harness-knowledge-change-224cbccb8572-88ab5a428d50-historical.json`; its SHA256 is `6dc553adba21f2a7ed2f04e6135dd92c8a3de5e379b6ec50e0290142bc786b57`. Fresh four-preset packages verified all 15 external skill hashes and passed deterministic 240/240. Proper live qualification completed 39 cases with 29 passes and ten failures, preserved as failed evidence (summary SHA256 `dc0c09fc5af54d8b656a6895233e59c016842439221727dc05a8a5a535dc7d2a`).

Failure-first corrections address those ten failures without relaxing caps, write/decision oracles, hard read bans, or refusal limits. Exact-source unit checks remain distinct from fresh live certification. The new manifest must include the actual portal-fact denial/authorization regression as a thirtieth genuine focused file.

PR #7125 was merged externally; reviewed merge `7afa6513463e1dccb42fc30ce328521b05b8be84` carries main `0c886d0a14c02106ff2abc9728be36c04c5a2ccd` into this branch. The main events/core changes require rebuilding and packing those packages as well as CLI/create-app before the next immutable packed controllers. Current combined-source machine proof, packed/live qualification, complete 240/49 release, published-head CI, and final independent review remain outstanding. Phase 4.3 stays unchecked.

### Following 431b qualification

Exact published `431b41377d470724595113dd7aee3a353b6c8681` passed the actual 30-file machine proof (30 base failures, 30 head passes, zero errors); its sanitized checkpoint SHA256 is `f47f39415f56c5f71f8adc39d305572394d61790b23e954c20e297b9e1d469c6`. Four fresh proper presets and all exact skill/source hashes passed. Its proper live cohort completed 33/39 passes; failures remain OMH-081, 087, 097, 133, 221 and 223. The native writable 223 diagnostic also failed its unchanged fixed oracles. These outcomes are preserved and do not certify the subsequent corrections.

The next source wave fixes strict installed-source containment/accounting under native writable dependency links, preserves immutable-reference accounting in prompts, clarifies upfront index and outline selection, and corrects exact portal/framework fact access. Measured portal mandatory context fits the original ceiling, so that ceiling is preserved. Additive bounded projections expose already-existing override IDs and foundation provenance instead of requiring forbidden/private data. Focused tests pass, but fresh combined machine, packages, live/writable qualification, full 240/49 release and published-head CI remain required. Phase 4.3 remains unchecked.

OMH-223 additionally has a measured unavoidable 273,057-byte mandatory floor, above its original 262,144 total. Its complete source-only four-preset specification closure requires a universal 337,789 bytes. Only that case total becomes 339,968 (2,179 reserve), and its prompt-explicit generated reference index becomes required; all remaining limits and fixed oracles stay unchanged. The real old-cap regression fails before this calibration and passes afterward. The supported owner inventory derives 201 topics/44 owners/131 required/133 links. This source wave changes the bounded CLI facts renderer as well, so fresh CLI/core/create-app archives are required; the earlier CLI implementation range does not certify those changes.

### Exact 488965 checkpoint remains incomplete

Actual 30-file machine proof passes at clean committed `488965c822de7c5376b33e7c8490a5653ad6447b` without an overlay (30 base failures, 30 head passes, zero errors; sanitized SHA256 `36bf7c4ff6ce43cb414f664464bf9ceb2b023adf7714470ac81351fd3eb94e14`). Fresh package/preset hash proofs pass; full deterministic 240/240 passes on classic. Full-catalog reduced-preset probes fail only on independently confirmed inactive-module fact absence and remain recorded as failures. Actual fresh focused routing is 5/10 PASS; native writable 223 FAILS for missing owners, excess context/refusals and wrong spec reuse. These failures drive the next minimal owner corrections; the full release has not started at this source and phase 4.3 remains unchecked. The CLI-range report is `.ai/analysis/standalone-harness-refresh-d5d385e6b7e4-58f238a50eb1.md`.

The following owner corrections shipped as `fb968611a7631d9ab8cc560f4df4655698babcb3`: 205 topics/44 owners/131 required/133 links, roots11,229/11,225 bytes, library universal bound559,000/561,152. Explicit required planning refs remain active; activation-only reuse, compatibility mapping, engine-owned onboarding, receiving-app source reads and principal-scoped API adapter ownership are clarified. The two full affected CI fixture suites pass79/79 without production cap changes.

Exact fb9686 passes the actual 30-file machine proof with 30 base failures,30 head passes and zero errors (sanitized SHA256 `7ea088ab39b4c603589160d26dfb0d46cd7633a358fd7133b3fc0c97ab20ac7d`). Fresh CLI/create-app packages and four applicable presets pass source/pin/provenance verification; classic passes deterministic240/240. Fresh routing completes7/11; OMH-081,087,097,223 remain failed (summary SHA256 `628c82be8bc67ee6e631c2e97f8e697abc9349643456b2a417efdceb5941567d`). Native223 creates the correct new spec but fails required data/API owner reads,7/6 refusals,368,506/339,968 context and fixed-oracle checks (sanitized diagnostic SHA256 `3d3c8fae43fda2cadb078bc2310f6a888b49569ef5ac440daef1723ab9833a84`). Actual missing requirements, public identity-delivery gaps and lexical false positives are being corrected separately; no failed result is waived. The complete unchanged240-routing/49-writable/49-review release remains blocked. Current-head CI has started; formal external review also remains required. Phase4.3 stays open.

The following source wave corrects explicit planning/reference phase ownership, domain maps, workflow-state modeling, portal framework facts, public source-ID format delivery and fixed-classifier false positives. Source validation passes425CLI tests,82spec-oracle tests and123complete affected-source checks, plus typechecks, supported generation/check and deterministic240/240. Derived inventory208topics/45owners/131targets/133links; specification reserve2768bytes and library reserve2105bytes preserve existing ceilings. Actual new committed-source machine, fresh packages/presets, routing/native qualification, fullrelease and published-head CI remain pending; no earlier failed result is relabeled. Phase4.3 stays open.


### Actual 092dca checkpoint

Published `092dca1409bac4ef1eec8e3207a417eababf3c05` passes the actual clean 30-file machine proof (30 base failures,30 head passes,zero errors; sanitized SHA256 `a3a196833711d4b2afa5fc11cf7d2486936d42eadba33dbef02b62708937a1eb`) and fresh four-preset package/source/pin checks. Classic deterministic240/240 passes. Fresh routing completes9/11;087 and223 fail context/refusal limits (summary SHA256 `6f107199602b5728bbc913153f0fcbbb2085a913abd5f4abca1a5c2deb977870`). Native223 also fails: required owners read,14/6 refusals,400439/339968 bytes and incomplete fixed specification oracles (raw SHA256 `2bede539008c4b9595becc556ebf0ec5a04b62b6892f344e2361435aa68ef981`). Those results remain failed. The earlier specification reserve omitted a legitimate page/navigation branch and must be reproved including it. Source navigation and exact classifier corrections continue; fullrelease/current-head CI/external review remain required. Phase 4.3 stays unchecked.


### Following source-only planning correction

Upfront capability-map scoping, identity-first navigation and local-only source-label compaction preserve all exact hrefs/anchors/IDs and 76 package outputs. Source checks pass 426 CLI facts tests, 272 evaluator/spec-search tests,29 complete owner/closure tests and 24 inventory tests without skips, plus both package typechecks and budget/lesson checks. Supported inventory derives 211 topics/45 owners/131 targets/133 links. Complete223 context now includes required page/navigation: universal 337659/339968 leaves 2309 bytes; library 559023/561152 leaves 2129. Fixed navigation/table-classification bugs are corrected against the specification while preserving required identity families, phase/test syntax, minimum rows, substance and write/read bounds. Fresh clean committed-source machine/packed/live/native/fullrelease qualification and current-head CI remain pending. Phase 4.3 stays unchecked.


Planning-navigation source checkpoint: `58f238a50eb15499f91826fdbe28ea696f879a1a`. The metadata-only report rename preserves this actual CLI range end. Fresh combined qualification remains pending.
