# SPEC — Agent OUTCOME quality contract (declared conditions + quality goals)

- Status: **DRAFT — ready for review**
- Scope: **enterprise** — `packages/enterprise/src/modules/agent_orchestrator`
- Date: 2026-06-26
- Source: converts the approved plan `~/.claude/plans/recursive-mapping-mountain.md`
- Confidentiality: the motivating requirement comes from a CLIENT engagement. This spec adopts the
  ideas **generically** and MUST NOT name the client or their domain (memory
  `feedback_client_names_not_in_repo`). All examples use neutral CRM/support fixtures already in the
  repo (`deals_health_check`, `support_resolution_advisor`).

## TLDR

**What is being built.** A first-class, **enforced quality contract** on an agent's OUTCOME. Today an
OUTCOME is `kind` + a result JSON-Schema + free prose (`lib/sdk/defineFileAgent.ts`,
`lib/sdk/outcomeSchema.ts`). This spec lets an author additionally declare, as structured data:
**success conditions**, **missing-data conditions**, **failure conditions**, and **quality goals**
(% correctness / max latency / max cost-per-run).

**The governing principle is reuse, not duplication.** Author declarations COMPILE INTO machinery that
already exists; this spec adds almost no new runtime:

- success / failure / missing-data conditions → per-agent rows in the existing **eval-assertion**
  engine (deterministic scorers in `lib/eval/scorers.ts`; `evaluateRun` already ANDs every `gate`
  verdict into `run.evalPassed`). **No new eval engine, no new scorers in v1, no DB migration.**
- quality goals → declared **targets** compared against the **KPI actuals** the metric rollup already
  computes (`computeAgentMetrics` → `evalPassRate` / `avgLatencyMs` / `costMinorTotal` / `totalRuns`),
  surfaced on the agent detail page.
- missing-data → the run-level `insufficient_data` / abstain disposition is the one genuinely-new
  piece and is **deferred** (Phase 3). Phase 1 compiles missing-data conditions as a non-blocking
  `warn` proxy so they are visible without blocking production.

The declared contract is **AUTHOR-DECLARED metadata**, distinct from the runtime-returned result. It
never touches `compileOutcome` and never modifies the runtime result validators in `data/validators.ts`.
Every new field is **optional at every hop** → additive / BC-safe (BACKWARD_COMPATIBILITY.md §2/§14).

**Scope.** Phase 1 — declared conditions, authoring surface, carry-through, the code-first
`syncDeclaredConditions` that compiles them to `declared.*` eval assertions, a trace-panel label, the
eval-assertions write guard, and the authoring-skill update. Phase 2 — `qualityGoals` targets +
agent-detail surfacing. Phase 3 (deferred) — run-level `insufficient_data` / abstain disposition. See
Risks for the blast-radius concerns.

## Use cases

- **As an agent author**, I declare a `min_confidence ≥ 0.6` success gate so runs below that threshold
  are stamped `evalPassed = false` and parked — served by the **eval-assertion compile path** (Proposed
  solution → "Compile conditions") and the **`DeclaredCondition` schema** (Contract / data model).
- **As an agent author**, I declare a missing-data condition so a low-confidence run is **flagged but
  not blocked** in v1 — served by the Phase-1 **`warn` proxy** (Proposed solution → "Missing-data") and
  carried forward for the deferred Phase-3 abstain state.
- **As an operator**, I see this agent's **target-vs-actual** eval pass rate, latency, and cost-per-run
  on its detail page so I know whether it meets its declared goals — served by the **quality-goals
  surfacing** (Phase 2) and the `GET /agents/{id}` field (Integration & test coverage).

## Problem statement

An OUTCOME today carries only the **shape** of the result (`kind` + JSON-Schema) and human prose. The
expectations that actually matter operationally are implicit:

- **Success / failure are unstated.** Whether a run "succeeded" is inferred downstream from
  `evalPassed`, but the eval assertions that decide it are authored **out-of-band** — as tenant-scoped
  `agent_eval_assertions` rows seeded centrally (`lib/eval/defaultAssertions.ts`) or created by an
  engineer via the eval-assertions CRUD route. The agent definition itself says nothing about what
  counts as a good outcome, so the contract lives in two disconnected places (the agent dir and the
  assertion store) and drifts.
- **Quality targets are invisible per-agent.** The platform computes `evalPassRate`, `avgLatencyMs`,
  and `costMinorTotal` (`lib/metrics/metricRollupService.ts`), and the agent detail page reserves three
  metric tiles for them — Eval pass, Latency, Cost/run — but they are stubbed as `PendingChip "Needs
  backend"` with no declared target to compare against. There is no per-agent answer to "what is this
  agent supposed to achieve, and is it?"
- **Data sufficiency is unmodeled.** A factual agent that lacks enough grounded context has no
  first-class way to declare "abstain rather than guess"; the claim-level grounding gate
  (`lib/guardrails/`) is the closest existing primitive, but a run-level disposition does not exist.

The machinery to enforce all of this already exists. What is missing is a **declaration surface on the
agent** that compiles into it.

## Goals / Non-goals

**Goals**
- Let an author declare success/failure/missing-data conditions and quality goals **co-located with the
  agent** (file agents in `OUTCOME.md`; in-process agents in `DefineAgentInput`).
- Compile success/failure conditions into the existing eval-assertion engine so they **deterministically
  gate** `evalPassed` with zero new eval runtime.
- Surface quality goals as **target-vs-actual** on the agent detail page using metrics already computed.
- Keep every addition **optional and additive** (BC-safe; see Backward compatibility & migration).

**Non-goals**
- No new scorers in v1 (the four in `lib/eval/scorers.ts` — `output_present`, `required_keys`,
  `min_confidence`, `no_pii` — cover the examples). New scorers are a separate, additive change.
- No change to `compileOutcome`, the result JSON-Schema, or the runtime result validators. Declared
  metadata is never validated against the agent's returned `output`.
- No DB migration. Conditions reuse `agent_eval_assertions`; goals are carried as registry metadata.
- No run-level abstain disposition in Phase 1/2 (deferred to Phase 3).
- No CRUD UI for editing the contract — it is code-first / file-authored, like grounding sets and the
  context registry.

## Proposed solution

### Reuse thesis (lead)

The whole design is three reuse moves plus one deferral:

1. **Declared conditions COMPILE INTO the existing eval-assertion engine.** A `DeclaredCondition`
   references an existing **scorer key** (`output_present` | `required_keys` | `min_confidence` |
   `no_pii`) plus config. A new code-first sync, `syncDeclaredConditions`, mirrors `syncGroundingSets`
   (`lib/guardrails/syncGroundingSets.ts`) and upserts one **per-agent** `AgentEvalAssertion` row per
   condition (`appliesTo = entry.id`, `type = 'deterministic'`). `evaluateRun` already selects
   assertions with `appliesTo: { $in: [run.agentId, '*'] }` (`evalRuntimeService.ts:44`), reads
   `config.scorer` (`:53`), runs the pure scorer, writes an `AgentEvalResult`, and ANDs every `gate`
   verdict into `run.evalPassed` (`:75-81`). **Nothing in the eval engine changes.** Success/failure
   default to `gate`; missing-data defaults to `warn` (the Phase-1 proxy).

2. **Quality goals = declared targets vs existing KPI actuals.** `QualityGoals` (`correctnessPct`,
   `maxLatencyMs`, `maxCostMinor`) is carried as registry metadata on the agent — **no new table, no
   new compute**. The actuals already exist via `computeAgentMetrics` (`evalPassRate`, `avgLatencyMs`,
   and cost-per-run = `costMinorTotal / totalRuns`). Phase 2 threads the target through the
   agent-detail API and colors the existing metric tiles against it.

3. **Missing-data reuses a warn proxy now, a deferred abstain state later.** Phase 1 records
   missing-data conditions as non-blocking `warn` assertions — concretely, a `min_confidence` scorer at
   a low threshold as the **abstain proxy**: a run scoring below it is flagged (warn) but not gated, so
   it is visible without blocking production. The genuinely new run-level `insufficient_data`
   disposition and grounding-set wiring are deferred to Phase 3.

### Authoring surface (two parsers, kept byte-for-byte in sync)

**File agents — a heading-anchored JSON section in `OUTCOME.md`.** The current parser slices everything
after the first ` ```json ` fence into `prose` and injects it into the OpenCode prompt
(`defineFileAgent.ts:121`, mirror at `agent-files.ts:196`). A bare second ` ```json ` fence would
therefore leak into the prompt. Instead the author adds a recognized heading:

```md
---
kind: actionable
---
```json
{ "type": "object", "required": ["actions","confidence","rationale"], "properties": { … } }
```

Human guidance the agent should read goes here.

## Quality contract
```json
{
  "successConditions": [
    { "key": "required_keys", "config": { "requiredKeys": ["actions","confidence","rationale"] } },
    { "key": "min_confidence", "config": { "threshold": 0.6 }, "description": "Confident enough to act on." }
  ],
  "missingDataConditions": [
    { "key": "min_confidence", "config": { "threshold": 0.4 },
      "description": "Below this the agent likely lacked grounded context — flag for review. Phase-1 warn proxy; Phase 3 upgrades to abstain." }
  ],
  "failureConditions": [
    { "key": "no_pii", "description": "Never leak PII into a proposal." }
  ],
  "qualityGoals": { "correctnessPct": 90, "maxLatencyMs": 8000, "maxCostMinor": 200 }
}
```
```

The parser finds the `## Quality contract` heading and parses the **following** ` ```json ` fence into
the contract, then **excises that heading + fence span from `prose`** so it never reaches
`renderOutcomeSection` (`defineFileAgent.ts:130`) and never appears in the rendered OpenCode `.md`
(`renderOpenCodeAgentFile`). The first ` ```json ` fence (the result schema) is untouched.

**Excision semantics.** The excised span is exactly `[heading line … end of the immediately following
fence]`. Prose **before** the heading and prose **after** the closing fence are preserved verbatim; only
the contract block is removed. Tolerance differs by call site, exactly like `assertOutcomeSchemaSupported`
does for the result schema today:

- **Core loader** (`defineFileAgent.ts`) tolerates a malformed `## Quality contract` block → contract
  `undefined` + `console.warn` (the agent still loads, like the existing `parseOutcomeMarkdown` null
  paths). The warn **names the agent dir only** and does NOT dump the block contents (author metadata
  stays out of logs).
- **CLI generator** (`agent-files.ts`) **throws** (fails `yarn generate` loudly, naming the dir),
  mirroring `assertOutcomeSchemaSupported` (`agent-files.ts:211`).

**Heading-collision note (BC).** Once shipped, the literal `## Quality contract` heading is a parse
anchor (see BC). An existing `OUTCOME.md` that already happens to use that exact heading for human prose
would now be parsed and excised — the one case where "loads byte-for-byte unchanged" does not hold. The
repo's current OUTCOME files do not use that heading; the parser only acts on it when the following fence
is valid JSON, otherwise it warns/throws per the tolerance above.

**In-process agents — a `quality?` field on `DefineAgentInput`.** `DefineAgentInput` (`defineAgent.ts:27`)
gains an optional `quality?: OutcomeQualityContract` sibling to `result`. Authored on an existing example
agent in `apps/mercato/src/modules/agent_examples/ai-agents.ts` as the worked in-process example.

### Compile conditions → eval assertions (`lib/eval/declaredConditions.ts`, new)

A new module mirroring `syncGroundingSets`:

- `syncDeclaredConditions(em, scope)` is an **intentionally plain utility, not an Awilix-registered
  service** — it runs at setup time in `setup.ts` `seedDefaults` with no request scope, exactly like
  `syncGroundingSets`. It does `await ensureAgentsLoaded()`, then for every `AgentRegistryEntry` that
  carries a `qualityContract`, upserts per-agent `AgentEvalAssertion` rows. For each condition:
  `appliesTo = entry.id`, `type = 'deterministic'`, `severity = condition.severity ?? (declaredAs ===
  'missing_data' ? 'warn' : 'gate')`, `config = { ...condition.config, scorer: condition.key,
  declaredAs }`. **Reuse:** `evaluateRun` reads `config.scorer` and the existing pure scorer runs
  unchanged.
- **Key namespace `declared.<declaredAs>.<scorerKey>.<ordinal>`** (e.g.
  `declared.success.required_keys.0`), where `declaredAs ∈ { success, missing_data, failure }` and
  `ordinal` disambiguates repeated scorers within a bucket. Because `key` is constrained to the known
  scorer-key enum (Contract / data model), it cannot inject `.` separators or a `declared.` prefix into
  this composite — the namespace parse and the `LIKE 'declared.%'` reconcile match stay sound. The
  composite fits the existing unique index `agent_eval_assertions_key_uq = (organizationId, appliesTo,
  key)` (`data/entities.ts:423`), so the upsert is idempotent.
- **Atomic per-agent convergence.** Each agent's upserts **and** its reconcile run inside a single `em`
  transaction, ordered **upsert-then-disable** (never disable-then-upsert), so a mid-loop crash never
  leaves an agent ungated between writes; a re-run on the next setup re-converges idempotently.
  Convergence is all-or-nothing per agent — there is no partial-undo granularity within one agent.
- **Re-enable on re-declare.** `deletedAt` is **not** part of the unique key, so a soft-disabled
  `declared.*` row still occupies its key. When an author removes a condition and later re-adds the
  identical one, the upsert hits the disabled row and MUST reset `enabled = true` and `deletedAt =
  null`, otherwise the re-declared gate would stay inert.
- **Reconcile ONLY within `appliesTo = entry.id` AND `key LIKE 'declared.%'`.** Rows no longer declared
  are soft-disabled (`enabled = false`, `deletedAt` set) so a removed condition stops gating. The sync
  **never** touches the human-seeded `*` defaults (`defaultAssertions.ts`) or operator-created rows.
- **Unknown scorer key → skip + warn**, matching `evaluateRun`'s tolerant `if (!scorer) continue`
  (`evalRuntimeService.ts:55`). The zod enum already rejects unknown keys at validation time; the
  runtime skip is defense-in-depth for forward-compat keys.
- Wired in `setup.ts` `seedDefaults`, immediately after `seedDefaultEvalAssertions` (`setup.ts:107`) and
  `syncGroundingSets` (`:116`). Idempotent. **No DB migration** (reuses `agent_eval_assertions`).

### Quality goals → target-vs-actual (Phase 2 surfacing)

- Target = `entry.qualityContract.qualityGoals` (registry metadata; no new table).
- Actuals = `computeAgentMetrics` via the existing `/api/agent_orchestrator/agents/{id}/metrics` route.
- Agent detail page (`backend/agents/[id]/page.tsx`): replace the three `PendingChip "Needs backend"`
  tiles — **Eval pass**, **Latency**, **Cost/run** — with live values colored against `qualityGoals`
  using **semantic status tokens** (`text-status-error-text` / `text-status-success-text`), and add a
  "Quality goals" + declared-conditions section near Tools/Skills (`:294-375`) built from the existing
  `SectionHeader` primitive. Per-run attainment already renders in the trace-eval panel
  (`backend/traces/[id]/page.tsx:224`) because declared conditions produce ordinary `AgentEvalResult`
  rows.

## Contract / data model

### Declared field shapes — `lib/sdk/outcomeSchema.ts` (new exports, additive)

```ts
/** A declared success/failure/missing-data condition. References an EXISTING deterministic scorer key. */
export type DeclaredCondition = {
  /** An existing scorer key in lib/eval/scorers.ts. Constrained to the enum by zod (see below). */
  key: 'output_present' | 'required_keys' | 'min_confidence' | 'no_pii'
  /** Scorer params, e.g. { requiredKeys: [...] } or { threshold: 0.7 }. */
  config?: Record<string, unknown>
  /** = AgentEvalSeverity. Defaults: gate for success/failure, warn for missing-data. */
  severity?: 'gate' | 'warn'
  /** Author note, surfaced verbatim in operator UI (plain text); NEVER injected into the prompt. */
  description?: string
}

/**
 * Declared TARGETS, compared against KPI actuals. NOTE: correctnessPct is a PROXY — it is compared to
 * evalPassRate*100, which measures declared-gate satisfaction, not factual correctness. Because those
 * gates are themselves author-declared, the answer is partly self-defined; treat it as "meeting its own
 * contract", not an independent ground-truth accuracy.
 */
export type QualityGoals = {
  correctnessPct?: number   // 0–100 target, compared to evalPassRate*100 (proxy; see note)
  maxLatencyMs?: number     // ≥0, compared to avgLatencyMs
  maxCostMinor?: number     // ≥0 minor units, compared to cost-per-run = costMinorTotal / totalRuns
}

export type OutcomeQualityContract = {
  successConditions?: DeclaredCondition[]
  missingDataConditions?: DeclaredCondition[]
  failureConditions?: DeclaredCondition[]
  qualityGoals?: QualityGoals
}
```

A new zod `outcomeQualityContractSchema` in `data/validators.ts` validates shape + range:
`correctnessPct` 0–100, `maxLatencyMs`/`maxCostMinor` ≥ 0, and each condition `key` constrained to the
**scorer-key enum** (`z.enum(['output_present','required_keys','min_confidence','no_pii'])`) so an author
cannot inject separators or unknown keys. It validates **declared metadata only** — it is NOT part of
`agentResultSchema`/`baseAgentResultSchema` and does NOT go through `compileOutcome`.

**Naming note.** The authoring alias is `quality?` on `DefineAgentInput` (sibling to `result`, for author
ergonomics), while the carried/stored field is `qualityContract?` everywhere downstream (descriptor,
registry, API) so it is self-describing. The mapping `input.quality → entry.qualityContract` is explicit
and one-way. `QualityGoals` is intentionally plural — it aggregates several distinct goal fields
(correctness, latency, cost); every other new identifier is singular.

### Where the contract is authored vs. parsed

| Surface | Authored as | Parsed by | Excised from prompt? |
|---|---|---|---|
| File agent | `## Quality contract` JSON section in `OUTCOME.md` | core `parseOutcomeMarkdown` (`defineFileAgent.ts:106`) + CLI mirror (`agent-files.ts:179`) | **Yes** — span removed from `prose` |
| In-process agent | `quality?: OutcomeQualityContract` on `DefineAgentInput` | `defineAgent` (`defineAgent.ts:104`) | N/A (never in a prompt) |

### Carry-through chain (every hop OPTIONAL → additive)

```
OUTCOME.md  ──parse──▶  OutcomeDescriptor.quality?        (defineFileAgent.ts:87, local non-exported type)
                          │
                          ▼
                        FileAgentDescriptor.qualityContract?    (runtime-consumed type, REGENERATED)
                          │  the consumed type lives in generated/file-agents.generated.ts:33 but is
                          │  EMITTED from the CLI descriptor template (agent-files.ts:763 via
                          │  renderDescriptor:687) — it is not a hand-maintained copy.
                          ▼
                        AgentRegistryEntry.qualityContract?     (defineAgent.ts:80)
                          ├─ set in loadFileAgents (defineAgent.ts:330) from descriptor.qualityContract
                          └─ set in registry.set  (defineAgent.ts:129) from input.quality
```

**Atomic edit set.** The change spans: both OUTCOME parsers (`defineFileAgent.ts` ⇄ `agent-files.ts`),
the descriptor **template** (`agent-files.ts:763`, emitted via `renderDescriptor:687`), the CLI
`DiscoveredAgent` type (`agent-files.ts:54`, carried from the primary scan `:867` and the sub-agent scan
`:528`), and `DefineAgentInput` / `AgentRegistryEntry` — then `yarn generate` regenerates
`file-agents.generated.ts`. The parity guard targets **template ⇄ regenerated runtime-consumed type**,
not "hand-edit two copies." (A contract on a sub-agent is permitted and carried, gating that sub-agent's
own runs.)

### `syncDeclaredConditions` — the code-first sync (mirrors `syncGroundingSets`)

| Aspect | This spec | Mirror reference |
|---|---|---|
| Source | every `AgentRegistryEntry.qualityContract` | `listGroundingSets()` |
| Target table | `agent_eval_assertions` (reused) | `agent_guardrail_sets` |
| Scope | per `(tenantId, organizationId)` | same |
| Key | `appliesTo = entry.id`, `key = declared.<declaredAs>.<scorer>.<ordinal>` | `(org, capability, version)` |
| Idempotency | unique `(org, appliesTo, key)` upsert; re-enables disabled rows on re-declare | content-hash version |
| Atomicity | per-agent upsert+reconcile in one `em` transaction, upsert-then-disable | per-set write |
| Reconcile | soft-disable stale rows WHERE `appliesTo = entry.id AND key LIKE 'declared.%'` | append-only versions |
| Tolerance | unknown scorer key → skip + warn (also rejected by the zod enum) | non-factual → null |
| Wiring | `setup.ts` `seedDefaults`, after grounding sync | `syncGroundingSets` at `setup.ts:116` |

## Commands & mutations

The sync writes are **not** routed through the command pattern, and this is deliberate (N/A
justification): `syncDeclaredConditions` is **setup/seed-time declarative convergence** — it mirrors
`syncGroundingSets` and `seedDefaultEvalAssertions`, neither of which is a user-triggered command. There
is no interactive actor, no per-action undo surface, and no command audit entry to emit.

- **Cross-module isolation.** No new cross-module relationship is introduced: `agent_eval_assertions`
  belongs to `agent_orchestrator`, the sync writes its own table, and the worked examples in
  `apps/mercato/src/modules/agent_examples` already depend on the orchestrator SDK. There is no new
  direct-ORM coupling for `packages/core/src/__tests__/module-decoupling.test.ts` to flag.
- **Undo / reversibility.** The only write is the idempotent convergent upsert. Reversibility = remove
  the declaration from the file/registry and re-sync (the stale row is soft-disabled, then re-enabled if
  re-declared). There is no manual undo because the agent definition is the source of truth.

## Phasing (testable steps)

### Phase 1 — declared conditions → eval gate (smallest ENFORCED slice)

1. Add `DeclaredCondition` / `QualityGoals` / `OutcomeQualityContract` types to `lib/sdk/outcomeSchema.ts`
   and `outcomeQualityContractSchema` to `data/validators.ts`.
   → verify: types compile; zod rejects `correctnessPct: 120`, a condition with a non-enum `key`, and a
   `key` containing a `.`.
2. Extend BOTH OUTCOME parsers to recognize `## Quality contract`, validate the block, and **excise it
   from `prose`** (preserving prose before the heading and after the fence). Core tolerates malformed →
   `undefined` + dir-only warn; CLI throws.
   → verify: parser unit tests (core + CLI parity), including the **"quality JSON must NOT appear in
   `prose` / rendered `.md`"** assertion.
3. Thread `quality` / `qualityContract` through `OutcomeDescriptor` → the descriptor **template**
   (`renderDescriptor` emits it) → `DiscoveredAgent` → `AgentRegistryEntry`; add `quality?` to
   `DefineAgentInput`; run `yarn generate`.
   → verify: `yarn build:packages && yarn generate` (enterprise flags ON) → manifest gains
   `qualityContract`; `docker/opencode/agents/*.md` UNCHANGED; the regenerated runtime-consumed type
   type-checks; `getAgentEntry(id).qualityContract` populated for file + in-process examples.
4. Add `lib/eval/declaredConditions.ts` `syncDeclaredConditions` (transactional, re-enabling) and wire it
   in `setup.ts` `seedDefaults` after `syncGroundingSets`.
   → verify: sync test (mirror `eval-assertion-management.test.ts`) — creates `declared.*` rows
   (`appliesTo = entry.id`); re-run = 0 new; edit a condition → row updated; remove → stale row disabled;
   **declare → remove → re-declare → row active again**; unknown scorer → skip + warn; `*` defaults
   untouched.
5. **Eval-assertions write guard.** Add a before-write guard on the eval-assertions CRUD route
   (`api/eval-assertions/route.ts`, `makeCrudRoute`, gated `agent_orchestrator.eval.manage`) that rejects
   `PUT`/`DELETE` (and key-targeting `POST`) where `key LIKE 'declared.%'`, returning a clear 4xx
   ("declared conditions are managed by the agent's quality contract; edit the agent, not the
   assertion"), and flags those rows `managedBy: 'quality_contract'` in the list response so the UI can
   badge them read-only.
   → verify: route test — `PUT`/`DELETE` on a `declared.*` row is rejected; non-declared rows unaffected.
6. **Trace-panel label.** Map `declared.*` verdicts to a human-readable label in the trace-eval panel
   (`backend/traces/[id]/page.tsx`): use the condition `description` when present, else a humanized scorer
   label — never the raw `declared.success.required_keys.0` key.
   → verify: trace-panel test asserts the readable label renders for a `declared.*` result.
7. Author the two worked examples: the `## Quality contract` block (success + missing-data warn proxy +
   failure) in `apps/mercato/src/modules/agent_examples/agents/deals_health_check/OUTCOME.md` and the
   `quality` field on an existing `defineAgent` example in `…/agent_examples/ai-agents.ts`.
   → verify: deterministic eval test (mirror `eval-runtime.test.ts`) — seed an `AgentRun` + synthetic
   `output`, run `evaluateRun`, assert `declared.*` `AgentEvalResult` rows exist and `run.evalPassed` is
   ANDed from the gate verdicts (no live OpenCode execution).
8. **Authoring-skill update (same branch).** Add a "Step 3b — Declare success / missing-data / failure
   conditions + quality goals" subsection to `…/.ai/skills/om-create-opencode-agent/SKILL.md` teaching
   the `## Quality contract` block and the in-process `quality` field. **Generic — no client names.**

### Phase 2 — quality-goal targets + agent-detail surfacing

1. Thread `qualityContract` (nullable) through `agentDetailSchema` (`api/agents/[id]/route.ts:21`) → the
   GET response (`:72`) → `components/types.ts` `AgentDetailView` (`:105`) + `mapAgentDetail` (`:252`).
   Because the route's existing `openApi` already declares `agentDetailSchema` as its 200 response, the
   OpenAPI surface updates automatically; no separate `openApi` edit is required. No new error paths; no
   contract → `null`.
   → verify: route unit test returns the contract; `mapAgentDetail` maps it; no contract → `null`.
2. Fill the three `PendingChip "Needs backend"` tiles (Eval pass / Latency / Cost/run) from
   `/agents/{id}/metrics` via `apiCall` / `apiCallOrThrow` (never raw `fetch`) and color against
   `qualityGoals` with semantic status tokens; add the "Quality goals" + declared-conditions section.
   - **DS primitives:** the section heading uses the existing `SectionHeader`
     (`@open-mercato/ui/backend/SectionHeader`, matching Tools/Skills/Instructions); breach/met state
     uses the already-imported `StatusBadge`; unavailable metrics keep the existing local `PendingChip`;
     when no contract is declared the section is omitted. Icons from `lucide-react` on the `size-{4|5}`
     scale, never inline `<svg>`. Run `om-ds-guardian`.
   - **i18n keys** (`agent_orchestrator.agentDetail.quality.*`): `heading`, `evalPass`, `latency`,
     `costPerRun`, `target`, `actual`, `met`, `breach`, `conditions`, `noContract`. The author
     `description` is rendered **verbatim** (author content, not translated).
   - **RBAC dependency (new client call).** The detail page is gated `agent_orchestrator.agents.view`,
     but `/agents/{id}/metrics` is gated `agent_orchestrator.trace.view`. A user with `agents.view` but
     not `trace.view` gets a 403 on the metrics fetch. **Behavior:** degrade gracefully — keep the tiles
     in the `PendingChip` empty state and show declared **targets only**; do not block the page or
     escalate the page's feature requirement.
   → verify: tile coloring reflects the metrics route's real actuals (not static props); tile turns
   `text-status-error-text` on breach, `text-status-success-text` on met; 403 on metrics degrades to
   `PendingChip`; DS-guardian clean.

#### Frontend Architecture Contract (Phase 2)

| Route | Server root | Island | Data owner |
|---|---|---|---|
| `/backend/agents/[id]` | none (page is a client root) | existing `AgentDetailPage` client | `GET /agents/{id}` + `/agents/{id}/metrics` via `apiCall` |

- **`"use client"` ledger.** `backend/agents/[id]/page.tsx` is **already** a `"use client"` page root at
  line 1 (523 LOC) with client-side `apiCall` fetch/render. This spec adds **0 new** `"use client"` roots
  and introduces **no heavy deps**. Refactoring it to a server root is **out of scope** here.
- **Budget.** 0 new client roots. The touched file exceeds the 300-LOC client-blob guardrail, but this is
  a **pre-existing** condition (no split is in scope for this change) — recorded here as an acknowledged
  exception, not a silent breach.
- **Verification.** Keep the detail-page render/hydration smoke for the changed route and require
  `yarn check:client-boundaries` clean.

3. Optional `apps/docs` page documenting the contract (none exists today).

### Phase 3 — run-level abstain (DEFERRED)

Upgrade missing-data from the Phase-1 warn proxy to (a) grounding-set wiring for factual agents and (b) a
real run-level `insufficient_data` / abstain disposition. **Pre-registered as a non-trivial change, not a
free addition:** adding `insufficient_data` to the DB-persisted `AgentRunStatus` enum
(`data/entities.ts`) requires a **consumer audit** — exhaustive `switch` readers, the trace UI, stored
status-value readers, and metrics rollup buckets must all handle the new value. Out of scope until Phase
1+2 land; tracked as its own follow-up.

## Performance & scale

- **Sync cost.** `syncDeclaredConditions` runs in `seedDefaults` per `(tenant, organization)` and loops
  every `AgentRegistryEntry × conditions`. Expected volume is bounded by agents × conditions (low tens),
  which justifies foreground execution. Existing `declared.*` rows for an agent are fetched **once per
  agent** (one query per `appliesTo`) and reconciled in memory — no per-condition N+1.
- **Reconcile index support.** The reconcile scans `WHERE appliesTo = entry.id AND key LIKE 'declared.%'`.
  The existing unique index `(organizationId, appliesTo, key)` serves this as a left-prefix range, so the
  soft-disable is not a full table scan.
- **Cache.** Neither `agent_eval_assertions` nor `computeAgentMetrics` results are tag-cached today, so
  the sync write path introduces **no cache-invalidation obligation**. If metric caching is added later,
  the sync must list the corresponding tag invalidations.

## Backward compatibility & migration

- **Every new field is OPTIONAL at every hop** → additive per BACKWARD_COMPATIBILITY.md §2 (types) and
  §14 (generated files / manifests). Old `OUTCOME.md` (no `## Quality contract`), old
  `file-agents.generated.ts` manifests (no `qualityContract`), and old in-process agents (no `quality`)
  all load **byte-for-byte unchanged** — the contract resolves to `undefined` and `syncDeclaredConditions`
  writes nothing for that agent. (The single exception is the heading-collision case described in the
  authoring surface.)
- **No DB migration.** Conditions reuse `agent_eval_assertions`; the `declared.*` key namespace fits the
  existing unique index `(organizationId, appliesTo, key)`. Quality goals are registry metadata, not a
  row.
- **Atomic-change constraint (FROZEN parity surfaces).** The TWO OUTCOME parsers and the descriptor
  template (which emits the regenerated runtime-consumed `FileAgentDescriptor` type) MUST change in the
  same PR; a parity unit test guards drift. The generated manifest is regenerated by `yarn generate`,
  never hand-edited.
- **`## Quality contract` is a frozen parse anchor post-release.** Like the result-schema fence, the
  literal heading string becomes a contract surface: renaming it would break every authored `OUTCOME.md`.
  It is additive (old files lacking the heading still parse); changing the token follows the deprecation
  protocol.
- **`declared.*` rows are sync-owned.** They are written only by `syncDeclaredConditions` and rejected by
  the eval-assertions CRUD write guard (Phase 1 step 5). They are therefore outside the operator
  optimistic-lock surface by construction — there is no second human writer to produce a lost update; the
  sync is authoritative-by-key and re-converges every setup.
- **First-gate transition.** `evalPassed` is `null` when no `gate` applies; the lifecycle gate treats only
  `false` as a hard fail. Declaring a **satisfiable** gate is safe (run → `true`); the meaningful behavior
  change is that the **act of declaring any gate** first subjects the agent to hard-fail semantics
  (`null → true/false`). Authors should expect this.
- **Future removal would be breaking.** Once published, `qualityContract` on `FileAgentDescriptor` /
  `AgentRegistryEntry` and `quality` on `DefineAgentInput` are STABLE contract surfaces; removing them
  follows the deprecation protocol (deprecate → bridge ≥1 minor → RELEASE_NOTES). The `declared.*` key
  namespace is likewise reserved.

## Integration & test coverage

**Affected API paths.**
- `GET /api/agent_orchestrator/agents/{id}` — Phase 2 adds `qualityContract` to `agentDetailSchema` + the
  response (OpenAPI auto-covered).
- `GET/PUT/DELETE /api/agent_orchestrator/eval-assertions` — the list now returns sync-authored
  `declared.*` rows (flagged `managedBy: 'quality_contract'`); the write guard rejects `PUT`/`DELETE` on
  them.
- `GET /api/agent_orchestrator/agents/{id}/metrics` — **consumed** by Phase 2 (route unchanged); note it
  is gated `trace.view`, not `agents.view` (RBAC degrade above).

**Affected UI.** Agent detail page (`backend/agents/[id]/page.tsx`) — metric tiles + Quality-goals
section. Trace detail eval panel (`backend/traces/[id]/page.tsx`) — Phase 1 adds a human-readable label
for `declared.*` verdicts.

**Tests.**
- **Parser unit tests (core + CLI parity)** — with / without `## Quality contract`; malformed block (CLI
  throws naming the dir, core tolerates → `undefined` + dir-only warn); prose preserved before/after the
  span; and an explicit assertion that the **quality JSON does NOT appear in `prose` nor in the rendered
  OpenCode `.md`** (governance metadata must never reach the prompt).
- **Manifest round-trip** (extend `agent-files-extension.test.ts`) — `renderDescriptor` emits
  `qualityContract`; the parsed contract survives the template → regenerated-type round-trip (the
  regression guard for the parity claim).
- **Sync test** (mirror `__tests__/eval-assertion-management.test.ts`) — declared contract creates
  `declared.*` rows (`appliesTo = entry.id`); idempotent re-run (0 new); edit updates the row; remove
  soft-disables; **declare → remove → re-declare re-enables**; unknown scorer key skipped with a warn; `*`
  defaults untouched.
- **Eval-assertions write guard test** — `PUT`/`DELETE` on a `declared.*` row rejected; non-declared rows
  editable.
- **Deterministic eval test** (mirror `eval-runtime.test.ts`) — seed an `AgentRun` + synthetic `output`,
  run `evaluateRun`, assert `declared.*` `AgentEvalResult` rows exist and `run.evalPassed` is ANDed from
  the gate verdicts. No live model execution.
- **Trace-panel label test** — a `declared.*` result renders the `description`/humanized label, not the
  raw key.
- **Phase 2 route/mapper test** — `GET /agents/{id}` returns the contract; `mapAgentDetail` maps it; no
  contract → `null`.
- **Phase 2 detail-page Playwright integration test** (`om-integration-tests`, against the ephemeral env)
  — load `/backend/agents/{id}` for an agent with `qualityGoals`; assert the three tiles render
  **target-vs-actual** reflecting the metrics route's real `evalPassRate` / `avgLatencyMs` / cost-per-run
  (not static props); a breached target renders `text-status-error-text` and a met target
  `text-status-success-text`; `om-ds-guardian` clean.

## Security / tenancy

- Declared conditions compile to **per-(tenant, organization)** `agent_eval_assertions` rows, synced in
  `setup.ts` `seedDefaults` exactly like grounding sets and default assertions — never global
  `module_configs` (which would leak across tenants, per the note at `setup.ts:98-105`). `evaluateRun`
  filters every assertion query by `tenantId` + `organizationId` (`evalRuntimeService.ts:38-45`).
- **Encryption.** `agent_eval_assertions` is intentionally excluded from the module's
  `defaultEncryptionMaps`; the synced `config` (field-name lists / thresholds) and `description` (author
  note) are author governance metadata, never PII or runtime output. No `encryption.ts` change.
- The `description` is **author content**, not user input, and carries no PII. It is rendered as **plain
  text via React escaping** (no `dangerouslySetInnerHTML`) and is **excised from the prompt**, so it is
  neither an XSS nor a prompt-injection vector.
- **RBAC.** The detail route keeps `requireFeatures: ['agent_orchestrator.agents.view']`. The Phase-2
  metrics fetch depends on `agent_orchestrator.trace.view`; a holder of `agents.view` only degrades to the
  empty-tile state (above) rather than seeing an error. The sync runs in the trusted module-setup context.
- Declared conditions cannot widen agent capability — they only add scorer-based gates/warns. They never
  touch the propose-only mutation gate, tool allowlist, or `compileOutcome`.

## Risks & impact review

#### Mis-authored gate condition flips evalPassed for every run
- **Scenario**: an author declares a `gate` success condition the agent can never satisfy (e.g.
  `required_keys` naming a key the schema doesn't emit); every run gets `evalPassed = false` and is parked
  / flagged.
- **Severity**: Medium
- **Affected area**: one agent, within one tenant/org (assertion rows are per-agent, per-tenant).
- **Detection**: the Phase-2 agent-detail **Eval-pass tile** is itself the signal — a gate misconfiguration
  shows as a sharp pass-rate drop against the declared `correctnessPct` target; the trace-eval panel shows
  exactly which declared condition failed per run.
- **Mitigation**: conditions are opt-in; missing-data defaults to non-blocking `warn`; unknown scorer keys
  are rejected by the enum and skipped at runtime (not fail-closed); the worked examples and
  `om-create-opencode-agent` Step 3b document safe authoring. Blast radius is the declaring agent.
- **Residual risk**: an author can still gate their own agent too strictly — acceptable and visible.

#### Parser drift between the two parsers / the regenerated descriptor type
- **Scenario**: the core parser excises `## Quality contract` but the CLI mirror does not (or vice versa),
  so the manifest and the loaded entry disagree, or the JSON leaks into the rendered `.md`.
- **Severity**: Medium
- **Affected area**: file-agent loading + OpenCode prompt content.
- **Mitigation**: both parsers and the descriptor template change in one PR; a parity unit test runs the
  same fixtures through both; the explicit "quality JSON not in prose/rendered .md" and manifest
  round-trip assertions cover the leak.
- **Residual risk**: low — guarded by tests on every run.

#### Stale assertion accumulation
- **Scenario**: conditions are edited/removed across deploys, leaving orphaned `declared.*` rows that keep
  gating.
- **Severity**: Low
- **Affected area**: per-agent eval verdicts.
- **Mitigation**: transactional reconcile-within-namespace soft-disables any `declared.*` row no longer
  declared, and re-enables a matching disabled row on re-declare; idempotent re-sync.
- **Residual risk**: negligible — disabled rows are inert and auditable.

## Out of scope / future work

- **Phase 3 run-level abstain** — an `insufficient_data` `AgentRunStatus` + disposition path (with the
  consumer audit noted above), and grounding-set wiring that upgrades missing-data conditions from the
  Phase-1 `warn` proxy to a real abstain. Deferred; tracked as its own follow-up.
- **New scorers** for richer conditions (e.g. numeric-range, regex-absent) — additive, not required by v1.
- **CRUD UI** for editing the contract — intentionally code-first, like grounding sets.

## Changelog

### Review — 2026-06-26
- **Reviewer**: Incorporated four adversarial reviews (checklist, two branch-verified, BC/integration).
  Added Use-cases, Commands & mutations (N/A + isolation + undo), Performance & scale, and a Phase-2
  Frontend Architecture Contract. Replaced the bespoke compliance matrix with this block.
- **Security**: `declared.*` rows declared sync-owned with a CRUD write guard (no operator lost update);
  encryption exclusion stated; `description` rendered plain-text + excised from prompt; metrics-route RBAC
  dependency (`trace.view`) documented with graceful 403 degrade; `key` constrained to the scorer-key enum
  (no separator injection).
- **Performance**: sync volume bounded (agents × conditions, low tens); reconcile served by the
  left-prefix unique index; no cache-invalidation obligation today.
- **Cache**: N/A — neither `agent_eval_assertions` nor `computeAgentMetrics` is tag-cached; flagged for
  future metric caching.
- **Commands**: N/A justified — setup-time declarative convergence, not a user-triggered command; undo =
  remove declaration + re-sync.
- **Risks**: mis-authored gate (detection via the eval-pass tile), parser/descriptor drift (parity +
  round-trip tests), stale rows (transactional reconcile + re-enable); null→bool first-gate transition
  noted.
- **Verdict**: Ready for pre-implementation review. Phase boundaries are testable and independently
  shippable; Phase 3 is explicitly deferred with a pre-registered consumer audit.

### 2026-06-26
- Initial specification (converted from approved plan `recursive-mapping-mountain.md`). Phases 1–2 in
  scope; Phase 3 (run-level abstain) deferred.
</content>
