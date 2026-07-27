# Pre-Implementation Analysis: Agent Eval Workbench & Regression Gate

**Spec:** `.ai/specs/enterprise/agent-orchestrator/next/2026-07-19-agent-eval-workbench-and-gate.md`
**Date:** 2026-07-19 · **Scope:** Phases 1–5 · **Analysis only — no code or spec modified**

## Executive Summary

The spec is architecturally sound after two review rounds and its factual claims about the codebase hold
up. Implementation is **not blocked**, but **six gaps must be closed in the spec before Phase 1 starts** —
five of them concern code the spec never mentions. The most consequential: the skipped-result doctrine
(`passed: null`) collides with three existing consumers that treat null as *failure*, including a UI mapper
that hard-coerces `null → false`. Shipping the doctrine without fixing those turns every skipped assertion
into a visible red badge and a `false` gate contribution — the opposite of the spec's stated invariant.

One backward-compatibility claim in the spec is **wrong** and must be corrected: `lib/eval/*` is reachable
by third parties through `@open-mercato/enterprise`'s wildcard subpath exports.

**Recommendation: Needs spec updates first** — six targeted edits, all small. No architectural rework.

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---|---|---|---|
| 1 | **2. Types & Interfaces** | §8 declares `Scorer`, `ScorerInput`, `ScorerRunFacts`, `ScorerVerdict`, `getScorer` "module-internal (`lib/`, not exported from the package entrypoint) — declared not a contract surface." **False.** `packages/enterprise/package.json:58-59` exports `"./*/*/*/*/*"` → `./src/*/*/*/*/*.ts`; `modules/agent_orchestrator/lib/eval/scorers` is exactly five segments, so `@open-mercato/enterprise/modules/agent_orchestrator/lib/eval/scorers` resolves for any third party. There is no barrel re-export, but the deep path is public. | **Critical** (claim), Low (real-world impact) | Rewrite §8's row: these ARE a contract surface via wildcard exports. Apply the protocol unconditionally — keep `ScorerInput` as a `@deprecated` type alias and `getScorer(key)` as a `@deprecated` wrapper delegating to the new `scorerKey` lookup, both for ≥1 minor, with an UPGRADE_NOTES entry. Cheap: no internal consumer imports these types (verified). |
| 2 | **8. DB Schema** | `AgentEvalAssertion.scorer_key` NOT NULL added to a populated table. | Warning | Already correct in §3.1 — three-step add-nullable → backfill → SET NOT NULL. Confirm the migration ships `.snapshot-open-mercato.json` in the same commit. |
| 3 | **8. DB Schema** | `AgentEvalResult.passed` NOT NULL → nullable (`migrations/Migration20260623155649_agent_orchestrator.ts:11` is `"passed" boolean not null`). | OK — a widening, explicitly permitted | Needs an explicit `ALTER COLUMN passed DROP NOT NULL` migration. The spec states the widening but not the migration step. |
| 4 | **14. Generated File Contracts** | Adding `scorer_key` requires regenerating `packages/enterprise/generated/entity-fields-registry.ts:55-71` and adding the column to `api/eval-assertions/route.ts:59-70` `fields` — otherwise it is not queryable through the query engine. Spec is silent. | Warning | Add a Phase 1 step: `yarn generate` + extend the route's `fields` and `sortFieldMap`. |
| 5 | **7. API Routes** | No route removed. The harness spec's `/eval-suite-runs` was **never implemented**, so superseding it costs nothing. `DELETE /eval-cases` was withdrawn in round 2. | OK | — |
| 6 | **10. ACL** | `eval.run` added only; no rename. | OK | Confirm `setup.ts` `defaultRoleFeatures` includes it (spec says so). |
| 7 | **5. Event IDs / 13. CLI** | Both additive; `eval_suite_run.*` and `eval_case_run.*` are new, `agent-orchestrator eval` is a new command. | OK | — |

### Behavioral BC (not a listed surface, but real)

`data/validators.ts:360` is `config: z.unknown().optional()` — **no per-scorer validation today**. Tightening
it means a stored row that is currently accepted can start returning 422 on its next edit. The spec calls
this out in §8 and routes it to UPGRADE_NOTES. Correct — but note the *evaluation-time* path must stay
lenient (it does: SKIPPED, not failed), so existing rows keep evaluating rather than breaking gates.

## Spec Completeness

All required sections are present. Gaps are within sections, not missing ones.

| Section | Gap | Recommendation |
|---|---|---|
| §7 Phase 1 | No step for migrating the **6 existing test files** that call the old scorer shape. `__tests__/eval-scorers.test.ts:4-35` invokes `scorers.output_present({ output, run, config })` directly. | Add an explicit Phase 1 step: update `eval-scorers.test.ts` and `eval-runtime.test.ts` to the new signature; they are the registry regression test's baseline. |
| §7 Phase 1 | No step removing the **client-side registry import**. | See Gap G4. |
| §3.4 | No payload size bound on progress events. | See Gap G5. |
| §4.3 | The aggregation rule is stated abstractly but does not name the three call sites that must change. | See Gap G1–G3. |
| §3.1 | The `required_keys` justification overstates the seeded surface. | See Gap G7. |

## AGENTS.md Compliance

| Rule | Status |
|---|---|
| `makeCrudRoute` + `entityType` + `openApi` on CRUD routes | ✅ §5 |
| Per-method route `metadata` with `requireFeatures` | ✅ matches `api/eval-assertions/route.ts:22-29` precedent |
| `CrudForm` / `DataTable` / `apiCall` / `useGuardedMutation` | ✅ §6 |
| zod validation on all inputs incl. merged case overrides | ✅ §3.3 |
| Encryption maps for new sensitive columns | ✅ §4.3 — and correctly notes neither eval-result nor assertion needs one; `agent_eval_case` is already mapped (`encryption.ts:22-30`) |
| `defaultRoleFeatures` for new ACL feature | ✅ §5 |
| `createModuleEvents` with past-tense ids | ✅ §5 |
| Commands for all mutations; no delete route | ✅ §5 |
| DS tokens, dialogs, `aria-label`, Boy Scout | ✅ §6 |
| i18n keys planned | ✅ §6. Low risk: `backend/eval-assertions/page.tsx:204` resolves scorer labels dynamically with the raw key as fallback, so new scorers degrade gracefully rather than breaking. |
| `yarn generate` after entity change | ❌ **not mentioned** — see BC #4 |

## Risk Assessment

### High

| Risk | Impact | Mitigation |
|---|---|---|
| **Skipped results render and aggregate as failures** | `components/types.ts:424` is `passed: asBoolean(item.passed) ?? false`. Every SKIPPED result becomes `false` — a red badge at `backend/traces/[id]/page.tsx:1015` (binary ternary, no null branch), an under-count at `:723`, and a `false` contribution in `evalRuntimeService.ts:76` `gate.every(v => v.passed)`. The spec's core invariant is silently inverted at three sites. | Fix all three **in the phase that introduces nullability (Phase 1)**, not Phase 4. Add a third UI branch (`StatusBadge` "skipped"), filter nulls before `every`, and change the mapper to preserve null. Unit-test each. |
| **Progress events silently dropped above 7 KB** | `packages/events/src/bridge.ts:167-170`: the cross-process bridge serializes to `pg_notify` and **drops with a `logger.warn` only** above `MAX_MESSAGE_BYTES = 7_000`. A progress payload carrying a case title, error excerpt, or tool args could exceed it; the UI would look frozen with no error surfaced. | Bound the `eval_case_run.*` payload by design: ids, counters, status, and a label truncated to a stated length. Assert the serialized size in a unit test. |

### Medium

| Risk | Impact | Mitigation |
|---|---|---|
| Client bundle regression | `backend/eval-assertions/page.tsx:24` imports the `scorers` registry into a client page (only for `Object.keys` at `:202`). Under the new design the registry carries zod schemas, `score` implementations and PII regexes — all shipped to the browser, blowing §6's 15 KB budget. | Phase 1 must delete that import and source keys from `GET /eval-scorers`. Add a bundle assertion. |
| Migration on a populated table | `scorer_key` backfill runs against live rows; a failure mid-way leaves NOT NULL unset. | Three-step migration is already specified. Add a post-condition check (`SELECT count(*) WHERE scorer_key IS NULL` = 0) before `SET NOT NULL`. |
| Test suite breakage beyond the eval tests | `metric-rollup`, `metrics-overview`, `metrics-agents` tests assert on `evalPassed` (`AgentRun`, already nullable — lower risk), but `eval-runtime`/`llm-judge`/`eval-assertion-management` assert on result `passed`. | Enumerate the 6 affected test files in the Phase 1 step. |
| `version` semantics change | `AgentEvalAssertion.version` is currently **never incremented** by any code path, yet is exposed in the list `fields` and OpenAPI (`route.ts:158`). Making it increment changes observed API behavior (not shape). | Additive and desirable; note it in UPGRADE_NOTES so consumers do not treat it as constant. |

### Low

| Risk | Impact | Mitigation |
|---|---|---|
| Zod refinement composition | `JudgeRubric` is a discriminated union with a refinement (`samples` odd when `aggregation: 'majority'`). Per `.ai/lessons.md:644`, Zod v4 throws on `.extend()` over refined objects. | Use `.safeExtend()` when composing; noted for the implementer. |
| Integration tests hang on SSE pages | `.ai/lessons.md:301` — `waitForLoadState('networkidle')` never settles on SSE pages. The eval-run result view is one. | TC-AGENT-EVAL-004/010 must use `domcontentloaded` + an explicit readiness assertion. |
| i18n coverage | 4 locales × ~20 new scorer labels. | Dynamic fallback to the raw key means partial coverage degrades rather than breaks. |

**Superseded lesson, recorded to prevent a wrong fix.** `.ai/lessons.md:455` and `:575` state that
worker-emitted events do not reach the browser and prescribe a polling fallback. **That is no longer
true**: `packages/events/src/bus.ts:314-320` publishes broadcast events cross-process via
`packages/events/src/bridge.ts` (PostgreSQL LISTEN/NOTIFY on `om_event_bridge`). The spec's SSE-only
progress design is therefore valid, subject to the 7 KB cap above. Do **not** add a polling loop —
`.ai/lessons.md:565` forbids exactly that. These two lessons should be amended post-implementation.

## Gap Analysis

### Critical (block Phase 1)

- **G1 — Null-coercing mapper.** `components/types.ts:424` and the `EvalResultView.passed: boolean` type at
  `:135` must accept null. Currently converts every skipped result into a failure.
- **G2 — UI has no skipped state.** `backend/traces/[id]/page.tsx:1015` binary ternary and the `:723`
  pass-counter need a third branch and a corrected denominator.
- **G3 — Gate aggregation counts null as fail.** `evalRuntimeService.ts:76` `gate.every((v) => v.passed)`
  must filter `passed === null` first, per §4.3's stated rule.
- **G4 — Client-side registry import.** `backend/eval-assertions/page.tsx:24` must be removed in favour of
  `GET /eval-scorers`.
- **G5 — Unbounded progress payload.** State a hard cap well under `MAX_BRIDGE_BYTES = 7_000`; oversize is
  dropped silently.
- **G6 — Generated registry regeneration.** `yarn generate` + route `fields`/`sortFieldMap` extension for
  `scorer_key`, else the column is invisible to the query engine.

### Important

- **G7 — Correct the `required_keys` rationale.** §3.1 says rewriting seeded rows risks a verdict change on
  rows "several carrying `gate` severity". Verified against `lib/eval/defaultAssertions.ts:21-64`:
  `required_keys` is **not seeded at all**, and only `output_present` is seeded as `gate`. The justification
  is still valid — *user-authored* `required_keys` rows may exist and may be `gate` — but the wording
  overstates the seeded surface and should be corrected to say so.
- **G8 — Test migration step.** Name the 6 affected test files in Phase 1.
- **G9 — `passed` NOT NULL drop migration.** State it explicitly alongside the `scorer_key` migration.

### Nice-to-have

- **G10** — `agent_orchestrator:agent_eval_result` has a generated entity id and field registry
  (`entities.ids.generated.ts:18`, `entity-fields-registry.ts:89-102`) but no CRUD route or indexer wiring.
  If eval results should be filterable in the workbench, wire the indexer; otherwise note the deliberate
  omission so a future reader does not treat it as an oversight.
- **G11** — Amend `.ai/lessons.md:455` / `:575` once Phase 3 proves cross-process SSE for worker-emitted
  eval progress.

## Remediation Plan

### Before implementation (6 spec edits)

1. **§8** — rewrite the exported-types row: `lib/eval/*` **is** a contract surface via wildcard exports;
   commit to `@deprecated` `ScorerInput` alias + `getScorer` wrapper for ≥1 minor.
2. **§4.3 / §7 Phase 1** — name G1, G2, G3 as explicit Phase 1 deliverables with their file:line targets.
3. **§7 Phase 1** — add the client-import removal (G4), the `yarn generate` + route-`fields` step (G6), the
   `passed` DROP NOT NULL migration (G9), and the 6-file test migration (G8).
4. **§3.4** — state the progress-payload byte cap and the `pg_notify` drop behavior it defends against.
5. **§3.1** — correct the `required_keys` rationale to reference user-authored rows, not seeds (G7).
6. **§9** — add the `domcontentloaded` readiness convention to the SSE-touching TCs.

### During implementation

1. Post-condition assertion on the `scorer_key` backfill before `SET NOT NULL`.
2. `.safeExtend()` for any composition over the refined `JudgeRubric` schema.
3. Serialized-size unit test for the progress payload.
4. Bundle assertion proving the scorer registry is absent from the client chunk.

### Post-implementation

1. Amend `.ai/lessons.md:455` / `:575` (cross-process bridge now exists).
2. Add a lesson if the `scorer_key` split proves reusable — an overloaded identifier column serving both
   "which implementation" and "which instance" is a recurring shape.
3. Revisit G10 (eval-result indexer wiring) once the workbench is in real use.

## Recommendation

**Needs spec updates first.** Six edits, all localized; no architectural rework and no re-review round
required. The BC surface is unusually clean — every consumer of the changed code is internal to
`agent_orchestrator`, no external package, app, script, or official module imports any of it — so the
blast radius is small and well-bounded. The real risk is not compatibility but **silent semantic
inversion**: three existing sites treat `null` as `false`, and the spec's central skipped-result invariant
depends on all three changing together with the migration that introduces nullability.
