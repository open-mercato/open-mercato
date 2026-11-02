# Agent Taxonomy and the Proposal Envelope (W2)

**Date:** 2026-08-11 · **Status:** implemented (Phases 1–4) — not yet moved to `implemented/`
**Umbrella:** [`2026-08-10-pre-release-remediation-plan.md`](./2026-08-10-pre-release-remediation-plan.md) — workstream W2
**Companion:** [`2026-08-11-triggered-process-model.md`](./2026-08-11-triggered-process-model.md) (W1) consumes this envelope.
**Ordering:** independent in *scope* — W1 needs none of the agent types, W2 needs none of the process model. The one coupling is the migration: this spec owns its own alter for `selected_option_id` and `agent_type` rather than folding into W1's squash, so neither has to wait. If both land in the same release, the squash absorbs them and the alter is deleted.
**Scope:** enterprise `agent_orchestrator`, plus branch-only disposition surfaces in core `workflows`

## TLDR

Three named agent types replace the two-way `informative`/`actionable` split: **Researcher** (renamed from `informative`), **Decision-maker** and **Action agent**. All three stay propose-only.

The larger change is underneath. A proposal today is a **conjunction** — `actions: ProposedAction[]`, one confidence, one disposition, meaning "do all of these". Neither new type fits it: a decision agent that finds three plausible answers must pick one and discard its own uncertainty, which is the single most useful thing it knows. The envelope becomes **N ranked options, each carrying its own plan of actions**, of which the disposition selects at most one. Today's proposal is that shape with one implicit option, so the *data* migrates cleanly — but this is a **breaking wire change, not a strict generalization**: `{ actions }` does not validate against `{ options }`, and persisted `outputMapping` dot-paths in authored workflow definitions move with it. The cost is specified in Phase 1 rather than assumed away.

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

- **`options` may be empty.** "I considered this and have nothing to propose" is a real answer, distinct from an option with an empty action list — which is why `actions` is `.min(1)`.
  An empty set needs its own terminus, or the `WAIT_FOR_SIGNAL` step parks forever: the proposal is created with `disposition: 'none_proposed'` (a fourth stored value, never operator-settable), `autoApprovable` returns `null` without queueing it for review, and `DISPOSITION_TO_OUTCOME` (`outcome-routing.ts:211-219`) maps it onto the existing `informative`/`researcher` outcome handle — the agent looked and reported nothing, which is exactly what that route means.
- **`option.id` is stable within the proposal.** The disposition names it, audit records it, and an eval asserts against it. A positional index would silently re-point if the agent reordered.
- **Envelope confidence is derived for display, and still persisted for query.** `agent_proposals.confidence` and `agent_runs.confidence` remain written — the traces `low-confidence` facet filters on the column (`api/runs/route.ts:96`), and a jsonb scan cannot replace an indexed float. The stored value is the leader option's confidence before disposition, and the chosen option's after. "Derived" describes the render, not the row; the column is the query surface and stays authoritative for filtering.
- **Today's proposals migrate as one implicit option** — `options: [{ id: 'primary', label: <agent label>, actions: <old actions>, confidence: <old confidence> }]`. Today's `actions` may legally be `[]` (`validators.ts:17` has no `.min`), and the new `actions` is `.min(1)`, so a stored proposal with no actions backfills to `options: []` — the "nothing proposed" case above — not to an option that would fail its own schema.

### Disposition

The rule, stated once: **`selectedOptionId` is required for `approved` and `edited`, forbidden for `rejected`.** `edited` needs it because editing means choosing an option *and* changing its payload — there is nothing to edit without naming which.

This is a **diff** on the existing schema (`data/validators.ts:121-134`), which is an object plus a `.superRefine` carrying two rules that must survive: `payload` is required when `disposition === 'edited'`, and `reason` is required for `edited` and `rejected`.

```ts
export const disposeProposalSchema = z
  .object({
    disposition: z.enum(['approved', 'edited', 'rejected']),
    reason: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    selectedOptionId: z.string().optional(),          // ← added
  })
  .superRefine((value, ctx) => {
    // ── existing rules, unchanged ──
    if ((value.disposition === 'edited' || value.disposition === 'rejected') && !value.reason) { /* … */ }
    if (value.disposition === 'edited' && !value.payload) { /* … */ }
    // ── added ──
    const needsOption = value.disposition === 'approved' || value.disposition === 'edited'
    if (needsOption && !value.selectedOptionId) { /* required */ }
    if (!needsOption && value.selectedOptionId) { /* forbidden */ }
  })
```

- `approved` — run `options[selectedOptionId].actions` as authored.
- `edited` — the operator chose an option *and* changed its payload; both the original and the edit are kept, which is what makes an override a training signal rather than a lost fact.
- `rejected` — no option runs. Distinct from an empty option set: the agent offered, the human declined.

`agent_proposals` gains `selected_option_id varchar(100) null`. Existing `disposition`, `disposition_by`, `disposition_reason` are unchanged.

### Auto-approval: threshold **and** margin

`onResult` is a **`z.union`**, not an object (`packages/core/src/modules/workflows/data/activity-config-schemas.ts:156-159`), and the function this replaces opens by short-circuiting on it:

```ts
// today — lib/disposition/dispositionService.ts:57-63
function shouldAutoApprove(proposal, onResult): boolean {
  if ('alwaysAsk' in onResult) return false          // ← must survive
  if (typeof proposal.confidence !== 'number') return false   // fail-closed
  return proposal.confidence >= onResult.autoApproveThreshold
}
```

Dropping that first line would make every `alwaysAsk: true` node start auto-approving — the worst regression this module can produce. The replacement keeps both guards and extends the union's threshold arm:

```ts
// activity-config-schemas.ts — the THRESHOLD arm only; `alwaysAsk` is untouched
onResult: z.union([
  z.object({
    autoApproveThreshold: z.number().min(0).max(1),
    autoApproveMargin: z.number().min(0).max(1).default(0),
  }),
  z.object({ alwaysAsk: z.literal(true) }),
])

// lib/disposition/dispositionService.ts
function autoApprovable(options, onResult): ProposalOption | null {
  if ('alwaysAsk' in onResult) return null           // preserved, first
  if (options.length === 0) return null
  const ranked = [...options].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
  const [top, runnerUp] = ranked
  if (typeof top.confidence !== 'number') return null            // fail-closed, preserved
  if (top.confidence < onResult.autoApproveThreshold) return null
  // A near-tie is the agent saying it cannot tell them apart. Reading that as
  // certainty is how an auto-approved wrong answer happens.
  if (runnerUp && top.confidence - (runnerUp.confidence ?? 0) < onResult.autoApproveMargin)
    return null
  return top
}
```

**`autoApproveMargin` defaults to `0`, not `0.1`.** An earlier draft defaulted it to `0.1` and claimed that meant "an author who wants today's behaviour must ask for it" — which is backwards: a `.default()` changes behaviour for every existing config *without* anyone asking. `0` preserves today's rule exactly; a margin is opt-in, and the authoring UI recommends one.

A blocked auto-approval is **not** a failure — the proposal goes to a human with the reason recorded. It needs its own home: `disposition_reason` is `text` and holds the **operator's** reason, so writing a machine reason there overloads a human field and corrupts the override signal evals read. Add `auto_disposition_block varchar(20) null` (`near_tie` today, room for more), rendered in Caseload as "held for review: the agent could not separate its top two options". Silence would look like the threshold simply not being met.

### Agent types

```ts
export const agentTypeSchema = z.enum(['researcher', 'decision_maker', 'action'])
```

Declared on the **enterprise** agent definition — `defineAgent({ agentType })` from `lib/sdk/defineAgent.ts:176`, whose input type is `DefineAgentInput` (`:45`). **Not** `defineAiAgent`: that is the OSS `ai-assistant` primitive (`packages/ai-assistant/.../ai-agent-definition.ts:458`), it is present on `origin/develop` and therefore released, and an enterprise-orchestrator taxonomy field has no business on `AiAgentDefinition`. Stored on `agent_runs.agent_type` for the run record. It is an **authoring** fact; `resultKind` remains the runtime one, and the two can disagree — which is a finding, not a crash:

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

**The blast radius is ~191 occurrences across ~40 non-`dist` files, not the handful an earlier draft listed.** Enumerated so the implementer sizes it correctly:

- enterprise: `data/validators.ts:29-36,94`; `lib/sdk/defineAgent.ts:13` (`export type AgentResultKind`); `cli.ts`; `ai-tools.ts`; `generated/file-agents.generated.ts`; `agent_runs.result_kind` values
- core `workflows` lib: `outcome-routing.ts:50,211-219`, `agent-result-mapping.ts`, `agent-outcome-paths.ts`, `server-output-contract.ts`, `activity-types.ts`, `node-outcome-rows.ts`, `node-config-summary.ts`, `task-visibility.ts`, `context-ledger.ts`, plus branch-local edits in `signal-handler.ts`, `activity-executor.ts`, `step-handler.ts`
- i18n: **two** sets of five locales — `agent_orchestrator/i18n/*.json` and `workflows/i18n/*.json` (`workflows.outcomes.informative`, `en.json:1449`)

**Persisted graph data changes with it.** `AGENT_OUTCOME_KINDS` becomes `outcome:<kind>` source-handle ids in authored workflow definitions (`agent-outcome-paths.ts`), so any definition drawn on this branch stores the old string in its edges. Phase 3 therefore carries a **graph-edge migration** rewriting `outcome:informative` → `outcome:researcher` in stored definitions — without it, an existing canvas silently loses its informative route.

No bridge, no dual-accept: verified that none of these carry `informative` on `origin/develop`, so every site is branch-only. `actionable` disappears entirely, replaced by the two proposing types.

**Sequencing note.** This rename stamps an *authoring* word onto `AGENT_OUTCOME_KINDS`, which is a *runtime* surface — the very separation this spec argues for elsewhere. It is accepted because the umbrella locked "rename everything, wire values included", but it is the least valuable and riskiest third of W2, so it lands **last** (Phase 3) and is separately revertible.

## Architecture notes

- **No new module coupling.** The catalogue is read through the existing core `workflows` export the AI drafter already uses; enterprise → core is the established direction.
- **Events.** `agent_orchestrator.proposal.*` ids are unchanged. Payloads gain `optionCount` and `selectedOptionId` — additive.
- **Encryption.** `agent_proposals.payload` already carries the envelope and inherits the module's existing map; `options[]` moves inside the same column, so no new sensitive-field declaration is required. Confirm against `<module>/encryption.ts` during Phase 1 rather than assuming.
- **Undo.** Disposition is already undoable through the command path; `selectedOptionId` joins the `before`/`after` snapshot so an undo restores which option was chosen, not merely that one was.

## Phasing

### Phase 1 — the envelope (no behaviour change)

1. Add `proposalOptionSchema`; rewrite `agentProposalSchema` as `{ options, rationale }`.
2. Add `selected_option_id` to `agent_proposals` via this spec's **own** alter migration. Folding it into W1's squash would make W2 Phase 1 wait on W1 Phase 1 — the dependency an earlier draft created while both headers claimed independence. If W1's squash lands first, it absorbs this and the alter is deleted.
3. Backfill: every existing proposal becomes one option `primary`.
4. Derived envelope confidence helper + unit tests.

**Phase 1 is not free, and an earlier draft said it was.** `INVOKE_AGENT.outputMapping` (`activity-config-schemas.ts:165-167`) holds **persisted, author-written dot-paths** into the result envelope — including `proposalPayload.*`. A definition mapping `proposalPayload.actions[0].payload.x` resolves to `undefined` the moment `actions` moves under `options`. So Phase 1 also carries:

- a rewrite of stored `outputMapping` values: `proposalPayload.actions[N]` → `proposalPayload.options[0].actions[N]`, matching the single-implicit-option backfill;
- a Problems-panel warning for any `proposalPayload.*` path that no longer resolves, so a mapping the rewrite could not infer is visible rather than silently null.

With those, Phase 1 ships green with the UI still rendering a single option.

### Phase 2 — disposition and auto-approval

5. `selectedOptionId` on the dispose schema, required iff `approved`/`edited`; reject otherwise with a typed 400.
6. `autoApproveMargin` on the `INVOKE_AGENT` `onResult` config; the ranked + margin rule; `near_tie` reason recorded and surfaced.
7. Server-side vocabulary re-check before the effect runs.

### Phase 3 — agent types

8. `agentTypeSchema`; `agentType` on `defineAgent`; `agent_runs.agent_type` — in the same alter as step 2 if W1's squash has not landed.
9. `allowedActions` on the agent definition; registration-time intersection with a warning on drop.
10. Rename `informative` → `researcher` everywhere including core `workflows`; delete `actionable`.

### Phase 4 — surfaces

11. Caseload renders the option set: ranked, per-option rationale and confidence, one selection control, `near_tie` explained where it applies.
12. Agents list/detail show the declared type and the narrowed vocabulary.
13. Traces shows which option was chosen and by whom (`disposition_by`).

## Data models

| Table | Column | Type | Null | Default | Notes |
|---|---|---|---|---|---|
| `agent_proposals` | `selected_option_id` | `varchar(100)` | yes | — | Set on approve/edit; `[OptionalProps]` entry required |
| `agent_proposals` | `payload` | `jsonb` | no | — | Now `{ options[], rationale? }`. Encrypted (`agent_orchestrator:agent_proposal`) — array size is a crypto cost, hence `options.max(10)` and `label.max(120)` |
| `agent_proposals` | `confidence` | `float` | yes | — | Unchanged; still the indexed query surface for the `low-confidence` facet |
| `agent_proposals` | `disposition` | `varchar(20)` | no | `'pending'` | Gains the stored value `none_proposed` (never operator-settable) |
| `agent_runs` | `agent_type` | `varchar(20)` | yes | — | Nullable: runs predating the declaration have none |

Bounds are deliberate: `options` is `.max(10)`, `option.label` `.max(120)`, `option.rationale` `.max(2000)`. Model-authored free text inside an encrypted jsonb column is unbounded input to both the crypto path and the Caseload render.

## API contracts

| Route | Change |
|---|---|
| `POST /api/agent_orchestrator/proposals/[id]/dispose` | Request gains `selectedOptionId?: string`. `400 { error, details }` when required-and-absent, forbidden-and-present, or naming an unknown option id. Existing `payload`/`reason` rules unchanged. |
| `GET /api/agent_orchestrator/proposals` | Response `payload` is now `{ options[], rationale? }`. Adds `selectedOptionId`. `confidence` unchanged. |
| `GET /api/agent_orchestrator/runs` | Adds `agentType`; `resultKind` values change (`informative` → `researcher`, `actionable` → the two proposing types) |

Cache: proposal reads are not currently cached; this spec adds none. Index: `selected_option_id` needs no index — it is only ever read with the row.

## Undo

Disposition already runs through the command path with `before`/`after` snapshots. `selectedOptionId` joins both, so an undo restores **which** option was chosen, not merely that one was. Auto-approval writes through the same command, so a `near_tie`-blocked proposal that a human then approves is one undoable transition, not two.

## Final compliance report

| Requirement | Status | Evidence |
|---|---|---|
| Singular entity naming | ✅ | `agent_proposal`, `agent_run` unchanged |
| No cross-module ORM relations | ✅ | Vocabulary read through core `workflows` exports; no relation |
| Tenant/organization scoping | ✅ | No new entity; columns join existing scoped rows |
| Zod validation | ✅ | `proposalOptionSchema`, `disposeProposalSchema` diff |
| Encryption maps | ✅ | `options[]` lands inside the already-mapped `agent_proposals.payload`; no new sensitive column |
| Canonical primitives | ✅ | `useGuardedMutation` for dispose; `DataTable`/`StatusBadge` in Phase 4 |
| Undo contract | ✅ | Section above |
| BC contract surfaces | ⚠️ | `AGENT_OUTCOME_KINDS` and stored graph-edge handles change; branch-only, verified against `origin/develop`; graph-edge migration in Phase 3 |
| Design system | ✅ | Phase 4 contract below |
| Integration coverage | ✅ | Table below |

**Non-compliant / accepted:** the `informative` rename stamps an authoring word on a runtime surface (`AGENT_OUTCOME_KINDS`). Accepted because the umbrella locked it; isolated to Phase 3 and separately revertible.

## Frontend architecture contract (Phase 4)

- **Client islands:** `ProposalOptionList` (selection state, keyboard nav), `DisposeDialog` (Cmd/Ctrl+Enter submit, Escape cancel). Everything else renders server-side.
- **Primitives:** `DataTable` for the Caseload list, `StatusBadge` for disposition and `near_tie`, `EmptyState` for `none_proposed`, `apiCall` + `useGuardedMutation` for dispose. No raw `fetch`, no bespoke table.
- **DS:** semantic status tokens only — no `text-red-*`/`bg-green-*`, no arbitrary text sizes, lucide icons, `aria-label` on every icon-only control. Boy Scout rule on touched lines.
- **i18n:** new keys across five locales — option ranking, per-option confidence, the `near_tie` explanation, `none_proposed`, and the three type labels. No hardcoded strings.

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

### Phase 4 implemented — 2026-08-11

Steps 11–13 landed; all four phases are now implemented. Six things the spec got wrong or left unsaid, recorded because the code now depends on the answers:

- **The leading-option placeholder was real, and removing it needed a rule the spec never states.** Phases 1–2 made both dispose call sites (`backend/caseload/page.tsx`, `backend/caseload/[proposalId]/page.tsx`) send `leadProposalOption(payload).id` automatically, because the endpoint 400s without one. "One selection control" does not say what is selected *initially*, and preselecting the leader would have reinstated the placeholder under a nicer name. The shipped rule: a **disposed** proposal replays the option it actually ran (`selected_option_id`); a **single-option** proposal preselects it, because there is no choice to make; a **multi-option** proposal preselects **nothing** and Approve/Edit stay disabled until a human picks. `leadProposalOption` no longer appears in either page.
- **The Caseload's `statusOf` mapped ANY unknown disposition to `approved`** — not just `none_proposed`, and `ProposalCard`'s own badge had the same defect. Both now read one shared `components/proposalCaseStatus.ts` whose default arm is `unknown` (neutral), with `noneProposed` as its own neutral badge. `none_proposed` also rejoins the `all` segment: Phase 1–2 hid it only because there was no honest status to give it, and hiding a record is the lesser of two wrongs against mislabelling it, not a destination.
- **Step 12 was unimplementable as written.** Phase 3 put `agentType` on the registry entry and on `GET /runs`, but `GET /agents` and `GET /agents/:id` projected neither it nor `allowedActions`, and the spec's API-contracts table never lists those routes. Both now emit `agentType: … ?? null` and `allowedActions: … ?? null` — where **null means "no narrowing declared" (the whole catalogue) and an EMPTY array means "nothing survived the intersection"**; collapsing those two would turn a fail-closed agent into a permissive one on screen.
- **`disposition_by` is not always a person.** An auto-approval writes the sentinel `rule:threshold` (`dispositionService.ts`), so step 13's "and by whom" renders that as *Auto-approval rule* rather than as a user id. Unresolvable user ids render raw — inventing a display name for an id we cannot resolve is worse than showing the id.
- **`mapProposal` did not carry `selected_option_id` / `auto_disposition_block`** even though `api/proposals/route.ts` had projected both since Phase 2, so no surface could have rendered either. Added to `ProposalView`.
- **Bulk approve and the row quick-action needed a skip path the UI contract does not mention.** A multi-option row has no approvable default, so the queue's row action is inert (titled with the choose-hint) and bulk approve disposes only the unambiguous rows, flashing how many were skipped. The ranked option set itself is a `radiogroup` inside the decision pane and the proposal card — **not** a `DataTable`; `DataTable` stays the queue list, which is what the frontend contract's "no bespoke table" line actually protects.

Also shipped: `DisposeDialog` (the Cmd/Ctrl+Enter + Escape reject dialog, extracted from the queue page so the two dispose surfaces cannot drift), per-option-aware editing (`deriveActionEdits`/`deriveProposedFields` read the CHOSEN option, not the leader), an `agentType` column + filter facet on the Agents list, and the `near_tie` explanation on both the Caseload and the trace.

### Phase 3 implemented — 2026-08-11

Steps 8–10 landed. Three decisions the spec left to the implementer, recorded because the code now depends on them:

- **`actionable` became ONE result kind, `proposal` — it did not split into `decision_maker`/`action`.** The spec's "replaced by the two proposing types" is not implementable for `resultKind`: that is the RUNTIME fact of what came back, and both proposing types return the identical envelope (this spec says so itself). A runtime value cannot carry an authoring one. So the union is `researcher | proposal`, and the authoring split lives only in `agentType`. Every `resultKind` site moved with it: `AgentResultKind`, `OutcomeKind`, OUTCOME.md `kind:`, `agent_runs.result_kind`, the workflows `AgentOutcomeContract`, and `agentOutcomeRootKey`.
- **The graph-edge migration rewrites `outcomeKind` as well as the handle id.** The spec named only the `outcome:<kind>` source handle; the value actually persisted on a transition is `"outcomeKind": "informative"` (`graph-utils.ts:565`) — the handle id is derived at render time. Both forms are rewritten, in `workflow_definitions` and `workflow_definition_drafts`, guarded by `to_regclass`.
- **The `allowedActions` intersection runs at the END of the registry load, not inside `defineAgent`.** `defineAgent` is synchronous; the catalogue lives in core `workflows`, an OPTIONAL peer reachable only through a dynamic import. `ensureAgentsLoaded` is still registration time — no agent is observable before it resolves. An UNAVAILABLE catalogue leaves the declaration untouched instead of emptying it, because emptying destroys the author's list permanently while the disposition-time check already fails closed.

Also shipped beyond the letter of the phase: an `action_vocabulary` eval scorer (the spec's Integration-coverage row "a `decision_maker` proposing an out-of-vocabulary action is a failed assertion" needed a scorer to exist), `ScorerRunView.agentType`, and `agentType` on the `GET /runs` projection + filter.

### Review — 2026-08-11

Independent fresh-context review (checklist §1 scope cohesion + full compliance gate). Accepted and applied: the `alwaysAsk` short-circuit the replacement `autoApprovable` had dropped — every `alwaysAsk: true` node would have started auto-approving, the worst regression this module can produce; `onResult` being a `z.union` rather than an object; the dispose schema shown as a diff so the existing `payload`/`reason` `superRefine` rules survive; `defineAgent` (enterprise) rather than the released OSS `defineAiAgent`; `autoApproveMargin` defaulting to `0` rather than `0.1`, since a `.default()` changes behaviour *without* anyone asking — the opposite of what the earlier text claimed; the rename's real blast radius (~191 sites, two locale sets) and the graph-edge migration for persisted `outcome:*` handles; the `outputMapping` dot-path rewrite that makes Phase 1 actually green; terminal handling for an empty option set; `auto_disposition_block` rather than overloading the operator's `disposition_reason`; and W2 owning its own migration so the "neither blocks the other" claim is true rather than contradicted four sections later.

**Not applied — two design objections, deliberately left standing.** The reviewer argued for an additive `alternatives?: [...]` sibling instead of the `{ options[] }` rewrite, and for "never auto-approve a multi-option proposal" instead of the margin rule. Both are reasonable and both were put to the maintainer as explicit choices before this spec was written; the maintainer chose the options envelope and threshold-plus-margin. The reviewer's strongest point stands on the record regardless: the envelope change is **not** a "strict generalization" — persisted `outputMapping` paths and every producer change with it, which is why the rewrite is now specified rather than waved through.


- **2026-08-11**: Written. Gate answers: declared `agentType`; catalogue ∩ per-agent allowlist; options-with-plans envelope; threshold + margin auto-approval; separate spec from W1 with the envelope owned here.
