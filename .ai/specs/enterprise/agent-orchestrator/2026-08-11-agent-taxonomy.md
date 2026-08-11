# Agent Taxonomy and the Proposal Envelope (W2)

**Date:** 2026-08-11 · **Status:** ready to implement
**Umbrella:** [`2026-08-10-pre-release-remediation-plan.md`](./2026-08-10-pre-release-remediation-plan.md) — workstream W2
**Companion:** [`2026-08-11-triggered-process-model.md`](./2026-08-11-triggered-process-model.md) (W1) consumes this envelope; neither blocks the other.
**Scope:** enterprise `agent_orchestrator`, plus branch-only disposition surfaces in core `workflows`

## TLDR

Three named agent types replace the two-way `informative`/`actionable` split: **Researcher** (renamed from `informative`), **Decision-maker** and **Action agent**. All three stay propose-only.

The larger change is underneath. A proposal today is a **conjunction** — `actions: ProposedAction[]`, one confidence, one disposition, meaning "do all of these". Neither new type fits it: a decision agent that finds three plausible answers must pick one and discard its own uncertainty, which is the single most useful thing it knows. The envelope becomes **N ranked options, each carrying its own plan of actions**, of which the disposition selects at most one. Today's proposal is that shape with one implicit option, so the change is a strict generalization.

## Problem statement

### 1. The result kinds are not agent types

`resultKind` is a *runtime* fact — what came back. The plan asks for agent *types* — an authoring fact about what an agent is for. Today one stands in for the other, so an agent cannot be listed, filtered, constrained or validated until it has run.

### 2. The proposal envelope cannot express a choice

```ts
// data/validators.ts:9-20 (today)
proposedActionSchema = { type: string, payload: Record<string, unknown> }
agentProposalSchema  = { actions: ProposedAction[], confidence?, rationale? }
```

Persisted as one `agent_proposals` row: one `payload` jsonb, one `confidence` float, one `disposition` varchar (`entities.ts:1001-1097`).

`actions[]` is AND, never OR. Three consequences:

| Consequence | Why it matters |
|---|---|
| No alternatives | A Decision-maker with three candidate statuses must discard two. The reviewer sees a verdict, never the choice behind it. |
| One confidence per envelope | Ranked alternatives need a score each. |
| One disposition per envelope | Cannot approve action 2 and reject action 3. `edited` + a rewritten payload is the only escape, and it destroys the record of what the agent said. |

### 3. Auto-approval will silently approve coin flips

`dispositionService.ts:62` is `proposal.confidence >= onResult.autoApproveThreshold`. Applied to a ranked option set, an 0.81/0.80 split auto-approves under an 0.8 threshold — the agent is saying it cannot tell them apart, and the system reads that as certainty. This is a defect the moment options exist.

### 4. `informative` leaks past the module

`data/validators.ts:29-36` (the wire union), the `resultKind` list filter (`:94`), `agent_runs.result_kind` rows, and core `workflows` `lib/outcome-routing.ts:50,215` (a disposition kind). All branch-only, but the last is *core*, not enterprise.

## Proposed solution

### The envelope

```ts
/** One executable step within an option. Unchanged shape. */
export const proposedActionSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
})

/**
 * One mutually-exclusive alternative. `actions` is the plan that runs if this
 * option is the one chosen — a conjunction inside a disjunction.
 */
export const proposalOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  rationale: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  actions: z.array(proposedActionSchema).min(1),
})

export const agentProposalSchema = z.object({
  options: z.array(proposalOptionSchema),
  /** Why this option SET — never why one option; that lives on the option. */
  rationale: z.string().optional(),
})
```

Notes that are decisions, not description:

- **`options` may be empty.** "I considered this and have nothing to propose" is a real answer, and it is distinct from an option with an empty action list — which is why `actions` is `.min(1)`.
- **`option.id` is stable within the proposal.** The disposition names it, audit records it, and an eval asserts against it. A positional index would silently re-point if the agent reordered.
- **Envelope confidence is derived, never stored twice.** It is the chosen option's, or the leader's before disposition.
- **Today's proposals migrate as one implicit option** — `options: [{ id: 'primary', label: <agent label>, actions: <old actions>, confidence: <old confidence> }]`. Since the module is unreleased this is a data backfill in the squashed migration, not a runtime dual-read.

### Disposition

`disposeProposalSchema` gains `selectedOptionId`, required when `disposition === 'approved'` and forbidden otherwise:

```ts
disposition: z.enum(['approved', 'edited', 'rejected'])
selectedOptionId: z.string().optional()   // required iff approved | edited
```

- `approved` — run `options[selectedOptionId].actions` as authored.
- `edited` — the operator chose an option *and* changed its payload; both the original and the edit are kept, which is what makes an override a training signal rather than a lost fact.
- `rejected` — no option runs. Distinct from an empty option set: the agent offered, the human declined.

`agent_proposals` gains `selected_option_id varchar(100) null`. Existing `disposition`, `disposition_by`, `disposition_reason` are unchanged.

### Auto-approval: threshold **and** margin

```ts
// lib/disposition/dispositionService.ts
function autoApprovable(options, onResult): ProposalOption | null {
  if (options.length === 0) return null
  const ranked = [...options].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
  const [top, runnerUp] = ranked
  if ((top.confidence ?? 0) < onResult.autoApproveThreshold) return null
  // A near-tie is the agent saying it cannot tell them apart. Reading that as
  // certainty is how an auto-approved wrong answer happens.
  if (runnerUp && (top.confidence ?? 0) - (runnerUp.confidence ?? 0) < onResult.autoApproveMargin)
    return null
  return top
}
```

`onResult` gains `autoApproveMargin: z.number().min(0).max(1).default(0.1)` in `packages/core/src/modules/workflows/data/activity-config-schemas.ts:157`. Default `0.1` is deliberately non-zero: an author who wants today's behaviour must ask for it.

A blocked auto-approval is **not** a failure — the proposal goes to a human with a recorded reason (`near_tie`), which the Caseload surface shows. Silence here would look like the threshold simply not being met.

### Agent types

```ts
export const agentTypeSchema = z.enum(['researcher', 'decision_maker', 'action'])
```

Declared on the agent definition (`defineAiAgent({ agentType })`) and stored on `agent_runs.agent_type` for the run record. It is an **authoring** fact; `resultKind` remains the runtime one, and the two can disagree — which is a finding, not a crash:

| Type | Returns | Vocabulary |
|---|---|---|
| `researcher` | `{ kind: 'researcher', data }` | none — proposes nothing |
| `decision_maker` | a proposal, typically many options × one action | narrowed to status/decision commands |
| `action` | a proposal, typically few options × many actions | broader, still within the catalogue |

The type is **not** structural — both proposing types return the same envelope. What it buys: the Agents list can say what an agent is before it has run; the action vocabulary can be constrained per type; and an eval can assert that a `decision_maker` never proposed a `SEND_EMAIL`.

### Action vocabulary — catalogue bounds, allowlist narrows

```ts
effective = (listWorkflowSafeCommands() ∪ workflowActivityTypes()) ∩ agent.allowedActions
```

- The union is the **outer limit**: effects the platform already runs under its own gates (`packages/core/src/modules/workflows/lib/workflow-safe-commands.ts:70`, per-tenant and feature-checked) plus the existing activity types. An action agent therefore introduces **no new effect surface**.
- `agent.allowedActions` **narrows only, never widens**. An entry naming something outside the catalogue is dropped with a warning at registration — fail-closed, and loud, because a silently-dropped permission reads as a granted one.
- Enforced **server-side at disposition time**, not only at registration: an agent registered before a tenant revoked a safe command must not have a stale proposal execute. The check runs again before the effect.

The model never receives a mutating tool. This spec does **not** close the propose-only enforcement gap (B1) — that stays release-gating on its own track, and W2 must not be read as having addressed it.

### The `informative` rename

`informative` → `researcher` in: the wire union and `resultKind` filter (`data/validators.ts:29-36,94`), `agent_runs.result_kind` values, i18n across five locales, and core `workflows`' disposition kind + outcome routing (`lib/outcome-routing.ts:50,215`). No bridge, no dual-accept — the module is absent from `origin/develop` and the workflow surfaces are branch-only.

`actionable` disappears entirely, replaced by the two proposing types.

## Architecture notes

- **No new module coupling.** The catalogue is read through the existing core `workflows` export the AI drafter already uses; enterprise → core is the established direction.
- **Events.** `agent_orchestrator.proposal.*` ids are unchanged. Payloads gain `optionCount` and `selectedOptionId` — additive.
- **Encryption.** `agent_proposals.payload` already carries the envelope and inherits the module's existing map; `options[]` moves inside the same column, so no new sensitive-field declaration is required. Confirm against `<module>/encryption.ts` during Phase 1 rather than assuming.
- **Undo.** Disposition is already undoable through the command path; `selectedOptionId` joins the `before`/`after` snapshot so an undo restores which option was chosen, not merely that one was.

## Phasing

### Phase 1 — the envelope (no behaviour change)

1. Add `proposalOptionSchema`; rewrite `agentProposalSchema` as `{ options, rationale }`.
2. Add `selected_option_id` to `agent_proposals`; fold into the squashed migration (see W1) rather than stacking an alter.
3. Backfill: every existing proposal becomes one option `primary`.
4. Derived envelope confidence helper + unit tests.

*Ships green with the UI still rendering a single option.*

### Phase 2 — disposition and auto-approval

5. `selectedOptionId` on the dispose schema, required iff `approved`/`edited`; reject otherwise with a typed 400.
6. `autoApproveMargin` on the `INVOKE_AGENT` `onResult` config; the ranked + margin rule; `near_tie` reason recorded and surfaced.
7. Server-side vocabulary re-check before the effect runs.

### Phase 3 — agent types

8. `agentTypeSchema`; `agentType` on `defineAiAgent`; `agent_runs.agent_type`.
9. `allowedActions` on the agent definition; registration-time intersection with a warning on drop.
10. Rename `informative` → `researcher` everywhere including core `workflows`; delete `actionable`.

### Phase 4 — surfaces

11. Caseload renders the option set: ranked, per-option rationale and confidence, one selection control, `near_tie` explained where it applies.
12. Agents list/detail show the declared type and the narrowed vocabulary.
13. Traces shows which option was chosen and by whom (`disposition_by`).

## Integration coverage

Every path below ships tests in the same phase:

| Surface | Assertion |
|---|---|
| `POST /api/agent_orchestrator/proposals/[id]/dispose` | approve requires `selectedOptionId`; reject forbids it; unknown id → 400 |
| same | a vocabulary revoked after the proposal was made blocks the effect |
| `INVOKE_AGENT` auto-approve | clears threshold + margin → auto; near-tie → human with `near_tie` |
| Caseload UI | option set renders ranked; selecting and approving runs only that option's actions |
| Agent registration | `allowedActions` outside the catalogue is dropped and warned |
| Eval | a `decision_maker` proposing an out-of-vocabulary action is a failed assertion |

## Risks

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Agents emit one option forever; the envelope adds ceremony for nothing | Medium | Ship Phase 4's ranked UI with Phase 3's types so authors see the payoff; eval assertion for option count where the agent claims uncertainty | Authors may still under-use it; a prompt-level nudge is cheaper than a schema change later |
| `autoApproveMargin` default 0.1 changes existing auto-approve behaviour | Low | Module unreleased; no deployment holds a threshold today | None |
| Backfill mis-shapes a proposal | Low | Backfill runs inside the squashed migration on tables no deployment holds | None |
| Renaming the core `workflows` disposition kind breaks a released surface | Medium | `outcome-routing.ts` is branch-only — verified absent from `origin/develop`; core `/backend/tasks` and `workflows.tasks.list` are untouched | Re-verify against `origin/develop` at implementation time, not from this spec |

## Changelog

- **2026-08-11**: Written. Gate answers: declared `agentType`; catalogue ∩ per-agent allowlist; options-with-plans envelope; threshold + margin auto-approval; separate spec from W1 with the envelope owned here.
