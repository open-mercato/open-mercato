# Sonnet Harness Evaluation Optimization Follow-up

## Goal

Optimize the standalone AI development harness so the complete 184-case evaluation catalog passes with the Claude runner on the `sonnet` model selector, while the Codex baseline (`modelSelector: "default"`) keeps passing exactly as it does today.

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
- Add or strengthen semantic catalog coverage for real gaps above. Preserve progressive disclosure and the fail-closed gates; modest per-case file/byte quota increases and limited WIP catalog compatibility changes are allowed only when both runner traces justify them and the final measurements disclose them.

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
2. Controller: copy `packages/create-app/template`, resolve `{{APP_NAME}}`/`{{PACKAGE_VERSION}}`, then `runAgenticSetup(dir, async () => 'skip', { tool: 'claude-code,codex,cursor' })` from the built CLI. Confirm `node scripts/evaluate-agent-harness.mjs --all` → 184/184.
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
- [ ] 3.5 Add and pass the single-shot complete book-library module evaluation, including main-sidebar visibility
- [ ] 3.6 Enforce the complete-module and design-system checklist through om-code-review, om-auto-review-pr, and generated-code review
- [ ] 3.7 Default new editable module surfaces to linked/filterable full CRUD while preserving upstream review-skill behavior

### Phase 4: Compatibility baseline

- [ ] 4.1 Prove the complete Codex routing baseline remains green
- [x] 4.2 Exercise host-supported writable/review lanes and report blocked lanes — the three Linux-lane failures #4483 left red are resolved: a real sandbox-composition defect (writable root re-mounted read-only), a platform-coupled preflight assertion, and a Chromium host prerequisite now behind a capability guard. create-app suite: 314 pass / 4 skipped / 0 failed

### Phase 5: Delivery gates

- [x] 5.1 Add regression coverage and run targeted suites — 9 new regression tests; full create-app suite green
- [ ] 5.2 Update spec, harness, and operator documentation with measured evidence
- [ ] 5.3 Run the configured gate, complete review/autofix, and publish PR evidence
