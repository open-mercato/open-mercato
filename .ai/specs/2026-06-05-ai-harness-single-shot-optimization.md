# AI Harness Single-Shot Optimization — Skills & Task Router Gaps

- **Status:** Draft (analysis complete; implementation not started)
- **Date:** 2026-06-05
- **Owner:** TBD
- **Type:** Process / developer-experience (AI harness: `AGENTS.md`, `.ai/skills/`, standalone-app agentic templates)
- **Related:** PR #2594 (AGENTS.md trim + first router quick-wins, already shipped), [[cf-async-index-read-after-write]], [[feedback-root-cause-not-timeout-bumps]]

> ⚠️ This spec is the output of an automated analysis. The proposed skills and rules **require their own regression tests and a second optimization pass** before they can be considered done. Treat the priorities and PR groupings as evidence, not as a finished design.

## 1. Goal

Make coding agents (both monorepo contributors and standalone-app builders) succeed **in a single shot** — no human round-trips and no follow-up "fix" PR. The lever is the harness itself: the Task Router rows agents read first, the skills they can invoke, and the AGENTS.md rules that fail them closed.

## 2. Method

Two background workflows (kept separate per the request) each fanned 6 subagents across **all 317 PRs merged in the last 30 days** (window `merged:>=2026-05-06`), categorized them by task type, and mined the **128 `fix` PRs** for recurring root-causes an upfront skill/rule could have prevented. Findings were grounded against the live monorepo Task Router and the standalone `agentic/shared/AGENTS.md.template` + shipped skills.

- `standalone-harness-gap-analysis` → `/tmp/standalone-harness-findings.md` (full report archived in the run transcript)
- `monorepo-harness-gap-analysis` → `/tmp/monorepo-harness-findings.md`

## 3. Headline finding (both workflows converge)

The top three work buckets — **integration testing, data-integrity writes, and tenant/security scoping** — account for roughly half of all merged work and contain nearly all of the *repeated* failures. Yet these are exactly the Task Router rows that cite **no skill** today. The same five root-causes recur across dozens of modules because each agent rediscovers them rather than reading one rule.

Convergent top failure classes (with representative fix PRs):

| Failure class | Representative fix PRs | Single-shot fix |
|---|---|---|
| Non-atomic multi-table writes (entity + custom fields + links flushed separately) | 2383, 2377, 2376, 2374, 2368, 2360, 2356, 2355, 2354, 2343, 2420 | one transaction (`withAtomicFlush`) + "inject mid-write failure → assert no partial row" test |
| CrudForm field doesn't survive save→reload (dot-path, nullable, custom fields) | 2540, 2535, 2533, 2528, 2515, 2513, 2467, 2408, 2405, 2396, 2415 | field round-trip checklist + the #2466 field-persistence harness |
| Reads not scoped to tenant+org; fail-OPEN on null scope | 2320, 2300, 2299, 2296, 2294, 2212, 2198, 2197, 2196, 2124, 2122, 2107 | "scope or deny" guard test (model on `optimistic-lock-ui-coverage.test.ts`) |
| Undo/redo handlers silently no-op or lose writes under encryption re-baseline | 2586, 2514, 2509, 2508, 2417, 2347, 2346, 2345 | `extractUndoPayload` + preserve-pending pattern + #2468 coverage matrix |
| ACL feature dependencies (`dependsOn`) not declared → gated runtimes never run | 2297, 2295, 2289–2249 range, 2208, 2201, 2220, 2141 | scaffold emits `dependsOn` + `sync-role-acls` reminder |
| Encrypted-column read paths (search/sort/filter/label) assume plaintext | 2040, 2065, 2282, 2447 | `findWithDecryption` + search-token + query-index decrypt checklist |
| Flaky tests: async-index read-after-write + fixed date literals | 2554, 2450, 2393, 2391, 2369, 2418, 2419, 2213, 2202, 2226 | poll-after-write rule + time-bomb date scanner as CI gate |
| `instanceof` across Turbopack split chunks | 2066, 2059, 1850, 1916 | one rule: use `is*()` type guards, read `{error:{code,message}}` defensively |

## 4. Analysis A — Standalone apps

Structural issue: there are **two** standalone AGENTS.md files and they disagree.

1. `packages/create-app/template/AGENTS.md` — the root file shipped to **every** scaffolded app (bare + imported ready apps). It has **no Task Router**, so an agent reading only it is blind to all 19 shipped skills.
2. `packages/create-app/agentic/shared/AGENTS.md.template` — generated **only when the agentic wizard runs**. It has a good Task→Context map but is missing rows for the three P0 themes (atomic writes, field round-trip, fail-closed scoping).

Per `packages/create-app/AGENTS.md` rule #8, both files must be updated in the same change. **Caveat to resolve during implementation:** skills are installed by the agentic wizard, so referencing them from the bare-scaffold `template/AGENTS.md` only helps if those apps also receive the skills — confirm install paths before adding skill links to the bare template (otherwise the bare template should link docs/URLs, not `.ai/skills/...`).

Standalone task distribution (by PR volume): integration tests > admin/CRUD UI > auth/ACL > tenant scoping > atomic writes > performance > custom fields > undo/redo. Full root-cause list and per-skill improvement notes in `/tmp/standalone-harness-findings.md`.

## 5. Analysis B — Monorepo

The Task Router cites a skill on only **6 of ~36 rows**. Module Development, Data integrity, Encryption, Security/scoping, CrudForm/DataTable, and Performance rows point only at AGENTS.md prose — and those are exactly where the repeated fixes land. Monorepo task distribution: integration tests (~45) > data integrity (~28) > security scoping (~25) ≈ UI primitives (~25) > ACL deps (~19) > performance (~18). Full report in `/tmp/monorepo-harness-findings.md`.

Already shipped in PR #2594 (quick-win citations): `om-backend-ui-design`/`om-ds-guardian` on the UI/CrudForm/DataTable/portal rows, `om-spec-writing` on the spec-lifecycle row, `om-module-scaffold` note + `.ai/docs/module-development.md` link on the "create a module" row.

## 6. Proposed NEW skills

Unified across both ecosystems (standalone names install as `om-*`). Each MUST ship with a regression test/gate, not prose alone.

| Skill | Priority | Scope | Required test/gate | Justifying PRs |
|---|---|---|---|---|
| `atomic-write` (a.k.a. `data-integrity-writes`) | **P0** | Any command writing an entity + its custom fields/links/relations/cascades uses one `withAtomicFlush`/locking transaction; serialize concurrent timer/segment/counter writes | "inject mid-write failure → assert no partial row" template | 2383, 2377, 2376, 2374, 2368, 2360, 2356, 2355, 2354, 2343, 2420 |
| `crudform-field` (a.k.a. `crud-field-persistence`) | **P0** | Every editable field round-trips: declared in validator → serialized in detail GET → hydrated into `initialValues` → clearable to null; reject undeclared cf keys; dirty-baseline from `initialValues`; resolve UUIDs to labels | #2466 field-persistence harness as the default check | 2540, 2535, 2533, 2528, 2515, 2513, 2467, 2408, 2405, 2396, 2415, 2437 |
| `scope-guard` (a.k.a. `tenant-scoping-and-fail-closed`) | **P0** | "Scope or deny" on every read surface (em.find/findOne, enrichers, search, SSE filters, command `require*`); fail CLOSED on null scope; super-admin gate on global/system writes | guard test modeled on `optimistic-lock-ui-coverage.test.ts` | 2320, 2300, 2299, 2296, 2294, 2212, 2198, 2197, 2196, 2124, 2122, 2107, 2279, 2278 |
| `undo-redo` | **P1** | Snapshot via `extractUndoPayload`; preserve pending under encryption deep-decrypt re-baseline; single lock on compound ops; public-undo-API reachability | #2468 undo coverage matrix | 2586, 2514, 2509, 2508, 2417, 2347, 2346, 2345 |
| `acl-feature-dependencies` (or a `module-scaffold` section) | **P1** | Scaffold emits `dependsOn` bundles + a working `getGrantedFeatures`; every gated route/enricher/AI-tool/menu declares transitive features; grant in `setup.ts` + `sync-role-acls` | ACL-dependency guard test | 2297, 2295, 2289–2249, 2208, 2201, 2220, 2141 |
| `encrypted-field` | **P1** | Search/sort/filter/label-display over encrypted columns routes through search-token + `findWithDecryption` + query-index label decryption; never DB-sort encrypted columns | encrypted-read-path checklist + test | 2040, 2065, 2282, 2447 |
| `perf-pattern` (a.k.a. `perf-list-and-afterlist`) | **P2** | `$in`/`Promise.all` batching and per-process memoization as the default; push pagination to DB; skip enrichers on list cache hits | N+1 lint/review check | 2318–2310, 2290, 2263, 2211, 2210, 2314 |

## 7. Task Router changes

### 7.1 Monorepo root `AGENTS.md`
Add rows for `atomic-write`, `scope-guard`, `crudform-field`, `undo-redo`, `encrypted-field` (strengthen the existing Encryption row), and a Performance batching row; wire the existing autonomous-fix chain (`om-root-cause` → `om-fix` → `om-verify-in-repo`) into the "Autonomous bug fixing" principle; cite `om-smart-test` + the root-cause-over-timeout memory on the Testing row; cite `om-create-agents-md` on the new-module/package row; add `om-dev-container-maintenance` + `om-check-and-commit` rows.

### 7.2 Standalone `template/AGENTS.md` + `agentic/shared/AGENTS.md.template`
Add a Task Router to the bare `template/AGENTS.md` (resolving the install caveat in §4) and add the three missing P0 rows to the agentic map. Keep both files in sync (rule #8).

## 8. Existing-skill improvements

- **`om-module-scaffold`**: add a Custom Fields section (`collectCustomFieldValues`, reject undeclared cf keys, `normalizeCustomFieldResponse`); an "atomic writes" rule; a `dependsOn` ACL example; a read-model parity rule (detail/list GET returns every editable field incl. `updatedAt`); an `instanceof`-across-chunks rule. *(Partially started in PR #2594: stale `api/get|post`, feature-id, and entity-file conventions corrected in `references/naming-conventions.md`.)* Unresolved: the `page.meta.ts` icon guidance contradicts `template/AGENTS.md` (skill says `lucide-react`; template says inline `React.createElement('svg')` in meta files) — **needs a maintainer decision**.
- **`om-system-extension`**: transaction safety for guard-driven sibling writes; skip-enrichers-on-cache-hit + memoization note; `query.ids` narrowing + boolean/SQL-cast filter rule; fail-closed scoping for interceptors/guards/enrichers.
- **`om-data-model-design`**: `updated_at` must be returned in list/detail responses; encrypted/relation columns register a query-index decrypt/search-token step; history writes share the entity-write transaction.
- **`om-integration-tests`**: poll-after-write against the async index; forbid fixed date literals (time-bomb scanner); deterministic readiness wait before clicking portalled row menus.
- **`om-code-review`**: add five checklist items — atomic-write, write-then-read field parity, fail-closed-on-null-scope, `dependsOn` declaration, no-`instanceof`-across-chunks.
- **`om-backend-ui-design`**: unwrap structured error envelopes via `raiseCrudError`/`readApiResultOrThrow`; combobox label resolution + portal layering; never render raw FK UUIDs; clean detail must not report dirty.

## 9. Tests & verification (REQUIRED — this spec is not done without them)

Each new skill is only credible with an enforcing gate. Minimum:
1. `scope-guard` CI test that fails when a read path lacks org+tenant predicates (mirror `optimistic-lock-ui-coverage.test.ts`).
2. `atomic-write` regression template (mid-write failure → no partial row) wired into at least one core module as the worked example.
3. Field-persistence harness (#2466) promoted to a reusable fixture and referenced by `crudform-field`.
4. Time-bomb date-literal scanner promoted from advisory to a CI gate for `__integration__` specs.
5. `makeCrudRoute`-missing-`indexer` generate-time guard (themes 2083/2086/2076/2073).

## 10. Phasing

- **Phase 1 (quick wins, mostly docs):** Task Router citations of existing skills (monorepo done in #2594; standalone pending), the four one-line AGENTS.md rules (atomic-write, fail-closed scope, no-`instanceof`, poll-after-write), `om-module-scaffold` custom-fields + `dependsOn` sections.
- **Phase 2 (P0 skills + gates):** `atomic-write`, `crudform-field`, `scope-guard` with their tests.
- **Phase 3 (P1/P2 skills):** `undo-redo`, `acl-feature-dependencies`, `encrypted-field`, `perf-pattern`; existing-skill improvements; second optimization pass re-measuring the next 30-day window.

## 11. Backward compatibility

All changes are **additive**: new skills, new Task Router rows, new AGENTS.md rules, and doc edits. No contract surface (per `BACKWARD_COMPATIBILITY.md`) is removed or renamed. The one rename already in the tree (`module-scaffold` → `om-module-scaffold`) predates this spec and is not introduced here. New CI gates must land as advisory first, then enforcing, to avoid blocking in-flight PRs.

## 12. Open questions

1. New skills vs. sections in existing skills — `acl-feature-dependencies` and `encrypted-field` may be better as `om-module-scaffold`/`om-data-model-design` sections than standalone skills.
2. Resolve the `page.meta.ts` icon contradiction (skill vs. template).
3. Confirm `create-ai-agent` actually ships to standalone apps (`template/AGENTS.md` references it; verify it is in the installed skill set).
4. Decide whether the bare `template/AGENTS.md` should link `.ai/skills/...` (only valid if skills are installed there) or docs URLs.
