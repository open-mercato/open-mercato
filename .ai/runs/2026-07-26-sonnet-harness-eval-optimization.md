# Sonnet Harness Evaluation Optimization Follow-up

## Goal

Optimize the standalone AI development harness so the complete current evaluation catalog passes with the Claude runner on the `sonnet` model selector and the Codex runner (`modelSelector: "default"`). The catalog started at 184 cases and is now 192 after adding complete-library, cache, queue, four field-tested generative regressions, and the combined CRM/library contract requested during this run.

Source doc: `.ai/specs/2026-07-24-standalone-ai-development-harness.md`
Depends on: #4483 (`feat/standalone-app-ai-harness`), stacked from its head `e6c38e0be`.
Sibling follow-up: #4528 (`feat/kimi-cli-runner-harness-evals`) adds a third runner from the same base.

## Scope

- Stack this follow-up on PR #4483 head `e6c38e0be` while keeping the configured PR base `develop`; #4483 must not be modified.
- Measure first: run the deterministic catalog gate, then the complete authenticated Claude/`sonnet` routing matrix, and record sanitized aggregate evidence only.
- Classify each measured failure, then remediate the **smallest shared knowledge owner** — the emitted `AGENTS.md` task router, `.ai/guides/*`, standalone skill `SKILL.md`/`references/*`, or the evaluator's shared prompt contract — never a runner-specific fork of shared guidance.
- Recalibrate `cases.json` expectations only where an expectation is genuinely over-specified against a correct alternative answer; record the justification per case.
- Keep any new tunable additive with defaults byte-identical to today's behavior, per `packages/create-app/AGENT-HARNESS.md` Part 2.
- Rerun the complete Codex routing matrix as the compatibility baseline after remediation.
- Exercise the writable/review lanes the host can safely support (this controller is Linux with attested Bubblewrap, which #4483 could not use on macOS) and report any lane that stays environment-blocked without weakening it.
- Update the governing spec and harness documentation with the measured evidence.
- Audit the standalone progressive guidance for data-integrity implementation: commands as the mutation boundary; transaction/atomic multi-write semantics; post-commit side effects; audit/undo/compensation; optimistic locking for CRUD and command actions; and clear-to-null behavior.
- Make encryption guidance actionable without routine source archaeology: canonical encryption maps and scoped decryption helpers (including `findWithDecryption`-style reads), redaction boundaries, and search/export/worker coverage.
- Audit indexing/search guidance, including `search.ts`/query-index contracts, post-write indexing or invalidation, deterministic convergence/reindex verification, and no arbitrary sleeps.
- Audit the AI framework, i18n, and UMES authoring surfaces: typed agents/tools and approval-gated mutations; locale ownership and generated registration; and stable injection spots/IDs plus widgets, fields, menus, component replacements, interceptors, guards, and response enrichers for new APIs/UIs.
- Make complete new modules visible in the main sidebar and add a failing-first single-shot book-library module evaluation. The generated plan must own registration/navigation, DataTable + CrudForm create/edit flows and add-book links, command writes with atomic transactions and undo, ACL/setup features, custom fields, search/indexing, UI i18n, encryption maps/scoped decryption, and an intentional UMES-capable API host.
- Extend the generated-code/code-review checklist for diffs touching standalone module elements (entities, commands, APIs, pages, navigation, widgets, search, ACL/setup, encryption). Derive any additional minimums from the installed `customers` module, require design-system alignment for rendered UI, and make the repo-local `om-auto-review-pr` override explicitly feed these rules into `om-code-review` and generated-code review.
- Default new editable entities/modules/backend UI to the complete CRUD path unless the brief explicitly excludes an operation: filtered/searchable DataTable list, linked create and edit/detail actions, CrudForm create/update/delete, custom-field round trips, and the corresponding scoped APIs/commands. Keep this rule compact in backend-UI progressive guidance.
- Preserve upstream `open-mercato/skills` review behavior and report formatting. Use its supported `reviewChecklist`/`CODE_REVIEW.md` extension mechanisms, do not ship a local `om-code-review` replacement, and keep the standalone `om-auto-review-pr` overlay to the minimum additive portability note needed.
- Verify create-mercato-app still exposes and runs the shared-skill installation/update flow used on the base branch (including the generated `npx skills`/installer-facing command where applicable). Ensure new apps can intentionally refresh to the current `open-mercato/skills` source while retaining ownership/provenance checks and deterministic pinned installs for harness release evidence.
- Document the framework-owned cache and queue paths without forcing agents back into source archaeology: cache key/scope/TTL ownership, explicit invalidation after committed writes, and durable queue registration, enqueue/worker boundaries, retries, idempotency, tenant context, and observable failure handling. Add generative routing cases for cache invalidation and queue-backed work for both supported models.
- Add or strengthen semantic catalog coverage for real gaps above. Preserve progressive disclosure and the fail-closed gates; modest per-case file/byte quota increases and limited WIP catalog compatibility changes are allowed only when both runner traces justify them and the final measurements disclose them.
- Merge Zielivia's field-tested OMH-188–191 cases without renumbering them, fix their shared oracle defect, and add OMH-192 for the combined Kimi/Codex CRM-library findings. Require trusted runtime scope, scalar cross-module linkage with snapshots, command-local atomic/undo behavior, concurrent checkout/idempotency, executable Jest coverage with explicit globals, and matching generated-code review checks.

## Non-goals

- No change to runtime modules, APIs, database schema, ACLs, events, widgets, or tenant behavior.
- No new runner: `sonnet` is already the Claude runner's shipped model selector.
- No weakening of any fail-closed gate — routing trace verification, write allowlists, containment/sandbox preflight, oracle integrity, generated-test attestation, review verdict rules, or secret redaction.
- No per-case runner fallback, mixed primary ownership, or model-specific branch inside shared guidance.
- No gratuitous edits to runner-enumeration lines or `release-matrix.json` `routing.runners` keys that #4528 must extend with `kimi`.
- No provider credentials, authentication stores, raw model transcripts, or local evaluation artifacts committed.

## Implementation Plan

### Phase 1: Reproducible measurement controller

1. Build a harness-equipped controller app from this branch and prove the deterministic 184-case gate passes.
2. Establish a reusable, sanitized sweep driver that runs a full routing matrix per runner and emits a per-case failure classification.

### Phase 2: Baseline measurement

1. Run the complete authenticated Claude/`sonnet` routing matrix and record the baseline pass rate and per-case violation classes.
2. Run a Codex control sample over the same cases to separate model-specific failures from harness defects that affect every runner.

### Phase 3: Evidence-driven remediation

1. Remediate shared-owner routing/authority defects surfaced by the sweep and rerun the affected plus mandatory cases.
2. Remediate the remaining declaration/observation discipline failures in the shared prompt contract and emitted router.
3. Recalibrate only genuinely over-specified catalog expectations, with a per-case justification, and prove the complete `sonnet` matrix.

### Phase 4: Compatibility baseline

1. Rerun the complete Codex routing matrix and fix any regression without forking shared guidance.
2. Exercise the writable/review lanes this Linux host supports and report every environment-blocked lane exactly.

### Phase 5: Delivery gates

1. Add regression coverage for every changed contract and run the targeted create-app/CLI suites.
2. Update the governing spec, `AGENT-HARNESS.md`, and operator documentation with measured evidence.
3. Run the configured repository validation gate, complete review/autofix, publish PR evidence, and hand off.

## Risks

- Live model evaluation is non-deterministic; a single passing sweep can hide a marginal case. Mitigation: rerun the cases touched by every remediation batch plus a fixed mandatory set, and report attempt/correction counts rather than a bare pass rate.
- Optimizing for one model can regress another. Mitigation: shared knowledge-owner edits only, a Codex control sample during tuning, and the complete Codex matrix before delivery.
- Recalibrating `cases.json` can silently hide a real defect. Mitigation: every expectation change carries a written justification naming the correct alternative answer it admits, and no change may remove a `required` route, skill, context path, or decision.
- #4483 is unmerged and #4528 is stacked from the same head. Mitigation: keep this branch on 4483's exact head, prefer shared-owner edits, avoid runner-enumeration churn, and re-check #4528 for convergence during implementation.
- The full writable/browser release gate needs trusted Bubblewrap and private loopback. Mitigation: do not weaken preflight; run every safely supported lane and report the exact remaining operator command for anything blocked.
- Provider cost/time for repeated 184-case sweeps is significant. Mitigation: batch execution, target reruns to affected plus mandatory cases, and keep full sweeps for baseline and final proof.

## Current Handoff (2026-07-27T01:10Z)

- Worktree: `/home/pkarw/Projects/mercato-development/.ai/tmp/om-auto-continue-pr/pr-4529-20260726-160846`; branch `feat/sonnet-harness-eval-optimization`; latest pushed implementation checkpoint `239bc4db1`. The persistent PR claim/cleanup trap is shell session `11319`; keep it alive until the work is actually complete.
- Current catalog: **187 routing cases / 40 writable-review cases**. Deterministic evaluation is **187/187**. The complete create-app suite after `2e99a347e` is **331 pass / 4 platform skips / 0 failures**. The emitted root is 12,105 bytes and the representative initial chains remain below Codex's fixed 32 KiB project-doc ceiling.
- Codex routing: the immutable `ec3ebd265` complete matrix was **168/187** in 3,311 seconds. OMH-185 passed; the 19 failures were six stale-tight context budgets, four compatibility expectation mismatches, three missing route/context selections, two subscriber-idempotency omissions, one undeclared relevant scaffold read, one broad catalog total-context overrun, one refused-read ceiling, and one process timeout. Commit `d7521f60c` remediates these without removing a required route, skill, decision, artifact, write, oracle, or review gate. Its focused cohort passed **18/19**, with only OMH-130 over-selecting `debugging` for a designed failure UI; after the compact reported-bug-versus-designed-error clarification, isolated OMH-130 passed. Every exact immutable failure therefore passes against the current emission, but a final immutable full 187-case Codex matrix is still required because source changed after the baseline.
- Sonnet routing: OMH-185/186/187 routing already passed, but the provider exhausted its weekly capacity. Six targeted cases ended in quota errors (OMH-173/176/177/178/181/184) and OMH-043 timed out. Resume these seven and then the complete Sonnet matrix after reset; never substitute Codex evidence.
- Skills install/update parity is complete in `4e9ed542c`: `yarn agentic:init` uses the generated Node installer because it adds reviewed-ref/content hashes, ownership/provenance, atomic rollback, local-overlay preservation, and cross-platform behavior around the underlying skills source. `npx skills` remains the explicit upstream-facing discovery/update route rather than the reproducible release install. The rationale is posted in the PR comments.
- Integrity/encryption/search/AI/i18n/UMES, complete default CRUD/filtering, main-sidebar navigation, customers-derived code-review/design-system enforcement, cache invalidation, and queue/worker guidance/cases are all represented in Scope and the accepted-requirement sections below. `om-code-review` remains external/upstream; the local `om-auto-review-pr` overlay only adds the configured checklist pointer so upstream verdict/output/emoji rules are retained.
- OMH-185 writable progression: r9 proved core module procedures had to be mandatory; r10 then reduced failures to validator placement, custom-field reset/search shape, and exact UI/command signatures. r11 passed every semantic gate except a concrete scoped-decryption call. r12 passed every semantic gate except `module.table`; inspection proved its qualified stable IDs `library.books.edit`/`library.books.delete` were correct, so `2051fbb43` narrowly admits exact or qualified edit/delete IDs. r12's remaining compile diagnostics are limited to nonexistent DataTable `apiPath`, invalid CrudField `name`, helper typing through `any`, and readonly `cacheAliases`; all are now explicitly documented. Trusted latest report: controller `.ai/harness/results/2026-07-26T21-05-46-138Z-codex-OMH-185.json`.
- Writable r13 on fresh target `/tmp/omh185-writable-r13-BJXNA2` ran 441,972 ms. Every semantic check except `module.activation` passed; the generated activation was actually the template-canonical `enabledModules.push({ id: 'library', from: '@app' })`, which the oracle did not collect. Typecheck exposed exact missing signatures: DataTable `isLoading`; no CrudForm `mapServerError` prop; destructured `resolveTranslations`; void-return `withAtomicFlush` phases; required create timestamps/full undo snapshots; and no `metadata` on `SearchResultPresenter`. Commit `fc5e22272` adds failing-first regression coverage, accepts the canonical push activation, and documents those exact current contracts. Generated review was correctly skipped because the writable gate failed. A fresh r14 target is required; never reuse r13 as passing evidence.
- Writable r14 on fresh target `/tmp/omh185-writable-r14-n4kzXI` ran 591,089 ms and passed **every semantic module oracle**. Its only failed gate was target typecheck, reduced to three exact signatures: manual `OpenApiRouteDoc` must nest uppercase methods under `methods`; CrudForm exports `CrudField`, not `CrudFormField`; and DataTable paging belongs in `pagination={{ page, pageSize, total, totalPages, onPageChange, ... }}` rather than top-level props. Commit `24f1dd588` adds failing-first guidance contracts and pins all three current signatures; the complete create-app suite passes 330/330 runnable tests. Generated review was correctly skipped because typecheck failed. A fresh r15 target is required; never reuse r14 as passing evidence.
- Writable r15 on fresh target `/tmp/omh185-writable-r15-uqEQLz` ran 453,663 ms. It retained the complete module behavior and reduced the trusted failures to two exact contracts: `acl.ts` declared the correct `library.books.view/manage` IDs under `libraryFeatures` instead of the canonical named `features` export, and CrudForm `onDelete` incorrectly accepted form values although its installed signature is `() => void | Promise<void>`. Commit `38653fe07` adds failing-first assertions and pins `export const features` plus a zero-argument delete callback that captures the loaded optimistic-lock version. The focused contracts pass 12/12 and the complete create-app suite remains 330/330 runnable tests. Generated review was correctly skipped because r15 did not clear the writable gate. A fresh r16 target is required; never reuse r15 as passing evidence.
- Writable r16 on fresh target `/tmp/omh185-writable-r16-EJsEVX` ran 386,589 ms. It selected every mandatory specialist skill/reference and fixed r15's ACL/delete signatures, but exposed three remaining source-archaeology traps: UI messages were placed in `locales/en.json` instead of generated `i18n/en.json`; encryption imported a nonexistent `lib/encryption/types` and used string fields instead of `ModuleEncryptionMap` field-rule objects; and update/delete commands left empty undo stubs, omitting `buildCustomFieldResetMap`. Commit `3f6527334` adds failing-first assertions and pins the exact `@open-mercato/shared/modules/encryption` map shape, generated locale path, and prohibition on stub undo. Focused contracts pass 12/12 and the complete create-app suite remains 330/330 runnable tests. Generated review was correctly skipped because r16 did not clear the writable gate. A fresh r17 target is required; never reuse r16 as passing evidence.
- Writable r17 on fresh target `/tmp/omh185-writable-r17-DNW29W` ran 450,396 ms and fixed r16's i18n path, encryption type/map shape, and non-empty create/update/delete undo. The remaining semantic miss was exact custom-field restoration: update undo used `Object.assign` but never called `buildCustomFieldResetMap`, so removed/cleared keys were not handled by the canonical reset contract. Its only compile diagnostic was nonexistent CrudForm `onCancel`; installed CrudForm uses `cancelHref`. Commit `4f01041ec` adds failing-first assertions and pins both exact requirements. Focused contracts pass 12/12 and the complete create-app suite remains 330/330 runnable tests. Generated review was correctly skipped because r17 did not clear the writable gate. A fresh r18 target is required; never reuse r17 as passing evidence.
- Writable r18 on fresh target `/tmp/omh185-writable-r18-MiTxkd` ran 536,157 ms and **passed the complete trusted writable gate**, including all customers-level semantic oracles and the pre-generation target typecheck. Its isolated release validation then passed `yarn generate` and `yarn lint` but failed post-generation `yarn typecheck` and `yarn build`: generated registry code requires paired named/default exports, while r18 emitted only named `features`, `customEntities`, and `defaultEncryptionMaps`. Commit `6047ee40b` adds failing-first assertions and pins `features` + default, `entities` + default (with `id`, not `customEntities`/`entityId`), and `defaultEncryptionMaps` + default. Focused contracts pass 12/12 and the complete create-app suite remains 330/330 runnable tests. No validation attestation or generated review was created from the red command set. A fresh r19 target is required; never reuse r18 as full release evidence.
- Writable r19 on fresh target `/tmp/omh185-writable-r19-ksnmT1` ran 271,614 ms and produced only one trusted violation: `CrudField` was incorrectly parameterized as `CrudField<BookValues>[]`, but the installed type is non-generic (only `CrudForm<BookValues>` accepts the value type). Commit `c0aed93bd` adds regression assertions and pins `const fields: CrudField[]`. Focused contracts pass 12/12 and the complete create-app suite remains 330/330 runnable tests. Generated review was correctly skipped because r19 did not clear writable. A fresh r20 target is required; never reuse r19 as passing evidence.
- Writable r20 on fresh target `/tmp/omh185-writable-r20-rQt00J` ran 377,536 ms and produced only one trusted violation: while trying to make decryption explicit, it inserted unsupported `findAndCount: findAndCountWithDecryption` into `makeCrudRoute.list`. Commit `ab2e969e3` pins that `entityId` + `fields` make the factory QueryEngine own list decryption and that `list` has no `findAndCount` override; direct detail/export/search/worker/CLI reads still require concrete scoped decryption-helper calls. Focused contracts pass 12/12 and the complete create-app suite remains 330/330 runnable tests. Generated review was correctly skipped because r20 did not clear writable. A fresh r21 target is required; never reuse r20 as passing evidence.
- Writable r21 on fresh target `/tmp/omh185-writable-r21-njTCRi` ran 474,293 ms and **passed the complete trusted writable gate**. Its isolated release validation passed `yarn generate` and `yarn lint`, but post-generation typecheck/build revealed that the model rewrote the pre-existing explicit module array into computed `.map` spreads. The static generator therefore lost the `directory` entry and broke the shipped example module; this was a missing trusted-oracle preservation check, not a library-module signature. Commit `2e99a347e` strengthens `module.activation` to require statically discoverable baseline `directory`/`example` entries plus the new `library` entry and adds a regression proving computed-spread rewrites fail. Targeted oracle tests pass 7/7 and the expanded complete create-app suite passes 331/331 runnable tests. No validation attestation or generated review was created from the red command set. A fresh r22 target is required; never reuse r21 as full release evidence.
- Writable r22 on fresh target `/tmp/omh185-writable-r22-EFDtLb` ran 517,973 ms and preserved the explicit baseline registry. Its only trusted failures were two identical compile errors in create/update undo: nullable `logEntry.resourceId` was passed to a finder requiring a string. Commit `239bc4db1` pins storing the stable record ID inside the undo payload (or explicitly guarding `resourceId`) before scoped lookup. Focused contracts pass 12/12 and the complete create-app suite remains 331/331 runnable tests. Generated review was correctly skipped because r22 did not clear writable. A fresh r23 target is required; never reuse r22 as passing evidence.
- Commits `b03328a98`, `935d37f85`, `3f69c4155`, and `2051fbb43` encode r9-r12 evidence in the smallest owners: mandatory complete-module references; exact validators/commands/undo/locking/effects/search/events/UI signatures; concrete decryption calls; runtime DI/result/audit typing; and current DataTable/CrudForm props. The only oracle recalibration accepts qualified stable action IDs as a correct alternative; no artifact, routing, scope, encryption, atomicity, undo, CRUD, review, or typecheck requirement was removed.
- Controller: `/tmp/claude-1000/-home-pkarw-Projects-mercato-development/10ffb39d-d892-401a-99fd-230ea96a0892/scratchpad/controller`; refresh with `bash ../reemit.sh`. Its `node_modules/@open-mercato` is deliberately overlaid with dereferenced current-worktree packages (npm copy retained at `node_modules/@open-mercato.npm-backup`) and it has a clean generated baseline. When cloning a writable target, exclude `.env`, `.git`, build/results and `.pnp.*`, include `.yarn` plus `.mercato/generated`, then symlink the protected controller `node_modules`.
- Next: re-emit `239bc4db1`, run fresh OMH-185 writable r23, its four target commands, and mandatory generated-code review if green; then run the final immutable Codex 187 routing matrix and remaining repository gates. Finish the missing/full Sonnet matrices after provider reset. An accidental `sweep.mjs --help` invocation started its default Claude lane because the private helper has no help mode; it was stopped, its orphan evaluators were killed, and none of those stale-controller partial artifacts may be used.

## Clean Immutable Pre-Expansion Baseline (184 cases)

These two sweeps used one unchanged emitted controller and exactly one process per provider lane. They predate OMH-185/186/187 and the expanded integrity/shared-skill/cache/queue batches, so they are a classification baseline—not a final 187-case result.

| Runner | Result | Failed case IDs | Violation classes |
|---|---:|---|---|
| Codex/default | **164/184** | 030, 034, 048, 058, 072, 110, 114, 127, 131, 134, 137, 145, 147, 153, 154, 165, 169, 172, 175, 182 | missing context/observation 11+11; unexpected context 6; missing skill 5; missing route 3; file budget 3; byte budget 3; unexpected route 1; no reads 1; process failure 1 |
| Claude/sonnet | **134/184** | 028, 030, 036, 043, 046, 056, 057, 058, 060, 063, 070, 078, 087, 092, 097, 102, 105, 107, 109, 110, 113, 115, 116, 120, 122, 132, 134, 138, 139, 141, 144, 145, 146, 147, 149, 150, 152, 153, 154, 158, 160, 166, 172, 173, 175, 176, 177, 178, 181, 184 | missing context/observation 56+56; missing skill 31; missing route 21; missing decision 7; byte budget 4; file budget 3; unexpected route 1 |

The dominant Sonnet issue is incomplete route/skill/context declaration; Codex has a smaller mixed set of missing and over-selected context plus three file/byte quota outliers and one timed-out no-read process. Recalibration or quota changes remain case-specific and require trace review.

## Resume Status (2026-07-26T16:35Z)

### ⚠️ First, retract the numbers in my previous comment

The matrix figures in the comment immediately above ("Sonnet 43/49 · Codex 59/64", "134 of 184") are **not trustworthy and should be ignored**. I found the cause while reconciling them: I launched a second pair of full matrices without killing the first pair, so **four full sweeps were running concurrently**, all writing into the same results directory, and the controller was re-emitted while they were in flight. The per-case results therefore cannot be attributed to a single harness version. That is my methodology error, not a harness fault.

All sweeps are now stopped and the process table is clean. **No full 184-case post-fix pass rate has been established for either runner.** Everything below separates what is verified from what is not.

### ✅ Verified

| Check | Result |
|---|---|
| Deterministic 184-case catalog gate | **184/184**, re-verified after every re-emission |
| `create-mercato-app` test suite | **318 tests: 314 pass, 4 skipped, 0 failed** (base had 3 failing) |
| `yarn typecheck` + `yarn lint` | pass |
| Pre-PR baseline, Claude/`sonnet` | **0 / 184** — no reachable read tool |
| Pre-PR baseline, Codex/`default` | **0 / 184** — `--disable skill_search` unknown to codex-cli 0.144.6 |
| Sonnet after adapter fix, before router work | **96 / 184** (clean single sweep) |
| Hardest-18 targeted set, clean single runs | **Codex 16/18**, **Sonnet 11/18** |

The hardest-18 set is the accumulated failure list, so it is a deliberately pessimistic sample — not representative of the full catalog.

### ❌ Not established

- A full 184-case pass rate for either runner on the final harness. This is the one remaining measurement, and it needs **one** pair of sweeps with nothing else running.

### What was actually fixed (all pushed, 27 commits)

**Both runner lanes were dead on current CLIs** — so #4483's "Codex 184/184" does not reproduce:

- **Claude**: `--tools` takes only *built-in* names, so `--tools mcp__harness__read` gave zero tools **and** removed `ToolSearch`, the only route to MCP tools under Claude Code 2.1.220's deferred discovery; `--safe-mode` drops `--mcp-config` servers; `plan` mode returns a plan instead of reading.
- **Codex**: `--disable skill_search` is a hard error on a CLI where that feature was retired. Now probes `codex features list` and denies only known features; a failed probe never *shrinks* the denial set.
- Both slipped through because **the tests drive a fake runner that asserts exactly the flags the code passes** — a self-confirming contract.

**Shared trace accounting**: reads the fail-closed MCP server *refused* were scored as loaded content. Now recorded as `refusedContextReads` for both runner shapes (Claude `is_error`+`tool_use_id`, Codex `status:"failed"` on an `mcp_tool_call`). No gate weakened — a successful out-of-allowlist read, a forbidden-path attempt, and refused enumeration above a bound all still fail, each pinned by a test.

**Router defects**, each traced to a specific sentence rather than to model weakness: additive `backend-ui` (with the authoring-vs-configuring line, refined so gating an *app-injected* surface counts while hiding an installed page does not); additive ownership (`umes` when changing an installed module's records/commands/events/pages/agents/tools); `architecture` on ownership outlines; request-driven `testing`; extension entities as UMES work units; renderers as rendered surfaces; provider settings/health → `integrations` facts; symptom-derived debugging areas; and a matching stop rule (guide > skill > references) to offset the additive push.

**Three of those were regressions I introduced** while freeing instruction-budget bytes, and are worth knowing about: deleting `Match every work-unit row` (which is what sends a model to Axis 2 at all), telling models to declare every path they "opened" (which they read as including refused attempts), and dropping "editable adds `backend-ui`".

**Three Linux-lane failures #4483 left red** are fixed: a genuine sandbox-composition defect (a runtime read root containing a writable root re-mounted it read-only, so every write hit `EROFS`), a platform-coupled preflight assertion, and a Chromium host prerequisite now behind a capability guard (`libnspr4.so` is missing on this box — it fails outside any sandbox too; `npx playwright install-deps` fixes it).

### Known issue I could not fix from the router

`.ai/guides/upstream/BACKWARD_COMPATIBILITY.md` access is a **binary** by deterministic validator — required or excluded, never `allowedExtra` (I tried widening it and the gate correctly rejected it). Yet OMH-057 *requires* it for a "preserve the seeded … export seam" prompt while OMH-045/054/060/061/070 *forbid* it on identical wording. No router rule satisfies both. Mitigated harness-side: a refused path is now treated as inapplicable to that case instead of being reported as an unresolved blocker. Resolving the inconsistency itself is a catalog decision.

### Resume procedure

1. Worktree: `git worktree add <dir> origin/feat/sonnet-harness-eval-optimization`, then `yarn install && yarn build:packages && yarn generate && yarn build:packages`.
2. Controller: scaffold through the real built entry point, never by copying and substituting the template manually: `node packages/create-app/dist/index.js <temp-parent>/controller --agents claude-code,codex,cursor --no-shell`. On macOS put `<temp-parent>` under `/private/tmp` because `/tmp` resolves through a symlink; on Linux use `mktemp -d /tmp/omh-controller-XXXXXX`. To refresh an existing controller, run its real `yarn mercato agentic:init --force` path. Install its dependencies, then confirm `node scripts/evaluate-agent-harness.mjs --all` → 187/187.
3. **Run exactly one sweep per runner and confirm nothing else is running first** (`pgrep -f sweep.mjs`). Concurrent runs across providers are fine; concurrent runs of the *same* lane are what corrupted the last measurement.
4. Re-run the union of failures, fix in the smallest shared owner, re-emit, repeat.

The measurement driver and per-case classifier live in the session scratchpad and are deliberately **not** committed — the shipped operator entry points remain `yarn harness:validate` and `yarn harness:release`.

### Judgement call left open

After the defects above, the residual failures concentrate in `debugging` cases whose budget permits **five** files — exactly their required set, zero tolerance for one extra read. Across runs those cases moved between different violations under monotonically clearer guidance, which is variance rather than a missing rule. `AGENT-HARNESS.md` Part 2 identifies capability-scaled retry as the biggest lever for a weaker model; I have **not** taken it, because retrying an assertion failure changes what the metric means and should be your explicit decision. `attempts` and `corrections` are already recorded per case so a first-pass and a corrected rate stay distinguishable.

Part 3 of `AGENT-HARNESS.md` (added in this PR) records all of the above as guidance for whoever tunes the next runner.

### Expanded requirements accepted on resume (2026-07-26T16:12Z)

The resumed run additionally owns a budget-aware documentation and evaluation audit for:

- transaction boundaries, atomic multi-write updates, command undo/compensation and post-commit side effects;
- CRUD and command optimistic locks, including raw UI update/delete conflict handling;
- encryption maps, scoped `findWithDecryption`-style reads, redaction, and index/export/worker safety;
- data indexing, search/query-index ownership, deterministic convergence and reindex verification;
- typed AI agents/tools/orchestrators, approval-gated mutations, attachments/artifacts, and generated registration;
- i18n ownership, generated locale discovery, no hard-coded user-facing copy, and validation;
- UMES-ready API/UI design with stable injection identifiers and the applicable widget/menu/field/component/interceptor/guard/enricher contracts.

Implementation rule: keep the root router compact, put actionable contracts in the smallest progressive guide/skill reference or generated fact owner, and add a failing semantic case before every new rule. Completion requires clean, attributable Sonnet and Codex sweeps against one immutable emitted controller version; quota changes must be minimal and reported separately from routing fixes. Progress is committed/pushed and mirrored to PR comments after each coherent batch.

### Expanded-guidance checkpoint (2026-07-26T16:55Z)

- Added a failing-first contract test before editing owners: data/integrity and search/host assertions failed while the existing AI and i18n assertions already passed.
- Pinned the exact scoped read surface: `findWithDecryption`, `findOneWithDecryption`, and `findAndCountWithDecryption` from `@open-mercato/shared/lib/encryption/find`. The query `where` owns tenant/org authorization; the fifth argument owns decryption-key scope. Encrypted values stay out of search/vector/index paths except an explicitly approved hash-only sibling for equality.
- Pinned `withAtomicFlush(..., { transaction: true })`, same-`EntityManager` atomicity, command undo via `extractUndoPayload`, post-commit/compensated side effects, and command-level optimistic locking via `enforceCommandOptimisticLock`.
- Expanded the progressive search row with `fieldPolicy`, CRUD `indexer`, bulk reindex, `checksumSource`, `formatResult`, and deterministic convergence. New CRUD API/UI hosts now explicitly publish aligned colon-form enricher/entity IDs and stable DataTable/widget action and row-action IDs.
- Kept AI and i18n owners unchanged because their existing progressive references already pin typed discovered files, `prepareMutation` approval before command writes, optimistic locking, generation, `i18n/<locale>.json`, and the distinct `translations.ts` entity-field surface.
- Focused checks: the new contract test first failed 2/5, then passed 5/5 after the owner edits; combined instruction-budget and guidance suite passed 10/10. No root-router, evaluator, case expectation, or quota change was needed for this batch.

### Book-library one-shot requirement accepted (2026-07-26T17:00Z)

The expanded catalog must include a failing-first, single-shot request to create a complete app-owned book-library module. Its required decision contract will keep smaller models from stopping at entity/API scaffolding:

- register the module and generated discovery surfaces, add a localized main-sidebar navigation entry, and expose list/create/edit routes with an obvious add-book action;
- build the list with DataTable and the create/edit flow with CrudForm, including custom-field render/read/save/reload/clear behavior;
- declare ACL features/default grants, validate tenant/org scope, and route all writes through commands with audit logs, optimistic locking, atomic multi-phase flushes, undo, and post-commit event/cache/index effects;
- declare encryption maps, use scoped framework decryption reads, exclude encrypted values from unsafe indexes, and provide a deterministic search/reindex contract;
- publish aligned, stable colon-form entity/host IDs for intentional API enrichment and UI injection spots so later UMES widgets/interceptors/guards can extend the module;
- own all visible copy in module `i18n/<locale>.json`, run generation, and prove the smallest structural/behavioral checks.

Implementation order: add the semantic/writable case and demonstrate its failure against the existing harness, remediate the smallest progressive owners, then run it against both Sonnet and Codex before the expanded full matrices. Any case-count, context-quota, or compatibility change must be recorded with the exact justification.

### Module-review enforcement accepted (2026-07-26T17:06Z)

- Analyze representative installed `customers` entity/validator/command/CRUD route/list/create/edit/page-metadata/search/encryption/ACL/setup patterns before finalizing the minimum checklist; copy contracts, not package source.
- Add a focused review checklist that activates when a diff touches `src/modules/**` module elements. It must check complete registration/discovery, main-sidebar navigation for a user-facing module, scope/ACL, validation/OpenAPI, commands/undo/atomicity/locking, encryption/decryption, search convergence, CrudForm/DataTable/custom-field round trips, i18n, UMES host stability, generation, and tests.
- Rendered UI diffs must additionally satisfy the shared design-system primitives/tokens, accessibility, loading/empty/error/conflict states, responsive behavior, and client-boundary/performance rules.
- The standalone `.ai/skills/om-auto-review-pr/SKILL.md` override must explicitly require the external `om-code-review` workflow plus the local module checklist. The disposable generated-code policy must load the same checklist for relevant generated sources and include routed backend/design-system references.
- Add regression tests proving review configuration/skills/policy cannot silently stop applying these rules; then exercise the generated review lane for the complete-module case.

### OMH-185 failing-first infrastructure checkpoint (2026-07-26T17:18Z)

- The pre-owner regression suite failed exactly as intended: catalog coverage was still 184 instead of 185 and the standalone review config had no module checklist. No guidance was changed to make the case pass before this evidence was captured.
- Added OMH-185 as a high-risk writable one-shot plus mandatory portability and generated-code-review assignment. The release contract is now 185 routing cases and 40 writable/review cases.
- Added a disposable incomplete-library fixture and a fixed `oracle.module.complete` AST/artifact gate derived from the installed `customers` reference. A skeleton cannot pass: the gate requires activation, sidebar metadata, scoped entity/migration/validators, ACL/setup, CRUD+OpenAPI/indexer/enricher, atomic locked commands and symmetric custom-field undo, encryption/decryption, search policy/presentation, DataTable/CrudForm/custom fields, i18n/design-system policy, tests, and target typecheck.
- Added `.ai/review-checklist.md`, wired it through `reviewChecklist`, made the repo-local `om-auto-review-pr` override explicitly require it through `om-code-review`, and bundled it into every isolated generated-code review. The checklist activates for module elements and adds routed design-system review for UI.
- Focused catalog/evaluator/oracle/review regression suite: 90/90 passed after adding the case infrastructure. The case was then used to pin the smallest missing backend-UI full-CRUD default; the expanded focused suite passes 96/96. Live OMH-185 routing/writable/review evidence remains required.

### Full-CRUD and upstream-review compatibility accepted (2026-07-26T17:21Z)

- For a new editable entity or module surface, absence of an explicit exclusion means list/create/view-or-edit/delete are all required. The list owns filters/search and obvious localized links/actions to add and edit records; forms own create/update/delete, custom-field save/reload/clear, optimistic conflicts, and complete states.
- Put the compact authoring rule in backend-UI progressive guidance and enforce it in OMH-185 plus the customers-derived review checklist. Do not grow the root router for implementation detail.
- Keep `.ai/review-checklist.md` as the upstream-supported config extension consumed by `om-code-review`. Do not add a standalone `.ai/skills/om-code-review` override. Trim the repo-local `om-auto-review-pr` overlay so it only confirms that the external workflow remains authoritative and its configured checklist is additive; this preserves upstream output/emoji templates and future rules.
- Provider continuation: if Claude/Sonnet reports token or quota exhaustion, record the exact completed/failed/remaining case IDs and sanitized provider error, stop that lane without changing its expectations, and continue deterministic, Codex, writable-oracle, generated-review, documentation, and repository-gate work. Resume Sonnet when capacity returns; a Codex pass never substitutes for the required Sonnet pass.
- Review compatibility implementation uses only the upstream-supported config hook (`reviewChecklist: .ai/review-checklist.md`) plus the existing standalone `om-auto-review-pr` portability overlay. No local `om-code-review` override was added. The overlay now defers output/verdict/emoji templates to the external skill and adds one concise checklist pointer.

### Shared-skill bootstrap/update audit accepted (2026-07-26T17:27Z)

Compare the current branch with `origin/develop` and trace the generated app from package scripts through `agentic:init` and `scripts/install-skills.{mjs,sh}`. Confirm that normal setup installs the declared shared collection and that an explicit update path can refresh to the current `open-mercato/skills` source without discarding repo-local overlays. Keep pinned ref/content hashes and the ownership ledger for reproducible harness review; do not silently turn a release run into an unpinned network fetch. Add a regression test and document the operator-visible command if the current flow is hidden or incomplete.

### Cache/invalidation and queue guidance accepted (2026-07-26T17:32Z)

- Add concise progressive guidance for framework cache access, scoped keys and TTLs, and commit-aware invalidation. Mutation handlers must never publish invalidation before the transaction commits; undo/compensation must invalidate the same affected scopes.
- Add concise progressive guidance for durable queued work: registered queue/job ownership, validated serializable payloads containing tenant/org context rather than ambient request state, enqueue-after-commit semantics, idempotency/deduplication, bounded retries/backoff, observable terminal failure, and command/service reuse in workers.
- Add failing-first generative cases with exact route/skill/context expectations and semantic decisions for cache invalidation and queued jobs. Exercise them with both `sonnet` and Codex, and fold applicable cache/queue checks into the complete-module review checklist without making every module use infrastructure it does not need.

### Expanded-case first live proof (2026-07-26T20:25Z)

- OMH-186 cache invalidation: Codex pass, Sonnet pass.
- OMH-187 durable queue/worker: Codex pass, Sonnet pass.
- OMH-185 complete library: Codex pass. Sonnet selected every required route, skill, and semantic decision, but correctly skipped `om-system-extension/references/read-write-roundtrip.md`; that reference explicitly owns an app field/action added to an installed host, while OMH-185 creates an app-owned API/UI host for future extensions. Reclassified only this path from required to allowed-extra. The required `umes` route, `om-system-extension` skill, extension guide, stable host decisions, and writable oracle remain unchanged.

### First shared remediation batch (2026-07-26T20:38Z)

- Added a runner-neutral final routing audit against every Axis 1 route, Axis 2 work unit, module-fact mapping, and decision label. It reinforces route/skill/context symmetry without revealing case expectations or retrying assertion failures.
- Clarified existing rendered-surface triggers (component replacement/wrapping/prop transforms, menu edits, visible feedback) and added compact workflow, AI-assistant, and query-index fact mappings while keeping the emitted root and representative initial chains inside the fixed Codex byte ceilings.
- Recalibrated OMH-134 to require UMES only: hiding an installed page/menu is explicitly a supported override rather than authored UI. Backend UI remains allowed when the implementation truly authors a surface. OMH-138/147 now permit defensible additive module-data selection.
- Made compatibility context required where the prompt/root contract actually preserves or adds public surfaces (OMH-072/131/169), and allowed the directly relevant optional facts Codex observed for OMH-048/110/131.
- Increased only six initial-context quotas to cover clean observed selections: OMH-144 `9/49152→12/65536`, OMH-145 `7/40960→11/61440`, OMH-150 `6/40960→8/49152`, OMH-153 bytes `57344→61440`, OMH-154 `6/40960→8/53248`, and OMH-182 files `6→8`. No total-context, safety, write, oracle, or review limit changed.
- Focused deterministic catalog checks pass 187/187; the full affected two-model rerun is next.

### Provider-capacity handoff (2026-07-26T20:55Z)

- The immutable targeted Codex rerun improved the historical failure set from 0/20 to **17/20**; residuals are OMH-131 (defensible extra `debugging`), OMH-154 (604-byte initial-context overrun), and OMH-172 (UI bug route/guide selected, design skill omitted).
- The immutable targeted Sonnet rerun completed all 50 requested historical failures: **23 pass, 20 actionable routing failures, 6 provider-quota terminations, 1 timeout**. The six quota-terminated IDs are exactly OMH-173, OMH-176, OMH-177, OMH-178, OMH-181, and OMH-184; each returned sanitized HTTP 429 evidence: `You've hit your weekly limit · resets 10am (UTC)`. OMH-043 separately hit the harness timeout.
- No Sonnet cases remain unattempted in that targeted set, but the six quota IDs and OMH-043 have no usable routing verdict from this run. The final complete 187-case Sonnet matrix and those seven targeted proofs remain pending provider reset.
- Continue now with trace-driven shared/catalog remediation, complete Codex, deterministic, writable OMH-185, generated-code review, and repository gates. Do not rerun Sonnet until capacity returns; Codex evidence never substitutes for it.

### Second shared remediation batch (2026-07-26T21:05Z)

- Tightened route/skill symmetry without assertion feedback: an opened task-matching skill counts as invoked; an opened routed guide forces its route; decision labels are audited one by one against both task and loaded instructions.
- Clarified request-driven testing (`test`/`prove`/app-exercising `verify`), browser session/bootstrap UI, public-ID stability, and explicit “inspect exact installed contracts first” routing.
- Kept important semantic contracts (testing/E2E, workflow facts, BC, exact money, OAuth reliability) required. Narrowly removed `tenant-cache-tags` from OMH-152 because the tax-service brief does not request caching, made provider-authoring and UI-design skills optional for testing-only OMH-166 and bugfix-only OMH-172/175, and made OMH-120's sales/catalog fact choice optional because both installed ownership paths are defensible.
- Added measured headroom for OMH-154 (`53248→55296` bytes), OMH-160 (`5/40960→9/53248`), and the comprehensive OMH-087 audit (`81920→90112`). The catalog-wide initial-context ceiling moved by 10% (`81920→90112`) solely to admit OMH-087's observed 83753-byte multi-surface audit; total-context/safety/write/oracle/review ceilings are unchanged.
- Focused evaluator/review/catalog and instruction-budget suite: 75/75 pass; deterministic catalog remains 187/187.

### Complete Codex calibration matrix (2026-07-26T18:41Z)

- One immutable `865fea060` controller completed **163/187** in 2450 seconds. Sanitized aggregate: `/tmp/om-sweep-GpriKo/final187-codex.json`.
- Exact failures: OMH-043, 058, 074, 078, 082, 086, 087, 088, 089, 090, 102, 104, 110, 117, 127, 132, 139, 140, 148, 150, 154, 167, 178, 184.
- Case-local quota calibration, with global total/safety/write/oracle/review limits unchanged: OMH-043 initial bytes `49152→53248`; OMH-086/090 initial files `6→7`; OMH-088 initial bytes `65536→73728`; OMH-148 `8/49152→10/61440`; OMH-178 initial files `5→6`. OMH-150 was intentionally expanded from a narrow adapter case to the complete requested payment surface—backend UI, UMES, checkout/webhook/BC facts, and corresponding case-local `12/73728/163840` bounds.
- Corrected expectation gaps: session-bootstrap UI design is optional when no rendered surface is authored (058); facts/BC paths explicitly required by the root contract are admitted (074/082/088/089/104/132); explicit security/invariant/convergence work may add debugging (102/110/127); matched one-shot route keys are binding so installed-module scalar links cannot drop UMES (078); multi-stage state that survives restarts is distinguished from a one-step schedule (140); the mechanism-choice helper is optional for installed customization analysis (178).
- Strengthened output discipline so `selectedContext` is exactly the successful-read intersection; refused paths cannot be copied into final context (104/117/139). OMH-154 and OMH-167 remain clean missed-decision rerun candidates. OMH-087 and OMH-184 are isolated runner/tool-discovery failures with no trace and must rerun; no containment rule changed for them.
- Customers-derived review was tightened in `7f7965a16`: connected list/create/view-or-edit/delete, server filter/search, guarded table actions, and conditional installed-AI-framework contracts are now explicit while upstream `om-code-review` output/verdict behavior remains authoritative. Focused surface/guidance tests pass 20/20 after the full-matrix remediation batch.


## Progress

PR: #4529

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Reproducible measurement controller

- [x] 1.1 Build the harness controller app and prove the deterministic gate — 184/184 deterministic on a Linux controller scaffolded from this branch
- [x] 1.2 Add the sanitized full-matrix sweep driver and failure classifier — local driver + classifier kept out of the repo; shipped entry points stay `yarn harness:validate` / `harness:release`
- [x] 1.3 Fix the Claude runner adapter tool-exposure defect

#### 1.3 finding (root cause of the whole Claude lane failing)

The Claude lane could never pass a single case, for adapter reasons rather than model capability. Measured against the real CLI (2.1.220):

- `--tools` selects only from the **built-in** tool set, so passing `mcp__harness__read` there resolved to **zero** tools. That also removed the built-in deferred-discovery tool, which is the only way an MCP tool becomes callable in this CLI — the model reported "No read tool is exposed in this session's function list".
- `--safe-mode` disables every customization **including `--mcp-config` servers**; the init event reported `mcp: []` with it and `mcp: [{name:"harness"}]` without it.
- `--permission-mode plan` returns a plan instead of performing the reads the trace gate requires.

The MCP tool server itself was proven conformant (correct `initialize`, `notifications/initialized`, and `tools/list` exchange over stdio). Fixed by exposing exactly one built-in discovery tool, permission-allowlisting the harness MCP tools, and using a non-plan mode. Isolation is preserved by `--setting-sources ''`, verified by probe: skills NONE, hooks no, project instruction files not auto-injected — so the traced MCP read stays the only route to app content. `OMH-001` went from fail to pass immediately.

The existing tests could not catch this: the fake `claude` binary asserted exactly the flags the code passed, so the contract was self-confirming. Replaced with property assertions about the real contract.

### Phase 2: Baseline measurement

- [x] 2.1 Measure the complete Claude/sonnet routing baseline — **96/184** with the adapter fixed, before any router edit (0/184 before it)
- [x] 2.2 Measure the Codex control sample for the same cases — Codex lane was also dead here (`--disable skill_search` unknown to codex-cli 0.144.6); fixed, then used as the regression control

### Phase 3: Evidence-driven remediation

- [x] 3.1 Remediate shared-owner routing authority defects — additive `backend-ui`, additive ownership (`umes`), architecture co-route, module-fact triggers, `testing` trigger, compatibility-guide path
- [x] 3.2 Remediate declaration/observation discipline in the shared contract — `selectedContext` is an exact record; over-reported blockers; refused reads no longer scored as loaded content (both runner shapes)
- [ ] 3.3 Recalibrate over-specified expectations and prove the complete sonnet matrix
- [x] 3.4 Audit and pin the expanded integrity/encryption/search/AI/i18n/UMES guidance requirements — `9d90ef01a`
- [ ] 3.5 Add and pass the single-shot complete book-library module evaluation, including main-sidebar visibility — infrastructure/oracle in `0dff12ef3`; two-model routing passes; r7/r8 writable evidence drove canonical customers-level guidance in `c97155e0a` and `88ceacc0b`; final writable/review proof pending
- [ ] 3.6 Enforce the complete-module and design-system checklist through om-code-review, om-auto-review-pr, and generated-code review — checklist/config/policy tests landed in `0dff12ef3`; upstream-compatible local overlay verified; live generated review proof pending
- [x] 3.7 Default new editable module surfaces to linked/filterable full CRUD while preserving upstream review-skill behavior — `0dff12ef3`
- [x] 3.8 Verify and, if needed, restore shared `open-mercato/skills` install/update parity for generated apps — `4e9ed542c`
- [x] 3.9 Add progressive cache/invalidation and queue guidance plus two-model generative evaluation coverage — `4ab32d393`; OMH-186/187 pass on both models
- [x] 3.10 Merge field-tested OMH-188–191 and add the combined scoped CRM/library OMH-192 regression with executable oracles, Jest, and review rules — `9675e5678`
- [x] 3.11 Pin reproducible Codex reasoning effort for the requested gpt-5.4-mini comparison and strengthen durable-workflow progressive routing — `e7654fec8`
- [x] 3.12 Keep debugging additive to cross-module domain/extension work and remove negated-label routing ambiguity — `1a34781da`
- [x] 3.13 Route multi-seam domain fixes through the blueprint/API scaffold references and pin trusted public-schema scope — `68d7645a2`
- [x] 3.14 Keep the Codex MCP discovery gate available for gpt-5.4-mini while denying every model-authored capability — `a97a3e8bb`
- [x] 3.15 Name the exact harness MCP tools under isolated Codex and remove ambiguous OMH-192 counterfactual labels — `962f042e8`
- [x] 3.16 Reject module facts absent from the emitted controller and keep the standalone routing contract within its byte budget — `632bfe8d3`
- [x] 3.17 Retry one trace-free read-only routing startup without retrying safety violations — `829babd95`
- [x] 3.18 Diagnose one semantic routing correction without leaking oracle answers, then allow one independent trace-start recovery — `574924d33`
- [x] 3.19 Abort a matrix when Claude reports an expired OAuth session inside its terminal result event — `63f62ae62`
- [x] 3.20 Prioritize scalar-ID/snapshot fix routing to UMES plus the data-model and system-extension skills — `7314d448d`
- [x] 3.21 Recover once from the exact model-reported `harness.read`-unavailable startup without retrying arbitrary model or safety violations — `72a7cf0ce`
- [x] 3.22 Recognize the equivalent `Harness read tool is unavailable` startup wording observed on the current Codex CLI — `b19da559a`
- [x] 3.23 Bind retried integration callbacks to the existing `subscriber-idempotency` decision label — `132d8e634`
- [x] 3.24 Bind successful cursor commits and bounded transient retries to their existing decision labels — `700ee18ea`
- [x] 3.25 Bind safe working-stage specifications to the existing `integration-coverage` decision label within the root budget — `a0d8ce447`
- [x] 3.26 Bind the required debugging regression oracle to the existing `unit-regression-oracle` decision label — `e3dcacb86`
- [x] 3.27 Make the integration skill's three existing provider contract references non-skippable for provider implementations — `732c61ce5`
- [x] 3.28 Clarify that plan-only spec work includes integration coverage but no implementation-domain routes — `3f8f14f87`
- [x] 3.29 Bind provider repair, multi-seam persistence, verification, and compatibility work to their progressive references — `5725cca14`
- [x] 3.30 Bind installed customer-success response, event, and ID extensions to the compatibility snapshot — `65f481756`
- [x] 3.31 Align the CLI scaffold integration expectation with the intentionally removed unreachable package guides — `58216de54`
- [x] 3.32 Stabilize measured high-effort mini timeouts, exact unavailable-read startup recovery, installed-contract UMES routing, callback inbox claiming, and observed context floors — `13d13ab6a`
- [x] 3.33 Recover once from a successful routing startup with no observed context reads while keeping untraceable commands fail-closed — `06156c8bf`
- [x] 3.34 Tighten measured runner floors, exact residual owner contracts, and contradictory catalog expectations without weakening compatibility or trace safety — `dd2c172e8`
- [x] 3.35 Bind repeated installed-import, workflow-state, optional-provider, OAuth-health, and explicit-testing decisions at their existing owners — `90a89d017`
- [x] 3.36 Merge current develop and cover its default WMS module fact without renumbering the 192-case catalog — `5d4b20e8d`
- [x] 3.37 Bind installed behavior discovery and field-versus-history design to their exact existing owners — `789e010e3`
- [x] 3.38 Bind installed table actions and mutation-guard consistency to their exact existing owners — `df6fa2938`
- [x] 3.39 Bind spreadsheet imports, renewal schedules, host-state workflows, and customer-record AI to their exact domain owners — `aedcb6ff1`
- [x] 3.40 Bind carrier provider-neutrality, absence safety, and requested-test context to their exact owners — `bb75087d8`

### Phase 4: Compatibility baseline

- [ ] 4.1 Prove the complete Codex routing baseline remains green
- [x] 4.2 Exercise host-supported writable/review lanes and report blocked lanes — the three Linux-lane failures #4483 left red are resolved: a real sandbox-composition defect (writable root re-mounted read-only), a platform-coupled preflight assertion, and a Chromium host prerequisite now behind a capability guard. Latest create-app suite: 323 pass / 4 platform skips / 0 failed

### Phase 5: Delivery gates

- [x] 5.1 Add regression coverage and run targeted suites — 9 new regression tests; full create-app suite green
- [ ] 5.2 Update spec, harness, and operator documentation with measured evidence
- [ ] 5.3 Run the configured gate, complete review/autofix, and publish PR evidence
