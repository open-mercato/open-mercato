# Workflows UX Redesign — User-Centered Analysis & Complete Editor/Runtime Redesign

**Status:** Proposal (research-backed, adversarially reviewed) · **Date:** 2026-07-26
**Scope:** OSS `workflows` module (`packages/core/src/modules/workflows/`) + core-side contracts consumed by the enterprise `agent_orchestrator` (enterprise-side implementation details defer to `.ai/specs/enterprise/agent-orchestrator/`).
**Companion:** [`2026-07-26-workflows-ux-redesign-user-stories.md`](./2026-07-26-workflows-ux-redesign-user-stories.md) — 8 personas, 156 scored user stories, gap analysis. Phase exits are measured against it.
**Inputs:** issue #4251 backlog (#4229–#4250) · workflows-module code deep dive · agent-orchestrator dependency analysis · external benchmark research (n8n, Zapier, Make, Salesforce Flow, Power Automate, Camunda, Temporal, Windmill, Retool, Dify + the 2025–26 agentic wave) · three adversarial review passes (completeness, feasibility-vs-code, UX quality) applied throughout.

---

## TLDR

The workflow engine is genuinely capable (8 step types, parallel fork/join, sub-workflows with typed ports, signals, timers, saga compensation, an agent bridge) but its authoring UX is the weak layer: 7 of 8 activity types are configured through raw JSON textareas, data flow is stringly-typed `{{context.*}}` guesswork, validation fails silently (#4232), and human tasks are context-free rows split across three inboxes. 156 grounded user stories show **58% of validated needs have no covering backlog issue**. This spec proposes a full redesign around five moves: (1) a **typed context backbone** — one declarative Activity Registry plus a per-step inferred context ledger (#4245 is the keystone); (2) a **Studio** replacing both editor pages with canvas + docked inspector + synced Code view (the form editor is removed per the decided direction of #4237); (3) **decisions as routes** — conditions, activities, errors, SLA breaches, and agent outcomes as labeled edges, never string-matching; (4) **one Work Inbox** for tasks + agent dispositions with entity binding and business-context permissions (fixing the portal case #4247); (5) a **side-effect-free test loop** (dry-run with mocked effectors, per-node test, execution overlay, rerun-from-step). Rollout is 7 phases (0–6); Phases 2–4 are explicitly multi-release programs with cut lines. All definition-format evolution is additive per `BACKWARD_COMPATIBILITY.md`.

---

## Overview

The `feat/agent-orchestrator-mvp` branch makes workflows the connective tissue of the agentic platform: agents run inside workflows (`INVOKE_AGENT`), agent proposals pause workflows for human disposition, and the Agentic Tasks launcher points at workflow definitions. The OZE-client CRM demo (lead → install) exercised the module end-to-end and produced the #4251 backlog: 20 issues from a 15 Jul 2026 working session. This spec treats that backlog as ground truth about pain, then goes deeper: a persona-grounded story catalog, external benchmark research, and a redesign that covers the 91 needs the backlog misses.

**Hard constraints adopted:**
- The form-based (non-visual) editor is **removed** (user decision, extends #4237's direction). The only authoring surfaces are the visual Studio and code-level editing (JSON definitions, code-defined registry, API/MCP).
- No half-measures: the design targets the best available UX evidenced by market leaders, scoped by an explicit what-NOT-to-build list (§9.6).
- The definition JSONB, API routes, event IDs, and ACL feature IDs are contract surfaces — evolution is **additive** per `BACKWARD_COMPATIBILITY.md`.

## Problem Statement

Evidence from code, backlog, and the story catalog converges on ten pain themes (full ranking in the companion catalog §3a):

1. **No typed data context** (~26 stories) — free-form `Record<string, any>` context; hand-rolled `{{…}}` interpolation with silent pass-through on typos; no autocomplete, no schema, no discovery of upstream outputs. The sub-workflow ports contract (`workflowIoContractSchema`) is the only typed surface.
2. **JSON-first activity configuration** (~15) — every activity type except WAIT falls back to a raw JSON textarea (`ActivitiesEditor.tsx:315-336` even swallows invalid JSON silently); the activity list is duplicated across two dispatch switches, a Zod enum, and 4 UI lists with field-name drift (`retryDelay` vs `initialIntervalMs`) that produces configs failing validation.
3. **No test/debug loop** (~14) — no dry-run, no step-through, no rerun-from-step, no live updates; testing means manufacturing real domain records.
4. **Fragmented, context-free human tasks** (~13) — Task Inbox, agent Caseload, actionable notifications, and customer todos are four surfaces for one concept; a task cannot say *which customer* it concerns; a portal user could not approve her own task (#4247).
5. **Canvas ergonomics** (~12) — no undo, no copy/paste, no edge reattachment (#4233), no in-place type change (#4237), click-to-append placement, free-text lucide icon names.
6. **Agent-step contract gaps** (~11) — branching on agent outcome is string-matching merged context keys; guardrail blocks hard-FAIL the instance; `outputMapping` typos silently no-op (`agent-result-mapping.ts:38-45` warns only); the park/resume dance is emergent (1s enqueue delay, "not parked yet, retrying").
7. **Missing flow-logic primitives** (~10) — no if/else, switch, loop, or error branch; branching is priority-ordered transitions + external Business Rules.
8. **Governance blind spots** (~9) — no version diff, no edit-while-running clarity, no export/import, no definition audit UI.
9. **Zero AI-assisted authoring** (8) — despite the platform shipping an AI framework and an agent needing to author workflows programmatically.
10. **Silent validation** (~7, amplifies all others) — first-error-only flash toast; saves silently drop edits (#4232 — the reason users abandoned the visual editor).

## Research Summary

Full report retained in project history; the patterns cited throughout (numbered) come from it. The strongest signals:

- **n8n** owns data-mapping UX: input/output side panels showing real data, Table/JSON/Schema views, drag-a-field-to-generate-expression, **editable pinned sample data** ignored in production, partial "execute step" runs, executions overlaid on canvas ([docs](https://docs.n8n.io/data/data-mapping/data-mapping-ui/), [pin & mock](https://docs.n8n.io/build/work-with-data/pin-and-mock-data)).
- **Zapier** owns HITL delivery: approval steps with editable payload fields, reviewers notified via email/Slack/another-Zap, timeouts with reminders, decline-as-branch ([HITL help](https://help.zapier.com/hc/en-us/articles/38731463206029)); Copilot's **checkpoint diffs with one-click undo** are the AI-edit trust mechanism.
- **Dify's Human Input node** is the newest reference: Markdown forms with pre-filled *editable* fields, N action buttons **each mapped to a branch**, timeout as a dedicated branch ([blog](https://dify.ai/blog/the-human-input-node-bringing-human-judgment-into-automated-workflows)).
- **Camunda** owns task structure (assignee/candidate-group/priority/due-date, claim semantics, escalation modeled *in the process* via boundary timers) and Modeler "Play" testing.
- **Salesforce Flow** validates **auto-layout-first** canvases for business users and owns debugging: highlighted executed path, **rollback-mode debugging** (execute logic, roll back writes — essential in an ERP), debug-config persistence, convert-debug-run-to-test.
- **Make** owns error vocabulary: error routes as red edges + five directives (Ignore/Resume/Break-to-queue/Rollback/Commit) and the Incomplete Executions queue (visual dead-letter with edit-and-retry).
- **Temporal** owns run inspection: three altitudes (Compact / **Gantt Timeline** / Full History) with a consistent status language.
- The 2025–26 agentic wave (Lindy, Vellum, OpenAI Agent Builder, n8n AI) **converged on exactly OM's propose→disposition→effector model**; the differentiators are typed data contracts between nodes, per-action approval toggles, drafts-in-run-view, and evals wired into the builder.
- **Documented anti-patterns** this design must dodge: spaghetti free-form canvas at scale, hidden config in modals, silent validation, whitespace-over-density redesigns (Power Automate V4 rollback), test-as-live-execution, branching ceilings, opaque agent magic, canvas without diff/versioning, expression-only or structured-only mapping, approval-as-afterthought.

## Personas (summary)

| Persona | One line |
|---|---|
| **Ola** — workflow author (citizen developer; the "Wojciech" persona from the OZE demo) | Builds lead→install / order-approval flows; no code, no JSON, no ISO-8601. |
| **Marek** — developer/integrator | Code-defined workflows, custom activities, git-reviewable definitions. |
| **Kasia** — frontline task assignee | Lives in the inbox; needs *which customer, by when*; never opens the editor. |
| **Tomasz** — ops manager/approver | Approves orders and disposes agent proposals fast, with facts in front of him. |
| **Ania** — agent-ops engineer | Wires agent steps with typed I/O, routes guardrail trips, watches SLAs. |
| **Piotr** — tenant admin | Roles, permissions from business context, audit. |
| **Ewa** — portal customer | Approves her own step from the portal, mobile, zero training (#4247's broken case). |
| **Om-Agent** — the AI agent as author & consumer | Generates/edits definitions via MCP; schema quality *is* its UX. |

Full persona table and all 156 stories: companion catalog.

---

# Proposed Solution

## 1. Vision & design principles

**Vision.** One canvas that is simultaneously the place you *build*, the place you *test*, and the window through which you *watch* a process run — where every field is typed, every failure is loud, every human decision is a first-class routed step, and an AI agent is as reliable an author as a person.

| # | Principle | Rationale (evidence) |
|---|-----------|----------------------|
| P1 | **Never configure against imagined data.** | n8n I/O panels are the strongest benchmark pattern; guessing `{{context.*}}` paths is pain theme 1 (26 stories). |
| P2 | **Structured by default, expression on demand.** Never a JSON textarea as the primary surface. | Every leader converged here; 7 of 8 OM activity types are raw JSON today. |
| P3 | **Loud validation, zero silent failure.** Node badges + Problems panel the moment issues exist; publish gated; saves never silently drop — including autosaves (§4.7). | #4232; anti-pattern #3. |
| P4 | **Decisions are routes.** Human choices, agent outcomes, errors, timeouts are labeled edges — never string-matching or hidden config. | Dify buttons-as-branches, n8n error outputs, Salesforce fault connectors. |
| P5 | **The engine's registry is the editor's schema — and the agent's API.** | Kills the 6-way activity-list duplication; Om-Agent needs machine-readable contracts. |
| P6 | **Test without side effects.** Mocked-effector dry-run is mandatory in an ERP. | Salesforce rollback-mode; Make's live-run-as-test is anti-pattern #5; today's "create a fake deal each time". |
| P7 | **Auto-layout first, arrangement persisted.** | Salesforce default; spaghetti canvas is anti-pattern #1; C5/#4248. |
| P8 | **Tasks belong to the business record.** Visibility derives from entity access + assignment. | #4238/#4247; Camunda/Salesforce attach work to the record. |
| P9 | **One work inbox, many delivery channels.** Notifications/email are transport, never additional inboxes. | Four overlapping surfaces today; C3/#4246. |
| P10 | **Canvas ⇄ code are two views of one artifact.** Portable, diffable JSON; a synced Code view replaces the retired form editor; AI edits produce checkpoint diffs. | n8n workflow-as-JSON; Vellum/Windmill hybrid; Zapier checkpoints. |

**Vocabulary (used consistently in UI and this spec):** a **route** is a user-facing labeled edge on the canvas; *transition* survives only in code/API/storage. A **task** is work assigned to a human; a **proposal** is an agent's suggested mutation; a **disposition** is the human decision on a proposal (which arrives as a task). A **run** is a workflow instance presented to users. A glossary panel in the Studio documents these (and `{{workflow.*}}`/`{{env.*}}`/`{{now}}` namespaces).

## 2. Information architecture

### 2.1 Surfaces

```
┌─ Workflows (module nav) ───────────────────────────────────────────────┐
│ Definitions list ──▶ Studio (canvas · inspector · Code view · Test)    │
│ Runs (instances) ──▶ Run detail (overlay canvas · timeline · context)  │
│ Work Inbox ────────▶ unified tasks + proposals (claim/complete/dispose)│
│ Triggers overview ─▶ event ↔ workflow reverse lookup                   │
│ Templates ─────────▶ gallery (per-module seeded, import/export)        │
└────────────────────────────────────────────────────────────────────────┘
Agent orchestrator (enterprise) keeps: cockpit, traces, evals, playground.
Caseload becomes a lens over the same Work Inbox rows (§2.3, §6.3).
```

1. **Studio** (`/backend/workflows/studio?id=…`) — the single authoring surface, replacing the visual-editor page and the CrudForm create/edit pages. Three docked regions: **canvas** (center), **inspector** (right, resizable, with an **expand affordance** that widens it into a centered panel for rich editors like the task inspector; per-section collapse state remembered), **utility drawer** (bottom, collapsible: Problems · Test · Code · History). Definition metadata (name, icon, tags, triggers, context schema) lives in a left rail, collapsed by default; trigger fields `debounceMs`/`maxConcurrentInstances` get plain-language copy and safe defaults there.
2. **Run detail** — the same canvas component in overlay mode painted by execution state, plus the unified timeline (§8.3). Live via DOM Event Bridge.
3. **Work Inbox** — one queue for user tasks + agent dispositions, with claim/priority/due-date semantics (§6.2). The current `backend/tasks` route redirects here; existing instance-detail URLs keep working.
4. **Record-page surfaces** — tasks/approvals render where the work is, via widget injection (generalizing the order-approval widget and `usePersonTasks`).
5. **Templates** — seeded per module (order approval, lead routing, dunning, agent-review loop) from **Phase 1**; "New workflow" opens the template picker (blank canvas is a choice, not the default). Backed by workflow-as-portable-JSON.

**First-run/empty states:** the Definitions list empty state offers templates + "generate from prompt" (once Phase 6 lands) + a 60-second tour of the Studio regions. Every palette entry links to docs.

**Mobile:** read-only Studio + full Work Inbox (the current mobile punt made honest). Authoring is desktop-only.

### 2.2 What replaces the form editor

Two things, not one — both scheduled (Phase 1/3, §10):
- The **inspector** inherits structured, validated editing: every step/route/trigger edited in schema-driven CrudForm panels (the `NEXT_PUBLIC_WORKFLOW_CRUDFORM_ENABLED` variant finished and made the only path; the flag itself dies in Phase 0–1, §10.1).
- The **Code view** inherits bulk/power edits: the live definition JSON. It ships in two stages: **Phase 3 (retirement precondition):** read-only view + copy/paste of subgraphs + JSON-schema validation display; **Phase 5:** two-way live sync with error squiggles that highlight the corresponding node. The form editor is not retired before the Phase 3 stage exists.

### 2.3 Resolving the four-inboxes problem

| Surface today | Disposition |
|---|---|
| Workflows Task Inbox (`backend/tasks`) | **Becomes the Work Inbox** — canonical queue. Gains entity-context panel, proposal rendering, priority, claim, SLA sorting. |
| Agent Caseload (enterprise) | **A lens over the same rows** — Work Inbox filtered to `kind: agent_disposition` plus enterprise overlays (FACTS grid, traces, corrections). The disposition task and the caseload item are the same record. |
| Actionable notifications | **Demoted to transport** — deep links + limited quick actions (§6.2), never a system of record. |
| Customer todos (`CustomerTodoLink`) | **Phase-in target** — workflow tasks bound to a customer surface through the same link mechanism (`todoSource: 'workflows'`); full unification is C3 phase 2 (§6.3). |

**Core/enterprise boundary (mechanism, not hand-waving):** core must never import enterprise. Core defines a **`WorkInboxSourceProvider`** DI contract (`{ kind, list(query), render: widgetSpotId, actions }`); core registers the `user_task` provider; `agent_orchestrator` optionally registers the `agent_disposition` provider (resolved via the established optional-integration pattern) and contributes the rich proposal renderer (`ProposalCard`/`ProposalFacts`) through widget injection. Without enterprise, the inbox simply shows workflow tasks; a disposition task raised by the bridge still renders in degraded form (payload JSON + approve/reject) because it is a real `UserTask` row.

## 3. The typed context backbone (C2 / #4245 — the keystone)

Everything else stands on this section; 16+ stories block on it directly.

### 3.1 Context schema: declared + inferred, one model

A definition gains an additive optional field:

```jsonc
"contextSchema": {
  "input": {            // what the workflow requires to start — the CANONICAL typed-input contract
    "fields": [
      { "key": "dealId", "type": "text", "required": true, "label": { "en": "Deal ID", "pl": "ID transakcji" } },
      { "key": "amount", "type": "number", "required": false }
    ]
  },
  "declarations": [      // author-declared fields for opaque producers
    { "key": "risk.score", "type": "number", "producedBy": "step_assess" }
  ]
}
```

- **Reuses the sub-workflow ports type system** (`workflowIoContractSchema`, 5 business types, coerced by `port-contract.ts`), extended with `object`/`array` composites and an `entityRef` type (`{ type: "entityRef", entity: "customers:customer_entity" }`) — the enabler for task entity binding (§6) and record pickers.
- **`definition.io` reconciliation:** `contextSchema.input` becomes the single canonical typed-input contract for *all* definitions. `definition.io.input` (components/ports) becomes a **deprecated read-through alias**: the loader normalizes it into `contextSchema.input`, the Schema Builder edits only the canonical field, and writes dual-emit both fields for ≥1 minor per the deprecation protocol. Two overlapping schema fields drifting apart is not acceptable.
- Labels on schema fields use the platform's **localized-string shape** (`{ [locale]: string }` with default-locale fallback) — see §6.5 for the authored-content i18n policy.

On top, the editor computes an **inferred context ledger** per step. Formally it is a **topological fixpoint**, not path enumeration (which is exponential on branchy DAGs): each node's ledger = the join of its predecessors' ledgers ∪ its own contributions; at join points, fields present in all incoming ledgers keep `presence: 'always'`, others degrade to `presence: 'maybe'`. Contributions: `contextSchema.input`, typed trigger `contextMapping` outputs, each upstream step's `outputContract` (namespaced per its `outputMapping`), and declared signal payloads. Entries: `{ path, type, source, presence, contributingRoutes }`.

- **`maybe` fields** render with a dashed chip listing contributing branches on hover; referencing one in a required position raises a **warning** with one-click fixes ("add a default" via `?? fallback`, or "guard this branch").
- **Back-edges/loops:** computed on the DAG condensation; the loop container (§5.8) gives iteration items a proper nested scope.
- **Honest degradation:** producers without contracts (unregistered functions, untyped endpoints, free-form context writes) contribute an explicit **`unknown` ledger node** rendered as a "no contract" chip — never silently absent. The ledger's value grows as contracts land; it never lies.
- Computation is client-side in the Studio (memoized per structural change) and served at `GET /api/workflows/definitions/:id/context-schema?stepId=…` (ledger + JSON-Schema rendering) for Om-Agent/MCP — machine-readable context is a product surface (P5).

### 3.2 The unified Activity Registry

One declarative entry per activity type replaces today's 6-way duplication:

```ts
registerActivityType({
  id: 'UPDATE_ENTITY',
  icon: 'DatabaseZap',
  i18nKey: 'workflows.activities.updateEntity',
  configSchema: updateEntityConfigSchema,          // Zod — single source of validation truth
  outputContract: (config, services) =>            // static schema OR resolver; may return 'unknown'
    services.commandRegistry.outputSchemaOf(config.commandId),
  form: [                                          // CrudForm field spec → inspector panel
    { id: 'commandId', component: 'CommandPicker' },
    { id: 'input',     component: 'SchemaDrivenForm', schemaFrom: 'commandId' },
  ],
  execute: async (config, ctx) => { … },
  async: { capable: true, queue: 'workflow-activities' } | { capable: false, reason: 'mintsPerRequestKey' },
  mock: (config, ctx) => ({ …deterministicSample }) | 'refuse',
  compensable: true,
  docsSlug: 'framework/workflows/activities#update-entity',
})
```

**Registry runtime contract (the sync/async split made explicit):** today async configs are interpolated at **enqueue time** and serialized into the job payload; async handlers see frozen context, a forked EM, and no live transaction; `CALL_API` is deliberately sync-only (it mints a one-time key); `INVOKE_AGENT`, timers, and sub-workflow resume run as **distinct job kinds outside the activity registry** and stay that way. The registry therefore declares per-type `async.capable` (with a machine-readable reason when false), the interpolation point is part of the contract, and the async path is a thin worker that looks up `execute` from the same registry entry — the two switches collapse without pretending the execution environments are identical.

What the registry buys, in order of leverage: **dispatch** (kills the two-registry hazard), **validation** (one Zod schema feeding keystroke-level inspector validation, node badges, Problems panel, and structured API errors; retry-field drift dies), **forms** (JsonBuilder demoted to a round-tripping "Advanced (JSON)" toggle that parses pasted JSON into fields — invalid JSON shows an inline error and never locks editing, #4234), **output contracts** (feeding the ledger), **extensibility** (`registerActivityType` in a module's DI is the complete custom-activity story), and **mocks** (every type states its dry-run behavior or refuses explicitly).

Step types get a smaller parallel registry: palette metadata, config panels, allowed route kinds, conversion rules.

**Named cross-module dependency:** UPDATE_ENTITY's output contract requires **command output schemas**, which do not exist today (command returns are untyped). This is sequenced as a platform workstream in Phase 1–2 with owners beyond the workflows module; until a command declares its output, its ledger contribution is `unknown` (honest degradation above).

### 3.3 API response schemas plug in (A2 → A7, #4230 → #4235)

`makeCrudRoute` OpenAPI gains real response object schemas (the Zod already exists; the doc generator must stop collapsing to `string`). This is the prerequisite for the **Endpoint Picker** (§5.3) and CALL_API output typing. Hand-written routes without response schemas degrade to `unknown` contributions.

### 3.4 Agent OUTCOME schemas plug in

`INVOKE_AGENT`'s `outputContract` resolves from the selected agent's OUTCOME.md JSON-Schema (already machine-readable; its restricted subset maps 1:1 onto the ledger types). Envelope keys (`kind`, `disposition`, `proposalId`, `proposalPayload`, `data`) typed by the platform; `data`/`proposalPayload` typed by OUTCOME. `outputMapping` rows become two pickers (OUTCOME/envelope key ⇄ ledger path with autocomplete); a mapping referencing an absent key is an author-time **error**, killing the silent no-op. The input builder validates against the agent's declared input shape, with "Insert sample" from SAMPLE.json.

### 3.5 Expression & mapping UX

- **Variable picker** (patterns 2, 4): every text-capable field shows a `{x}` affordance; clicking or typing `{{` opens a popover listing the ledger grouped by source, each entry with type badge, **sample value**, and `maybe` marking. Click inserts a **pill**. The Input data panel (§5 template) also supports **dragging a field directly into a parameter** (n8n's muscle-memory gesture) — click and drag are both first-class.
- **Pills** render as tokens with sample values; hover shows source and type; a broken pill (path gone after an upstream edit) renders red and files a Problems entry — reference integrity survives refactors.
- **Inline transforms on pills** (ServiceNow): chainable audited transforms (`format date`, number format, case, concat, `default if missing`, pick field) serialized as a small pure-function pipeline (`{{ context.deal.closeDate | date('yyyy-MM-dd') }}`). This is **new expression-language surface** — the interpolator must learn the pipeline grammar; scoped as its own Phase 2b item. No arbitrary JS (§9.6).
- **Per-field expression escape hatch** (pattern 7): every structured control flips to expression mode with ledger-backed autocomplete + unknown-path squiggles.
- **Strict interpolation:** new definitions default `interpolation: 'strict'` — an unresolvable path fails the activity (routing its error edge) instead of passing literal `{{…}}` outward. Existing definitions stay `'lenient'` until edited (additive, opt-in).

### 3.6 Pinned & sample data — one precedence chain

Three data sources feed previews; one explicit precedence resolves them everywhere (picker samples, form previews, condition preview, test prefill):

**explicit pin > last test-run output > schema-derived placeholder.**

- **Pin from run** ("Use as sample" on run detail; per step): copies `StepInstance.inputData/outputData` into `metadata.editor.samples`. Pins are **editable JSON** (fabricate edge cases) and **ignored at production runtime**. A fresh test run never overwrites a pin; the UI offers "update pin from this run" explicitly. One verb — **pin** — everywhere.
- **Fixtures** (§8.1) are a different thing by design: named *start contexts*, not per-step samples; "Save as fixture" exists only on the test start form.
- **Redaction:** there is no generic redactor over arbitrary step I/O, so pinning is honest about mechanism: fields whose ledger provenance is an `entityRef`/entity-backed source run the entity's encryption/GDPR redactors; all other fields are stored inside a **tenant-encrypted envelope** in `metadata.editor.samples` and rendered only to users holding the definition-edit feature. Redacted fields show `«redacted»` but keep type info.

## 4. Canvas & editor redesign

### 4.1 Layout model (C5/#4248 completed, A5/#4233)

- **Left→right auto-layout default** (dagre, present); structural mutations re-tidy only the affected region; manual `_editorPosition` always wins until explicit "Tidy" (P7).
- **Stable identity — with runtime safety.** Nodes and routes get durable ids **no longer derived from endpoints** (today `e_${from}_${to}`, and `branchKey`/`pendingTransition` persist transition ids that the engine re-looks-up mid-flight). The path-identity rework therefore ships **together with an edit-safety rule** (same phase, not deferred): structural edits to a definition with active instances require a new version (running instances keep executing their pinned definition snapshot), or — where versioning is not yet wired — old transition ids are kept as aliases. Re-pointing an edge under a running instance must be impossible, not merely discouraged.
- **Edge reattachment:** dragging a route endpoint onto another node re-targets it preserving label, conditions, and activities; invalid targets snap back with an inline reason.
- **Insert-on-edge:** hover a route → `+` → palette filtered to insertable types → splice.

### 4.2 Palette

Searchable, categorized, one-line descriptions: **Flow** (Start, End, If/Else, Switch, Loop, Parallel, Wait…), **Actions** (auto-populated from the registry, incl. module-registered custom activities), **Human** (Task, Approval preset), **Agents** (Invoke agent), **Composition** (Sub-workflow, Component). Drag-from-palette drops at the cursor; click appends for keyboard users; every entry links to `docsSlug`.

### 4.3 Node anatomy — config at a glance

Each node face shows: icon + name (double-click renames inline) + step-type chip; a **one-line config summary** rendered by the registry ("customers.deals.update · stage ← {{risk.tier}}"; "Role: Sales Manager · due 2 d"); a badge cluster (🔴/🟡 issue counts → Problems panel, ↻ retry, ⏱ timeout/SLA, 🧪 pin present, ⛨ compensation); and a static **Outputs** section in its inspector showing the `outputContract` schema even before any data exists — the contract teaches the ledger.

### 4.4 Route anatomy — decisions are routes (P4)

- **Condition chip** (`amount > 5000`); click opens the condition editor in the inspector. Priority becomes **drag-to-reorder** of a node's outgoing routes; the number is derived and demoted to advanced. First edit of a node's routes runs a **priority normalization pass** (existing definitions mix dialog-default 100 with schema-default 0); for `source: 'code'` definitions this happens only on Customize, keeping code diffs clean.
- **Activity chips** (C1/#4244): activities on a route render as icon chips along the edge; **drag an action from the palette onto a route** to append; click to configure.
- **Default/otherwise route** with `↩ otherwise` label; validator warns when a branching node lacks one.
- **Error routes** (§5.9, red dashed), **outcome routes** on agent nodes (§7.2), **SLA-breach routes** on task nodes (amber clock), **compensation ghosts** (dashed reverse, behind a toggle).
- **Density management (anti-pattern #1 defense):** chips cap at 3 with a `+N` overflow badge; **semantic zoom** collapses chips to dots below a zoom threshold; the **minimap stays** (React Flow's, kept from today); groups/notes (§4.5) and the Loop container keep large flows readable. Acceptance test: a 60-node OZE-scale flow with 5 agent nodes remains navigable — this is an explicit Phase 3 QA scenario.

### 4.5 Editing ergonomics

- **Undo/redo:** one command stack over the definition document (structural + config edits — the inspector edits the same document), Cmd+Z/Cmd+Shift+Z, 100 steps, survives panel switches. AI checkpoints (§9) are **named entries in this same stack**, not a third history mechanism.
- **Copy/paste/duplicate:** multi-select → portable-JSON subgraph on the clipboard; paste re-IDs and splices; works across workflows and into the Code view.
- **Step-type conversion** (A9a): "Change type…" keeps id/name/position/wiring; compatible config mapped; incompatible config quarantined into a visible "unmapped config" drawer (flagged in Problems), never dropped.
- **Groups & notes:** markdown sticky notes and named collapsible groups in `metadata.editor.annotations` — never execution semantics.
- **Keyboard:** Del removes (undoable), Enter opens inspector, arrows nudge, Cmd+Enter submits, Esc cancels, F focus mode, Cmd+K command palette (add node, go to step, run test).
- **Icon picker:** searchable lucide grid.

### 4.6 Accessibility (a first-class requirement, not a hope)

- Every canvas operation is reachable without a pointer: the command palette + inspector + Problems panel + Code view together form a complete non-pointer authoring path, and this is an explicit acceptance criterion.
- ARIA labeling on nodes/routes/badges; the Problems panel and inspector are standard focus-managed DOM.
- Status is never color-only: execution overlay and badges pair color with icon/text/dash patterns (DS status tokens already carry roles).

### 4.7 Validation & the save model (kills #4232 — structurally)

- **Eager:** the full validator set (registry `configSchema`s, graph rules, fork/join codes, ledger reference checks) runs debounced client-side on every change.
- **Visible:** every issue = a node/route badge **and** a Problems-panel row (severity, message, click-to-navigate). All issues, never just the first.
- **Save model (autosave × locking × undo, specified):** the Studio autosaves to a **per-user working draft** (a draft revision layer, not the published definition); explicit **Save** promotes the draft to the definition with the optimistic-lock header; **Publish** additionally gates on zero errors (draft saves tolerate errors — WIP must be saveable). An autosave failure is a **persistent banner** with retained dirty state, never a lost edit; a 409 on Save surfaces the standard conflict bar (reload/merge). Two Studio sessions therefore never 409 each other on keystrokes — only on explicit Save. Undo operates client-side on the working copy.
- **Machine-readable:** the same issue list (path, code, expected, got) is the API error body — Om-Agent self-corrects from it.

## 5. Activity configuration without JSON

Every activity inspector follows one template: **(a)** type-specific structured form (from the registry), **(b)** shared sections (retry policy, timeout, async toggle with plain-language explanation, error routing, compensation), **(c)** "Advanced (JSON)" round-trip toggle, **(d)** the **Input data panel** (ledger + samples) alongside, a static **Outputs** contract section, and a live output preview once test data exists, **(e)** a **▶ Test step** button (§8.2) — the per-node loop that makes P1 real during authoring, not only after full runs.

- **5.1 UPDATE_ENTITY → "Update record":** command picker (grouped by module, descriptions, required features greyed when the author lacks ACL); input form generated from the command's input schema; `entityRef` inputs render record pickers defaulting to ledger pills; `statusDictionary` becomes "Set status by name" with a dictionary dropdown.
- **5.2 EMIT_EVENT:** event-name dropdown from module `events.ts` registries (enumerable `as const`), payload schema hint + pill-builder; free text stays for custom events with a warning chip.
- **5.3 CALL_API** (#4235, needs #4230): endpoint browser/search from the OpenAPI catalog; parameters split required/optional with typed controls; body form from request schema; response schema shown and wired into the ledger; SSRF/tenant-match constraints as helper text. CALL_WEBHOOK shares the form (URL, method, headers table, body builder, signing hint).
- **5.4 SEND_EMAIL:** template picker (when the email service registers templates), pill-capable To/Subject, body editor with variable insertion, preview against sample context. The stub path is loud in the UI **and honest at runtime**: the no-service result becomes `{ sent: false, simulated: true }` (additive output field; today it reports `sent: true, via: 'console'` — the runtime lies too).
- **5.5 EXECUTE_FUNCTION:** dropdown of registered `workflowFunction:*` DI entries; functions gain optional `args`/`returns` schema registration → args form + typed ledger output; unregistered functions fall back to JSON args with a "no contract" chip.
- **5.6 WAIT + all durations** (#4229): one shared **DurationInput** (number + unit, ISO-8601 underneath) for WAIT, timeouts, signal timeouts, deadlines, reminders, retry delays. ISO-8601 never appears in UI again.
- **5.7 SET_VARIABLE → "Set values":** first-class assign activity — rows of `context path ← value/pill/expression`, each updating the ledger immediately. Data shaping becomes visible; agents get a legal way to restructure context.
- **5.8 New flow-logic step types.** **If/Else** with the business_rules `ConditionExpression` language + ConditionBuilder UI inline (one condition language platform-wide), "use Business Rule instead" toggle, and **inline BR create/edit** in a side panel with a two-way dependency view (#4236). **Switch** on one field, N labeled outputs + required otherwise. **Loop container** — for-each/repeat-until with mandatory max-iterations, rendered as a container node with the body nested inside (Dify), iteration item/index scoped into the body ledger. **WAIT_FOR_CONDITION** per the existing spec. Pre- vs post-conditions get visual placement (source end vs target end) with helper copy. **Engine-semantics gate:** If/Else and Switch compile to prioritized transitions (pure sugar, additive); the **Loop container is new engine semantics** (iteration scope, per-iteration context, interaction with fork/join's no-cycles validator and branch tokens) and requires its own mini-spec as a Phase 3 entry criterion — the UI must not ship ahead of defined semantics.
- **5.9 Error routing** (patterns 27–30): every activity-bearing node gets an optional **error output handle** → red dashed route into real handling. When unwired, a named **error directive** applies: `Fail instance` (default), `Continue with fallback value` (typed against the output contract), `Send to failure queue` (parks as ATTENTION for §8.5 triage). `continueOnActivityFailure` maps to directive #2 (additive alias). Retry policy stays one compact typed object rendered identically everywhere. A **workflow-level error handler** (designated handler sub-workflow/branch receiving `{failedStepId, error, contextSnapshot}`) is the catch-all — implemented as an **engine construct, not an event trigger** (the event-trigger subscriber deliberately excludes `workflows.*` events; implementers must not reach for that path).

## 6. Human tasks end-to-end

### 6.1 Definition side — the Task inspector

Sections, in order (in the expandable inspector, §2.1):
1. **What** — title (pill-capable) + rich-text **instructions** with variable pills, rendered in a **live preview** against sample context.
2. **About what** — **entity binding**: `entityRef` picks from the ledger ("Customer ← {{context.customerId}}"); preview shows the record card; multiple bindings allowed.
3. **Who** — assignment tabs: **Role** (multi-select of tenant roles, warns on deleted roles — #4239), **User** (search dropdown — #4240), **Dynamic** (ledger pill, e.g. `{{deal.ownerId}}`, mandatory fallback role), **Rule** (BR picker, kept). Portal actors are dynamic assignments resolving to portal principals (§6.4).
4. **When** — **deadline** (DurationInput anchored to creation; business word "deadline", never "timeout" — #4241/#4229); **reminders** (offsets); **on breach**: notify / reassign / **route the SLA-breach edge** (escalation modeled in the process — Camunda/Dify). **Priority** (low/medium/high/extreme, mirroring platform labels).
5. **Decisions** — form builder (fields, validation, defaults) + **decision buttons**, each mapped 1:1 to an outgoing route (Approve → A, Reject → B, Escalate → C); selected fields markable **editable-prefilled** (reviewer corrects data inline; edits land in context).
6. **External form** (B5/#4243, renamed from "Form Key" with in-UI explanation): completed as a **renderer registry** keyed by formKey, receiving/returning typed context — the same mechanism portal rendering (§6.4) and record-page widgets use.
7. **Approval preset**: a palette entry pre-filling Approve/Reject + comment + entity-binding prompt.

### 6.2 Runtime side — the Work Inbox

- One queue (P9): filterable by kind/module/entity-type/role, sorted by priority + due date with overdue badges; claim/unclaim; **reassign/delegate with reason, audited**; manager **workload view** (open tasks per assignee/role, aging).
- **Task detail = decision + context side-by-side:** left — instructions, form, decision buttons; right — bound entity card(s) with deep links. Agent dispositions render the **proposal as a readable diff** + confidence + FACTS grid via the enterprise-injected renderer (§2.3).
- **After completion: "next task"** — a one-click claim-next affordance (Camunda Tasklist's throughput loop) keeps frontline flow.
- **Record-page surfaces:** every bound entity type gets the injected "pending work" widget.
- **Delivery:** assignment/reminder/breach → notifications (in-app + email) with deep links; an "on assignment, emit event" hook lets tenants route approvals anywhere (Slack via webhooks). **Notification quick-actions** complete a decision inline **only when** the task has exactly one-click semantics: no editable-prefilled fields and no required comment — otherwise the quick action deep-links to the full task.
- **Portal delivery (Ewa):** portal tasks notify through the **portal notification surface and email** (portal users are not backoffice-notification recipients); the Portal Event Bridge (`portalBroadcast`) live-updates her open task view. Mobile-first rendering via the portal DS.

### 6.3 The generic Task direction (C3/#4246, sequenced honestly)

C3 is XL and gets its own architecture spec. This redesign de-risks it by freezing the target shape now — `Task { kind: user_task | agent_disposition | todo, entityBindings[], assignment, priority, dueDate, decisions[], formSchema, source }` — and building the Work Inbox as **phase 1: a projection/read-model** over existing `UserTask` (+ enterprise `AgentProposal` via the provider contract, §2.3) with no data migration; **phase 2: the real entity** with `CustomerTodoLink` convergence and cross-module workflow-pauses-until-done semantics.

### 6.4 Permissions from business context (A10/#4238 + C4/#4247)

- **Rule:** a user (backoffice or portal) can see and act on a task iff (assigned, or holds an assigned role, or claims from a role queue) **AND** passes access checks on the task's bound entities. `workflows.tasks.*` features gate *administration* (viewing others', reassigning) — never one's own assigned work.
- **Portal is new API surface, not a rule tweak:** existing task routes hard-gate on backoffice features and portal principals never pass backoffice auth. Phase 4 therefore ships **portal task routes** under the portal convention (`requireCustomerAuth` + customer RBAC + entity-access checks against customer-scoped records), rendering via the external-form renderer registry with the portal DS. Relaxing feature checks on the existing backoffice routes is a **security-semantics change to a STABLE API surface** and gets its own review line in the BC section (§11).

### 6.5 i18n of authored content (platform policy applied)

Authored user-facing strings — task titles, instructions, decision-button labels, template names/descriptions, schema field labels — accept the platform localized-string shape (`{ [locale]: string }`) with single-string input treated as the tenant default locale. Decision-button presets (Approve/Reject/Escalate) ship as i18n keys out of the box. The Studio shows a locale switcher on the task preview; portal rendering resolves against the portal user's locale with default-locale fallback. Node names/edge labels (author-facing) remain single-string.

## 7. Agent steps first-class

The orchestrator is the module's most demanding customer; this section turns the bridge from emergent to contractual.

### 7.1 Typed I/O
Input builder validated against agent input shape + SAMPLE.json insert; outputMapping as schema-key pickers; both feed the ledger (§3.4). `subject` becomes a structured picker over ledger `entityRef`s.

### 7.2 Outcome routes
The Invoke Agent node exposes labeled output handles routed **declaratively** by the step handler on the disposition result (no more context string-matching): `approved` (auto_approved), `informative`, `rejected`, `guardrail blocked`, `error`. Compilation is additive: handles compile to transitions carrying a new optional `outcomeKind`; old condition-based definitions keep working.
- **Progressive handle disclosure (fan-explosion defense):** the node renders only wired handles plus `approved` and a "+ outcome" affordance; unwired outcomes inherit the node's error directive, and the node face states that inheritance ("unhandled → fail instance"). Five agent nodes in a 60-node flow stay readable.
- **Rejection is a business route, not an error:** agent *failure* (infra) retries per policy then routes `error`; a *rejected proposal* routes `rejected`. The worker's current conflation is split.
- **No parallel continuation in v1.** The draft's `needs review` edge (continue working while humans decide) is **cut**: it implied a second live token outside a fork region, which the single-token execution model (`currentStepId`-matched resume, branch rows only under fork/join) cannot represent, and no catalog story demands it. While a disposition is pending the node parks, visibly (§7.5). If demand materializes, it returns as explicit sugar compiling to a fork/join region — inheriting that validator's rules — in its own spec.

### 7.3 Guardrail escalation
A guardrail `block` routes the `guardrail blocked` handle (typical wiring: → review task with the guardrail evidence bound); unwired, it follows the error directive. `agent_orchestrator.guardrail.tripped` finally gets a governed landing path.

### 7.4 The park/resume contract made explicit
Replace the emergent dance (1s enqueue delay, "not parked yet, retrying", relaxed signal matching) with an engine primitive: `parkStep(stepInstanceId, { resumeToken, timeout? })` / `resumeStep(resumeToken, outcome, payload)` — compatible with the transactional loop (park commits the parked state; resume acquires the instance lock like signals do today) and branch instances (the token addresses the step instance, not the definition path). The queue worker and disposition service call `resumeStep`. Externally the `agent_orchestrator.proposal.ready` signal is dual-listened for ≥1 minor. This refactor gates disposition SLAs and rerun-from-step.

### 7.5 Disposition review, SLAs & lifecycle
- **The Review section (Who/When) lives on the Invoke Agent inspector**: when disposition policy can raise a task (`alwaysAsk`, or a threshold), the inspector shows assignment (Role/User/Dynamic/Rule — same tabs as §6.1.3) and deadline/reminders/breach (same as §6.1.4) for the **implicit disposition task**. Today `dispositionService` hard-codes an unassigned task; that becomes configuration authored on the node. Defaults: the agent's operator role, no deadline.
- The disposition task is a real Work Inbox task and inherits deadline/breach-edge mechanics — "nobody disposed in 2 days → escalate/auto-reject" is the SLA-breach route on the agent node.
- The run view shows a parked agent step as **"awaiting disposition since X · assigned to Y · open task ↗"** — distinct from generic PAUSED.
- `agent_orchestrator.delegation_grant.revoked` resolves affected parked steps to their `error` route (or cancels, per node config).

### 7.6 Visible controls & drafts
Node face/inspector show: model/runtime tag, maxSteps/budget when configured, the auto-approve **threshold slider** with fail-closed semantics spelled out ("no confidence ⇒ human review"). In the run view a pending proposal renders as a **draft card** (Lindy pattern) with the would-be mutation; one-click link to the agent run trace (spans, tool calls, context bundle — already correlated via processId/stepId).

### 7.7 Evals hook
Publishing a definition whose agents have failing eval gates raises a Problems-panel **warning** (publish proceeds — evals gate agents, not workflows). "Create eval case from this run" on agent steps feeds the correction flywheel.

## 8. Testing, debugging & observability

### 8.1 Test runner (C6/#4249)
The **Test tab**: start form **generated from the context schema** (JSON editor as the advanced fallback); **fixtures** (named start contexts — "happy path", "missing phone"); **trigger simulation** (pick a declared event trigger, edit a schema-derived sample payload, fire — tests filters + contextMapping without domain writes); **signal sender** for parked test runs (names suggested from the definition).

### 8.2 Test without side effects (P6)
- **▶ Test step (per-node, in the authoring loop — the n8n/Windmill pattern):** every activity inspector has a Test button that executes *that node* against the sample-precedence chain (§3.6) — upstream values come from pins/fixtures/schema placeholders, effectors are mocked unless the type is read-only-safe — and populates the node's output preview and downstream ledger samples. This ships **with the context backbone (Phase 2)**, not with the later debugging depth: P1 is hollow without it.
- **Dry-run (full graph):** a test run with registry `mock`s in place of effectors ("mocked effectors" — deliberately *not* called rollback: command side effects fire post-commit by design, so transactional rollback across the command bus is not implementable; mocks are the honest mechanism). Output: the **"Would do" report** — an ordered list of every suppressed side effect. `mock: 'refuse'` types stop the dry-run at that node with an explicit marker.
- **Dry-run isolation (the leaks closed):** dry-run instances carry an `isDryRun` flag (additive column) that (a) **suppresses real USER_TASK creation** — the step-through prompt asks the author to simulate the decision instead, and no notification subscriber fires; (b) defaults **INVOKE_AGENT to pinned/SAMPLE outcomes**; opting into a *real* agent run tags the `AgentRun` as dry-run via the bridge context so any resulting proposal is **excluded from the Work Inbox, Caseload, and KPI rollups** and **never reaches `dispositionService.dispose`** — the bridge returns the would-be disposition instead; token spend is attributed to a test budget; (c) keeps ACTION-type business rules un-triggerable (conditions are evaluate-only on this path today; the dry-runner asserts it stays that way); (d) excludes the instance from KPIs.
- **Step-through:** "pause at each step" on test runs — inspect context, continue/abort, canvas highlights the active node.

### 8.3 Execution overlay & run views
- **Overlay on the Studio canvas:** "Show last run" paints node states with DS status tokens (also fixing the instance detail page's hardcoded hex — pulled into Phase 0 as Boy-Scout debt) and the taken path; clicking a node shows its I/O in the inspector.
- **Run detail — three altitudes** (Temporal): **Flow** (painted canvas), **Timeline** — a true clock-time **Gantt** (bars per step/activity/task/signal, parallel branches as overlapping lanes, with collapsed-wait rendering so a 3-day task deadline doesn't flatten the rest; this is what makes latency and human-wait visible), **Context** (current/final context with per-step diffs). The raw event table is demoted to a "Raw" tab.
- **Per-step I/O inspector** (input, output, duration, attempts — from `StepInstance`).
- **Live:** `workflows.instance.*` lifecycle events gain `clientBroadcast: true`; run views subscribe via the DOM Event Bridge.
- **Run list:** filters by definition, status, correlationKey, date; saved filters.

### 8.4 Recovery
- **Rerun from failed step**, optionally with edited context — audited as `STEP_RERUN { editedContextDiff, by }`, gated by its own ACL feature (§ ACL), enabled by §7.4.
- **Failure queue + bulk replay:** `Send to failure queue` directive parks instances as ATTENTION; with FAILED instances they form a triage list with error grouping; bulk retry/cancel runs through the progress module.

### 8.5 Operations
Per-definition KPIs (runs, success %, p95 duration, task SLA hit-rate — rollup mirroring `AgentMetricRollup`); needs-attention queue (failed / stuck / SLA-breached / awaiting-disposition-too-long); repeated-failure alerts (threshold + cooldown via notifications/webhooks); process correlation view (instance ↔ agent runs ↔ proposals ↔ tasks; token/cost per agent step joined on processId/stepId); triggers overview (event ↔ workflows reverse lookup); **cross-org health overview** for multi-org tenants (tenant-scoping rules respected). **Retention:** per-tenant policy archives completed instances + `workflow_events` to cold storage after N days (KPI aggregates kept); `metadata.editor.samples` is size-capped; checkpoints/fixtures count toward a per-definition quota.

## 9. AI-assisted authoring

The typed backbone makes this trustworthy — generation targets schemas, not vibes.

- **Prompt-to-draft:** natural language → draft definition generated against the real catalogs (events, commands, ledger), opened in the Studio with a Problems pass already run. Never auto-published.
- **Copilot with checkpoint diffs:** in-Studio copilot (existing `<AiChat>`) edits the definition; every AI edit is a **named checkpoint in the undo stack** (§4.5) rendered as a visual + JSON diff with one-click undo. "Fix these 5 problems" works the same way.
- **Explain:** plain-language summary of routes/actions/SLAs; per-node "explain this error" on failed runs; exportable to PR descriptions.
- **Suggested mappings:** schema-aware ranked suggestions when wiring steps; one-click apply, never auto-applied.
- **Agent-as-author (MCP tool pack):** `workflows.create_definition`, `update_definition`, `validate_definition`, `get_context_schema`, `list_activity_types`, `start_test_run` — all returning the structured issue format. The registry + ledger + structured errors ARE the agent API; canvas⇄code round-trip guarantees human review of agent-authored flows.
- **AI fixtures:** realistic test contexts generated from the context schema.
- Explicitly **cut**: next-step ghost suggestions while building (E11-08) — low evidence of value vs distraction cost; revisit after copilot telemetry exists.

### 9.6 What NOT to build (scope discipline)
No BPMN completeness (pools/lanes/event sub-processes) · no arbitrary JS expressions (audited transform library only; code stays `EXECUTE_FUNCTION`) · no second DSL (the JSON definition is the format) · no real-time collaborative editing (draft layer + conflict bar suffice) · no separate "agent workflow" product (Agentic Tasks stay a thin launcher) · no linear/wizard editor resurrection · no ghost-suggestion autocomplete (above).

---

# Architecture Notes & Data Models

**New/changed data surfaces (all additive):**
- `WorkflowDefinition.definition` (JSONB): `contextSchema`, `outcomeKind` on transitions, error-route/directive fields, new step types (`IF_ELSE`, `SWITCH`, `LOOP`, `WAIT_FOR_CONDITION` — additive enum values), `interpolation` mode, `minEngineVersion` (definition metadata; old engines refuse to *instantiate* definitions above their version instead of misexecuting them).
- `WorkflowDefinition.metadata.editor.*`: `annotations` (notes/groups), `samples` (pins; tenant-encrypted envelope, size-capped), `fixtures`, `checkpoints`, `_editorPosition` (existing).
- Draft layer: per-user working-draft revision for autosave (new small table or `metadata.editor.draft` keyed by user — implementation detail for the Phase 1 spec; requirement: autosaves never write the published definition and never 409 across sessions).
- `WorkflowInstance.isDryRun` (boolean column, additive); new event types `STEP_RERUN`, park/resume events.
- `UserTask`: `priority`, `entityBindings` (jsonb), `decisions` (jsonb), localized-string columns for title/instructions (additive; single-string reads remain valid as default-locale).
- Work Inbox projection: `WorkInboxSourceProvider` DI contract in core; no new entity until C3 phase 2.
- Registry: `registerActivityType` / step-type registry in core DI; command output schemas (platform workstream, additive on command definitions).

**API contracts (additions):**
- `GET /api/workflows/definitions/:id/context-schema?stepId=` — ledger + JSON-Schema.
- Structured validation error body on definition create/update (path/code/expected/got list).
- Portal task routes under the portal convention (list own tasks, get, complete) — `requireCustomerAuth` + entity access.
- Test/dry-run: start-test (fixtures, dry-run flag), test-step, signal-send UI route reuse; rerun-from-step endpoint.
- MCP tool pack (Phase 6) mirroring the REST surface.

**New ACL features (enumerated; default grants seeded via module `setup.ts` role-feature declarations — the #4231 mechanism):**
`workflows.instances.rerun_step` (admins/devs) · `workflows.instances.bulk_ops` (admins) · `workflows.definitions.pin_samples` (definition editors) · `workflows.definitions.test_run` (definition editors; dry-run included) · `workflows.definitions.ai_author` (definition editors, tenant-gated) · `workflows.templates.manage` (admins). Task *completion* for one's own assigned work requires **no** workflows feature (§6.4). Existing features unchanged.

---

# Migration & Backward Compatibility

- **Definition JSONB:** all changes additive; absent fields ⇒ exact current behavior. Legacy context merging (activity outputs under name/type keys, `${activityId}_result`) is kept dual-path whenever no `outputMapping`/contract exists. Strict interpolation is opt-in per definition. `definition.io` → `contextSchema.input` alias with dual-emit ≥1 minor (§3.1). New step types guarded by `minEngineVersion`.
- **Editors:** form pages 301 to the Studio (bridge routes ≥1 minor); `@deprecated` on exported form components; UPGRADE_NOTES entries. The legacy dialogs are deleted only after the CrudForm variant reaches parity **and** one release of soak (§10.1). `backend/tasks` redirects to the Work Inbox; instance URLs preserved.
- **Code-defined workflows:** `source: 'code'` stays read-only-until-Customize; the Studio renders them with the same read-only affordance; priority normalization and id-migration happen only on Customize (clean code diffs). Round-trip (E10-10) is Phase 6.
- **Events/ACL/API:** only additions. `agent_orchestrator.proposal.ready` dual-listened ≥1 minor during the park/resume refactor. **One flagged security-semantics change:** task visibility moving from `workflows.tasks.view` to assignment+entity-access (§6.4) alters who can see existing task rows — **decision (2026-07-26): default-ON at release for all tenants**, with a tenant-setting opt-out escape hatch, an explicit UPGRADE_NOTES entry, and a dedicated security review as a release precondition (the entity-access AND-gate means the new model only ever *narrows* visibility relative to bare `workflows.tasks.view`, except for the intended assignment-based grants such as portal assignees).
- **Verification item (pre-Phase 6):** confirm whether running instances actually pin their definition version today; if not, version-pinning is engine work that must land with the §4.1 edit-safety rule, not a UI-surfacing task.

---

# Phased Roadmap

Sizes are honest: **Phases 2–4 are multi-release programs** with explicit cut lines, not single L items. Every phase includes a **docs workstream** (user-guide + framework docs updated for what shipped — the user guide is already out of sync today) and exits by re-scoring its listed stories in the companion catalog.

**Phase 0 — Trust repair & quick wins (S/M, ~2–3 wk parallel)**
Problems panel + node badges + no-silent-save banner (#4232, the wound); DurationInput everywhere (#4229); role dropdown (#4239); static user dropdown (#4240a); JSON-paste fix (#4234); default role grants via `setup.ts` (#4231); retry-field-drift fix; **flip the CrudForm dialog flag default ON + parity burn-down list** (incl. WAIT_FOR_TIMER/parallel panels, `window.alert` removal); ship #4249 as-is (JSON test start + fixtures list); instance-detail hardcoded hex → DS tokens; run the #4250 spec audit (output: checklist appended to the umbrella issue; exit criterion of this phase).
*Cut line: legacy dialog deletion is NOT here.*

**Phase 1 — The registry + templates (M/L)**
Unified Activity Registry (§3.2, incl. the runtime contract) consolidating dispatch/validation/forms; schema-driven forms for all 8 types (command picker, event picker, function registry, SET_VARIABLE); #4230 typed OpenAPI responses (parallel track); **command-output-schema platform workstream kicked off** (cross-module owners); **template gallery seeded (3–5 module templates) + "New workflow" template picker + empty states**; **legacy dialog deletion** (post-soak); autosave draft layer + save model (§4.7).
Closes: #4230, A9b. *Cut line: ledger not required; forms render against static schemas.*

**Phase 2 — The context backbone (multi-release program; the keystone)**
**2a:** context schema + `definition.io` alias + ledger (fixpoint) + `maybe` semantics; variable picker + pills; pinned samples with precedence chain + redaction envelope; **▶ Test step (per-node)**; context-schema API + structured errors. **2b:** pill transform pipeline (new interpolator grammar); strict mode; endpoint picker (#4235); trigger event-picker/filter-builder/mapping; agent typed I/O (§3.4/§7.1); drag-from-input-panel.
Closes: #4245, #4235. *Depends: Phase 1 registry, #4230.*

**Phase 3 — Flow logic & canvas (multi-release program)**
**3a:** If/Else + Switch (transition sugar) + inline BRs (#4236) + error routes/directives + workflow error handler (engine construct) + WAIT_FOR_CONDITION (existing spec); route condition/activity chips + density management (#4244); Problems-panel ledger checks. **3b:** path-identity rework **with the edit-safety rule** (new version on structural edit of active definitions) + reattachment (#4233) + persisted-arrangement completion (#4248); step-type conversion (rest of #4237); undo/redo; copy/paste; drag-from-palette; notes/groups; icon picker; keyboard path + a11y acceptance; **Code view stage 1 (read-only + copy/paste) → form editor retired here**; compensation-edge visualization. **Loop container ships only after its engine-semantics mini-spec is approved** (entry criterion).
Closes: #4233, #4236, #4237 (fully), #4244, #4248. *Depends: Phase 2a.*

**Phase 4 — Human tasks (multi-release program)**
**4a:** Task inspector (§6.1 complete, incl. i18n'd authored content); Work Inbox projection + `WorkInboxSourceProvider` + claim/reassign/workload + next-task loop; entity-context panel; record-page widgets; notification delivery + quick-action rule. **4b:** permissions-from-business-context (#4238/#4247) incl. the **portal task API workstream** (new routes, portal notifications, Portal Event Bridge) and the tenant-setting migration; external-form renderer registry (#4243); C3 architecture spec authored (entity work sequenced separately).
Closes: #4238, #4240 (dynamic), #4241, #4242, #4243, #4247; #4246 phase 1. *Depends: Phase 2 (bindings, dynamic assignment).*

**Phase 5 — Agent contract & debugging depth (L)**
Outcome routes + progressive disclosure + guardrail route + rejection/error split + explicit park/resume + **agent-node Review (Who/When) section** + disposition SLAs + proposal draft cards + trace links + threshold slider (§7); dry-run + isolation flags + step-through + rerun-from-step (+ ACL) + execution overlay + Gantt timeline + live SSE + failure queue/bulk replay + run-list filters (§8); **Code view stage 2 (two-way sync + squiggles)**.
Closes: — (all GAP work). *Depends: Phases 2–3; §7.4 gates rerun-from-step.*

**Phase 6 — AI authoring, governance & ops (M/L, parallelizable)**
Prompt-to-draft; copilot + checkpoints; explain; suggested mappings; MCP tool pack; AI fixtures (§9); version diff; export/import; edit-while-running banners (verification item first, §BC); definition audit tab; disable-policy dialog; per-definition ACL; KPIs; needs-attention; alerts; process correlation; cross-org overview; retention; cron + inbound-webhook triggers; triggers overview.
*Depends: everything prior (AI targets finished schemas).*

Unphased: E9-12 integration activities (own spec `2026-03-29-workflow-integration-flows.md`; slot after Phase 2).

---

# Integration Test Coverage (required paths)

**API:** definition CRUD with `contextSchema` round-trip + structured error body; context-schema endpoint (ledger correctness incl. `maybe` at a join); registry-validated activity config rejection; test-run + dry-run start (assert: no notification rows, no real UserTask, no pending proposal in inbox queries, `isDryRun` excluded from KPIs); test-step execution; rerun-from-step (ACL-gated, audit event); park/resume primitive (dispose → resume); portal task routes (portal principal completes own bound task; cannot see unbound tasks); Work Inbox list with provider merge (enterprise present/absent); outcome-route dispatch per disposition kind incl. guardrail block.
**UI (Playwright):** silent-save regression guard (failed save ⇒ Problems entries + banner + dirty state retained — the #4232 killer test); Studio authoring loop (add node via palette drag, configure UPDATE_ENTITY via command picker with zero JSON, wire pill from picker, see validation badge appear/clear); route reattach preserving config; step-type conversion with quarantined config visible; edge-chip overflow at 60-node fixture; task completion with entity card + decision-button routing; disposition task from Caseload lens and from Work Inbox are the same record; dry-run "Would do" report; execution overlay after a run; Code-view copy/paste subgraph; a11y smoke (keyboard-only: add + configure + save).
All tests self-contained (API fixtures, teardown), per `.ai/qa/AGENTS.md`.

---

# Success Metrics & Validation Plan

| Metric | Baseline | Target |
|---|---|---|
| Time-to-first-working-workflow (order-approval template, new author) | hours + editor-bouncing | < 15 min |
| Silent-failure rate (edits dropped without surfaced error, incl. autosave) | reproducible (#4232) | **0** — guarded by e2e test |
| JSON-textarea encounters per authored workflow | 7 of 8 activity types | 0 required (advanced toggle only) |
| Unknown-context-path defects reaching runtime | unbounded | 0 on strict-mode definitions |
| Tasks with a bound entity that render its record card | 0% render context today | 100% of bound tasks; binding adoption tracked separately |
| Agent-proposal disposition: median time + SLA-breach % | unmeasured | measured, SLA visible per queue |
| Failed instances recoverable without full re-run | 0 | step-rerun offered on all eligible |
| Agent-authored definition validating within 2 MCP iterations | impossible | ≥ 80% |

**Validation plan:** (1) re-run the OZE lead→install build as the canonical usability script after Phases 0–3 — the flow that generated the backlog becomes the acceptance test; (2) frontline task-inbox test after Phase 4 (5 tasks incl. one portal task, zero training); (3) 60-node scale readability review in Phase 3 QA; (4) agent-authoring soak after Phase 6 (Om-Agent generates the template gallery); (5) each phase exits by re-scoring its stories in the companion catalog.

---

# Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Loop container ships without defined engine semantics → misexecution with fork/join | High | Engine | Mini-spec is a Phase 3 entry criterion; If/Else/Switch ship first as transition sugar | Low — gated |
| Edit of active definitions corrupts running instances during path-identity rework | High | Engine/data | Edit-safety rule ships in the same phase; version-on-structural-edit; id aliases | Low |
| Dry-run leaks side effects (tasks, proposals, notifications, LLM spend) | High | Trust/P6 | `isDryRun` flag, suppression list, bridge simulate mode, KPI exclusion — all integration-tested | Low |
| Task-permission model change exposes tasks to unintended users | High | Security | Default-ON at release (decided) with tenant opt-out, entity-access AND-gate, dedicated security review as release precondition of the STABLE-surface change | Medium — needs review sign-off before release |
| Command-output schemas (cross-module workstream) stall → ledger stays `unknown`-heavy | Medium | Adoption | Honest degradation UX; workstream tracked with owners; endpoint/OUTCOME contracts deliver value independently | Medium |
| Phases 2–4 under-resourced (2–3× historical underestimate) | Medium | Delivery | Multi-release framing with cut lines; each sub-phase independently shippable | Medium |
| CrudForm live-binding inspector proves larger than scoped | Medium | Editor | Split from parity work; modal-dialog fallback remains until live inspector lands | Low |
| Canvas density at 60+ nodes despite mitigations | Medium | UX | Chip caps, semantic zoom, groups, minimap; explicit scale QA scenario | Low |
| Retention gaps grow event tables unboundedly as usage scales | Medium | Ops | Phase 6 retention policy; samples/checkpoints quotas from Phase 2 | Low |

---

# Resolved Questions (team decisions, 2026-07-26)

All seven open questions were put to the product owner on 2026-07-26 and decided:

1. **C3 entity timing → projection now, entity next cycle.** The unified Work Inbox ships as a projection this cycle; the generic Task entity (+ `CustomerTodoLink` convergence) is scheduled for the next cycle behind its own architecture spec.
2. **Command output schemas → workflows team drives it.** A cross-module PR series owned by the workflows/platform effort, highest-value commands first (deals, orders, products). Ledger renders `unknown`/"no contract" for commands not yet covered.
3. **Task-permission rollout → default-ON immediately at release** for all tenants, with a tenant-setting opt-out, UPGRADE_NOTES entry, and a dedicated security review as a release precondition (§10.2 updated accordingly). Rationale: fixes the portal-approval bug (#4247) for existing tenants without requiring action.
4. **Draft-layer storage → dedicated revision table** (`workflow_definition_drafts`, keyed by definition + user): multi-user isolation, draft diffing, and AI checkpoints in one migration.
5. **Inline Business Rules (#4236) → shared component.** The inline BR editor is a reusable component owned by `business_rules`, embedded by the Studio; ships with the dependency-visibility panel ("used by: N workflows, M promotions"). No workflows-exclusive coupling.
6. **Email service → not this cycle; honest stub.** SEND_EMAIL keeps the stub but reports `sent: false, simulated: true` with a loud banner in the activity form; full template-picker UX deferred until a real service lands.
7. **`needs review` parallel continuation → stays cut from v1.** Agent review remains blocking (flow parks until disposition); the fork-sugar mini-spec is revisited only when a concrete flow demands overlap.

---

# Review Decisions (adversarial-pass dispositions)

All CRITICAL and MAJOR findings from the three review passes were accepted and integrated (dry-run isolation §8.2; Code-view scheduling §2.2/§10; i18n §6.5; ACL appendix; `definition.io` reconciliation §3.1; save model §4.7; retention §8.5; templates Phase 1; inbox provider mechanism §2.3; loop-semantics gate §5.8; a11y §4.6; phase re-sizing §10; portal API workstream §6.4; park/resume compatibility §7.4; registry runtime contract §3.2; `unknown` degradation §3.1; per-node Test step §8.2; agent Review section §7.5; `needs review` cut §7.2; progressive handles §7.2; density management §4.4; sample precedence §3.6; Gantt timeline §8.3). Minor findings applied except:
- **E11-08 ghost suggestions** — explicitly cut (§9.6) rather than designed: weak story evidence, high distraction risk (accepted the critic's "cut explicitly" option).
- **Template seeding phase** — completeness critic said Phase 3, UX critic said Phase 0–1; resolved to **Phase 1** (the registry makes template JSON stable; Phase 0 stays pure trust-repair).

---

# Final Compliance Report

- Follows `.ai/specs/AGENTS.md` naming (`{date}-{title}.md`), content checklist (TLDR/Overview/Problem/Solution/Architecture/Data Models/API Contracts/Risks/Compliance/Changelog), and OSS-scope rule (enterprise-side internals referenced only via core-defined contracts; enterprise implementation defers to `.ai/specs/enterprise/agent-orchestrator/`).
- Honors root `AGENTS.md`: no cross-module ORM relationships (provider contract + widget injection instead); tenant/org scoping stated on every new surface; feature-based guards (no role names); DS tokens (hex removal scheduled); i18n policy for authored content; integration coverage listed; optimistic locking respected via the draft-layer save model.
- Honors `BACKWARD_COMPATIBILITY.md`: additive JSONB evolution, deprecation protocol on `definition.io`, dual-listen on the proposal-ready signal, bridge routes on retired pages, one flagged STABLE-surface security change with its own rollout gate.

# Changelog

- **2026-07-26** — Initial proposal. Research (codebase deep dive, orchestrator dependency analysis, external benchmarks), 156-story catalog (companion file), full redesign, three adversarial review passes (completeness, feasibility, UX quality) integrated. Not yet implemented; Phase 0 ready to schedule.
- **2026-07-26 (later)** — All seven open questions decided by the product owner (see "Resolved Questions"): projection-first C3, workflows-team-owned command schemas, task-permission model default-ON at release (with opt-out + security review precondition; §10.2 updated), dedicated draft revision table, inline BRs as a shared `business_rules`-owned component, SEND_EMAIL honest stub this cycle, `needs review` parallel continuation stays cut.
- **2026-07-27** — Phase 1 implemented on branch `feat/workflows-ux-phase1` (PR pending): activity registry (§3.2) with registry-driven dispatch, schema enum, and warning-severity per-type config validation; registry-driven activity config forms with pickers (event/command/function) and Advanced-JSON escape hatch; `SET_VARIABLE` end-to-end; typed OpenAPI responses for definition routes (#4230); `CommandHandler.outputSchema` seam with `customers.deals.update` exemplar; template gallery + `examples/templates/*.json` assets; per-user draft layer (`workflow_definition_drafts` entity, draft API, debounced editor autosave with restore banner); docs and UPGRADE_NOTES updated.
- **2026-07-27 (later)** — Phase 2a implemented on branch `feat/workflows-ux-phase2a` (stacked on Phase 1): `contextSchema` on definitions with a Context panel (§3.1); pure per-step context ledger (`lib/context-ledger.ts` — topological fixpoint, `always`/`maybe` presence, injected `resolveOutputContract` seam, `flattenSchemaToContract`) served by `GET /definitions/[id]/context-schema`; variable picker with type/maybe badges plus warning-only unresolved-reference checks in Problems (§3.5); pinned per-step samples (`metadata.editor.samples`, 64KB cap, explicitly unredacted — warning copy instead of the cut redaction envelope) with pin > test output > placeholder precedence (§3.6); mock-first Test-step endpoint behind the new `workflows.definitions.test_run` feature with the `mock: fn | 'refuse'` registry contract (§8.2); structured `{path, code, message, expected?, got?}` `details` on definition 400s. Engine-honesty findings verified during implementation: AUTOMATED steps' sync activity outputs and SUB_WORKFLOW `outputMapping` results reach only `stepInstance.outputData`, never `instance.context` — the ledger advertises neither; making sub-workflow `outputMapping` actually merge into the parent context is filed as a follow-up.
- **2026-07-28** — Phases 2b, 3a and 3b implemented on branch `feat/workflows-ux-phase2b-3` (single branch, stacked on Phase 2a; PR #4569). Additive-only across all 13 contract surfaces.
  - **Phase 2b — typed context completed.** Pill transform pipeline (`{{ path | fn(args) }}`, §3.6) as a pure parser + fixed transform table (`date`/`number`/`upper`/`lower`/`title`/`concat`/`prepend`/`default`/`pick`), with `interpolateVariables` and `expression-refs` rewired onto it and lenient behavior byte-identical for pipe-free tokens; **strict interpolation mode** (`definition.interpolation`, defaulted to `strict` only on the POST create path so no existing definition flips on a PUT round-trip); the **endpoint catalog** (`GET /api/workflows/endpoints`, an in-process OpenAPI projection) behind a `CALL_API` endpoint picker with typed param rows and free-text fallback — #4230's generator fix proved unnecessary because declared zod responses already emit real schemas; `CALL_API` `outputContract` → response schema → ledger; additive `EventDefinition.payloadSchema` (with a generated default for platform CRUD after-events) exposed via `GET /api/events`, driving a typed trigger filter builder and mapping pickers plus safe-default copy for `debounceMs`/`maxConcurrentInstances`; agent OUTCOME schemas exposed on the enterprise agents API and consumed through an additive OPTIONAL `listAgentOutcomeContracts()` on the existing `agentWorkflowBridge` (duck-typed, degrades to `unknown` when the peer is absent); typed agent I/O pickers with author-time errors; and the **Input data panel** with click-or-drag insertion (`text/plain` + a private ledger MIME).
  - **Phase 3a — flow logic.** `IF_ELSE` and `SWITCH` as pure transition sugar with a `minEngineVersion` guard (engine version 3; `STEP_TYPE_MIN_ENGINE_VERSIONS`) and a missing-otherwise warning; `WAIT_FOR_CONDITION` end-to-end (condition handler, absolute-deadline queue backstop, branch-aware resume, fail-closed save-time validation) plus `PATCH /api/workflows/instances/[id]/context` behind the new `workflows.instances.update_context` feature (tenant-scoped read, reserved-key rejection incl. `__park`); **error routes** (`transition.kind: 'error'`), per-step `errorDirective` (`fail`/`continueWithFallback`/`failureQueue`) and a workflow-level `errorHandler` as an engine construct (handler scheduled **before** compensation, durable via `ERROR_HANDLER_SCHEDULED` + a queued job, recursion capped in engine-owned metadata) — all resolved by the pure `lib/error-routing.ts`, with a regression test proving a definition declaring none of it fails exactly as before; inline Business Rules as a `business_rules`-owned component embedded by the Studio with a usage panel supplied through a *slot* rather than a cross-module lookup; route condition/activity/otherwise chips with a 3-chip cap, `+N` overflow and semantic-zoom collapse; drag-to-reorder route priority with a normalization pass; and Problems-panel ledger/flow-logic checks against a real 60-node density fixture.
  - **Phase 3b — canvas editing depth.** Durable opaque transition ids (`t_…`) with legacy `e_from_to` ids accepted forever; the **edit-safety rule** (structural edit + active instances → structured 409 + a "Create version" banner that mints the next version and re-applies the rejected edit); edge reattachment preserving id/label/condition/activities/priority/kind with delta-based refusals; persisted arrangement completed (one autosave per drag, byte-equal writes skipped, cursor placement); step-type conversion with visible `metadata.unmappedConfig` quarantine; a 100-entry undo/redo snapshot stack; portable-JSON subgraph copy/paste/duplicate in the definition vocabulary; drag-from-palette with insert-on-route and drop-action-onto-route; notes and groups in `metadata.editor.annotations` (proven byte-identical serialization); a searchable icon picker over the platform's existing generated lucide registry (zero bundle cost); the Cmd+K command palette, full keyboard path and ARIA acceptance (status is never colour-only); the read-only **Code view** (save payload, subgraph paste, shared Problems list); the **form-editor retirement** behind bridge routes with `@deprecated` components and an UPGRADE_NOTES entry; and read-only compensation ghosts behind a toggle.
  - **Three pre-existing bugs found and fixed** (none of them in scope going in; all are real behavior fixes):
    1. `workflowTransitionSchema` never declared `condition`, so Zod's object-stripping **silently discarded route conditions on every save** while the engine went on evaluating `transition.condition` at runtime. The additive optional field (typed by `business_rules`' `conditionExpressionSchema`) closes the gap and was a hard prerequisite for If/Else and Switch persisting their routes.
    2. `collectBranchingRouteWarnings` counted an **error** route as the otherwise route, silencing the missing-otherwise warning on branching steps that could genuinely stall.
    3. `graphToDefinition` never carried `activity.compensation`, so **opening a compensating workflow in the editor and saving it deleted its compensation** — the saga the engine relies on, removed silently by a round trip.
  - **Deliberate deferrals, stated rather than implied:** the **Loop container** stays out (§5.8 gates it on an engine-semantics mini-spec that has not been approved; If/Else and Switch ship first as transition sugar). **Scoped re-tidy** (§4.1's "re-tidy only the affected region") is not implemented — dagre re-ranks the whole component it is handed, so a bounded neighbourhood run is not expressible; placement plus collision avoidance covers the real need and full Tidy stays the single explicit override. **Code view two-way sync** with error squiggles remains Phase 5 — this stage is read-only view + subgraph copy/paste + validation display, which is exactly the retirement precondition §2.2 names. Sub-workflow `outputMapping` merging into the parent context remains the Phase 2a follow-up.
  - **Docs:** user guide (`creating-workflows`, `activities`, `step-types`, `transitions`, `index`) and framework docs (`architecture`, `extending`, `services`, `index`) updated for what actually shipped, including the form-editor retirement and its bridge routes.
- **2026-07-28 (later)** — Phase 4a implemented on branch `feat/workflows-ux-phase4` (stacked on the Phase 2b/3 branch). Additive-only across all 13 contract surfaces; one nullable-column migration.
  - **Phase 0 — debt burn-down first.** Six pre-existing defects, all verified against the code and all fixed before any Phase 4 feature was built, because every claim/role-queue/inbox story sat on top of them:
    1. **A1 — `userTaskConfigSchema` stripped `assignedToRoles`, `formKey` and `allowedActions`.** The editor wrote them, the engine read them, and zod strips undeclared keys while the definitions POST/PUT persist the *parsed* value — so **role assignment authored in the Studio was silently discarded on every save** and the task came out queued to nobody. The same class of object-stripping bug Phase 3b found three times. Hard prerequisite; landed first.
    2. **A9 — a naive duration regex turned `PT30M` into roughly a day.** Consolidated onto the module's existing `lib/duration.ts`.
    3. **A4+A5 — `workflows.task.assigned` was declared and subscribed but never emitted**, role-assigned tasks notified nobody, and the notification deep link pointed at a route that does not exist. Notifications were greenfield, not "surfacing".
    4. **A6 — the task inbox defaulted to "My Tasks" but never sent the filter**, so it showed every task in the organization.
    5. **A8 — the task list dumped raw ORM entities**, so the enterprise "Review proposal" row action read a `proposalId` that was nested inside the authored `formSchema` blob and silently did nothing. Replaced with a serializer that is a strict response superset.
    6. **Module MUST #1** — two of the four `api/tasks/**` routes imported lib functions directly instead of resolving `taskHandler` through DI.
  - **§6.1 task inspector.** Five sections in the node inspector — What (pill-capable title + instructions) / About what (entity bindings) / Who (user · role queue · dynamic-with-required-fallback-roles · rule) / When (priority, deadline, reminders, on-breach) / Decisions (buttons bound 1:1 to durable transition ids, an approval preset, editable-prefilled fields, external form key). Every new `userTaskConfig` key is optional; a config declaring none of them parses byte-identically, pinned by a regression test. New tasks mint `deadline` while existing configs keep `slaDuration` untouched — a superset, not a migration.
  - **§6.2/§6.3 Work Inbox.** `WorkInboxSourceProvider` + a merge-by-module-id registry (modelled on the enricher registry) and the core `user_task` source; `GET /api/workflows/work-inbox` (kind/module/entityType/role/priority/status/overdue/myWork filters, priority → due → created ordering, `limit` clamped to 100, `meta.degradedKinds` for a source that throws); the inbox page re-emitting the FROZEN `workflows.tasks.list` table id; `/backend/tasks` as a bridge redirect with detail urls untouched; task detail as decision-beside-context with claim/release and a one-click next task; `POST /api/workflows/work-inbox/next` walking the claimable queue.
  - **§2.3 entity context.** Resolved `entityBindings` on their own `user_tasks` column, an entity context panel on the task page, and a pending-work panel on record pages. `workflows.task.assigned` carries the bindings so the customers module writes its own `CustomerTodoLink` (`todoSource: 'workflows'`) — workflows announces, the owning module writes.
  - **Deadlines and notifications.** Reminders and deadline breach scheduled once at task creation as delayed jobs on the existing `workflow-activities` queue (job kind `task_sla`, absolute `deadlineAt`, idempotent three ways); a pure `lib/breach-routing.ts` shaped like `lib/error-routing.ts` (`kind: 'slaBreach'` route → `onBreach` → nothing, every fall-through fail-safe); two new events, two new notification types, and a `workflows.tasks.complete` command behind the notification quick action.
  - **§6.1 external forms.** `registerTaskFormRenderer` keyed by `formKey`, pure by contract (type-only imports), duplicate registration throws, an unknown key resolves to a distinguishable `missing` that the surface must announce rather than silently substitute.
  - **A near-miss worth recording.** The brief for the form-registry step said `validateFormData` "validates only the JSON-Schema shape, so the `{fields:[…]}` authoring shape is never validated" — true, but incomplete: `TaskFormFields` also only ever walked `formSchema.properties`, so a **Studio-authored form rendered nothing at all**. Adding the requested required-field validation on its own would have made every Studio-authored task **uncompletable** — a form with no visible fields failing validation on required fields. Both halves now go through one pure `lib/task-form-schema.ts` whose type mapping is the exact inverse of the editor's.
  - **Quick actions are constrained by a platform contract, not by taste.** `notificationService.executeAction` builds the command input from the notification's `sourceEntityId` and **drops `actionId`**, so which decision button was pressed cannot reach the command. One-click completion is therefore offered only for a task with **at most one** decision, no form fields and no editable-prefilled fields; anything else takes the deep link and the command refuses rather than guessing. The platform's only other command-backed notification sidesteps this by giving each button its own command id — unavailable here, since workflow decisions are per-task data. Adding `actionId` to `commandInput` is a cross-module contract change and was not made unasked.
  - **Limits stated rather than implied.** *Pending-work coverage is enumerated, not universal* — no generic record-detail spot id exists in the platform, so it is wired one line at a time (customers person/company/deal footers, the sales order `:tabs`). *A branch-scoped task does not follow its breach route* — a parallel branch advances on its own token, and overriding that is a parallel-execution change; logged as `route_skipped_branch`. *`confirmRequired` has no dialog anywhere in the platform*, so no action declares it and a test asserts that. *`escalationRules` remains dead config* — carried and round-tripped, never executed.
  - **Deliberate deferrals.** `assignedToRoles` still holds role **names** end to end (editor, engine, `claimUserTask`, shipped examples and live rows); moving to immutable ids is a coordinated data + authored-definition migration, and changing only the query side would match nothing — recorded as a risk, not half-done. A rename orphans assignments until then; it is not caller-exploitable, since `auth.roles` is derived server-side. **Phase 5** carries the §6.4 permission flip (pure `lib/task-visibility.ts` predicate, an entity-access resolver with a denormalized `entity_types` SQL gate rather than a lying post-filter, administration ACL features, a read-only tenant opt-out, and an administrative-queue visibility class so agent-disposition tasks stay visible without touching the auto-approve boundary). **Phase 6** carries the portal workstream (`assignee_kind` discriminator, portal ACL features, portal task routes and pages). A real `Task` entity (C3) stays deferred behind the projection, per resolved question #1.
  - **Tests.** Unit coverage added for every step (185 suites / 2302 tests in `modules/workflows`, each step verifying its tests bite by stashing the fix and re-running). Integration: **TC-WF-039** (inbox merge, filters, ordering, limit clamp), **TC-WF-040** (claim-next loop, concurrent claimers, exhaustion), **TC-WF-041** (decision routing + recorded choice + unknown-decision refusal), **TC-WF-042** (the A1 save round trip, plus `PT30M`), **TC-WF-043** (entity bindings and the customers link); **TC-WF-023** extended with the two-simultaneous-claims case and **TC-WF-028** with the two work-inbox gates.
  - **Docs:** user guide (`user-tasks` rewritten around the inspector, the inbox, deadlines, decisions, record-page work and the quick-action limit; `step-types` USER_TASK section corrected) and framework docs (`extending` — the `WorkInboxSourceProvider` and task-form-renderer contracts; `services` — the work-inbox routes, decision completion and the SLA job; `architecture` — the new domain events and the `user_tasks` columns), plus an UPGRADE_NOTES entry leading with the four behavior changes.
- **2026-07-28 (later still)** — **Phases 5 and 6 implemented** on branch `feat/workflows-task-visibility` (stacked on Phase 4a). §6.4's task-permission model and the portal task workstream, shipped together in one move (product-owner decision: `agent_orchestrator` is not production code yet, so the additive-then-flip two-step buys nothing). Additive across all 13 contract surfaces — three new ACL feature ids, two new customer feature ids, six new routes, one new event id, two new nullable/defaulted columns; nothing renamed or removed.
  - **§6.4 the rule itself.** `visible = SCOPE ∧ (RELATIONSHIP ∨ ADMINISTRATIVE) ∧ ENTITY`, `actable = SCOPE ∧ RELATIONSHIP ∧ ENTITY ∧ workable(status) ∧ owns-the-row`, `claimable = actable ∧ unassigned ∧ unclaimed ∧ PENDING ∧ role overlap` — in one PURE function (`lib/task-visibility.ts`: no ORM, no DI, no React, no entity registry), with the impure half resolved once per request by `lib/task-visibility-request.ts` (backoffice) and `lib/portal-task-access.ts` (portal). Every read and act surface routes through it. Three administration features with `dependsOn` chains (`workflows.tasks.view_all` → `.reassign` / `.manage`), a `POST /api/workflows/tasks/[id]/reassign` endpoint that stamps the audit trio plus a `USER_TASK_REASSIGNED` event, an entity-type access resolver sharing the entities module's classification (extracted to `entities/lib/entityClassification.ts`) and one alias dictionary, a tenant-scoped read-only opt-out that fails to the NEW model, and an `administrativeQueueFeature` visibility class on `WorkInboxSourceProvider` so agent-disposition rows stay visible without touching the auto-approve boundary.
  - **Phase 6 portal.** `assignee_kind` discriminator, `portal.tasks.view` / `portal.tasks.complete` seeded through `setup.ts` `defaultCustomerRoleFeatures` (workflows is the platform's **first** consumer of that seam), three portal routes, portal task pages with live updates, and `workflows.task.portal_assigned`.
  - **D-1 (approved deviation).** The spec's ACL appendix says `workflows.tasks.claim` / `.complete` should come off their routes. They stay. Dropping them would strand two FROZEN ACL ids that no route consults, and the sentence's purpose — portal parity — is served by the new `portal.tasks.*` features instead. The narrowing §6.4 actually asks for still lands: holding `.complete` no longer completes anyone else's task.
  - **D-2 (approved deviation).** The entity gate is a denormalized `user_tasks.entity_types text[]` column with a GIN index, not a JS post-filter over a fetched page. A post-filter makes `pagination.total` lie and returns short pages.
  - **Premises challenged during implementation, each of which would have shipped a real defect.** (1) The owner was read as `assignedTo`, which would have let a **role-queue member complete a colleague's already-claimed task**; it resolves as `claimedBy ?? assignedTo`, matching what `completeUserTask` enforces. (2) A literal reading of the entity clause would have **hidden every task bound to a tenant's own custom entity** — classification is shared with the entities module rather than enumerated. (3) `yarn db:generate` emitted a **btree** for `entity_types`, silently defeating the column's entire purpose; the migration writes the GIN index by hand. (4) An owner-less `USER_TASK` was first made a save-blocking Problems **error**, which would have made older definitions — including a shipped gallery template (`order-approval.json`, fixed in the same change) — unsaveable; it is a **warning**, and the uncompletable row's remedy is reassignment, which is why the reassign gate checks visibility and not ownership. (5) **Nothing could produce a portal task at all** until `assigneeKind` became authorable — 6.1/6.2 would otherwise have been authorization over a permanently empty set. (6) `portalBroadcast: true` on `workflows.task.assigned` would have **leaked task names and entity bindings across customers**: the SSE bridge narrows to a single recipient only when the payload carries `recipientUserId`, which that event does not — hence the separate minimal `workflows.task.portal_assigned`.
  - **Deliberate deferrals, stated rather than implied.** **A7** (closing the disposition `UserTask` when a proposal is disposed) stays out — it sits behind `agent_orchestrator/AGENTS.md`'s Ask-First on the auto-approve boundary and the visibility model does not require it; the consequence is disposition rows that are never closed. **Role names → ids** stays out: `assignedToRoles` holds names end to end and `loadAcl` returns no role ids, so changing only the query side would match nothing; a rename still orphans assignments. **`BACKWARD_COMPATIBILITY.md` category 14** ("route authorization semantics") is *proposed*, not merged — adding a contract-surface category is itself a contract change. A **Studio picker for `assigneeKind`** is a follow-up; it is Code-view-only today. A **`sync-customer-role-acls` command** is a follow-up: `defaultCustomerRoleFeatures` reaches new tenants only, so existing tenants grant `portal.tasks.*` by hand. **Per-record ACL** remains out of scope and out of existence — the docs say so plainly rather than implying row-level guarantees. The **backoffice task page still shows Complete to a `view_all` administrator** (the detail response carries no `canComplete`) and has no reassign control; the refusal is server-side only.
  - **Tests.** Unit coverage per step, including the design's 27-case predicate matrix. Integration: **TC-WF-044** (assignment is the grant, in both directions, plus indistinguishable refusals and the legacy zero-binding row), **TC-WF-045** (view_all reads but cannot complete; reassign-to-self is audited and transfers rather than shares), **TC-WF-046** (the opt-out restores reads and only reads), **TC-WF-047** (the owner-less task is uncompletable and reassignment rescues it), **TC-WF-048** (portal ownership, unbound tasks, cross-customer isolation, both-directions route isolation), **TC-WF-049** (a portal admin's `['*']` buys reading, never owning, and stops at the company boundary), **TC-WF-050** (UI: notification deep link → complete).
  - **Docs.** New framework page `framework/workflows/task-visibility.mdx` (the rule, the fail-closed table, the SQL gate, administration, reassignment, 404-vs-403, the portal branch and the `isPortalAdmin` trap, the opt-out, and a Known Limits section); `user-guide/workflows/user-tasks.mdx` gains "Who can see a task" and "Portal tasks"; `framework/workflows/architecture.mdx` and `services.mdx` updated for the new columns, event and routes; a leading UPGRADE_NOTES entry that states plainly this is a security-semantics change to a shipped surface with no BC rule covering it. Security-review evidence against the design's 16-row checklist lives in `.ai/runs/2026-07-28-workflows-task-visibility/SECURITY-REVIEW.md`.
- **2026-07-29** — §8.5 Operations, **first slice only**, on branch `feat/workflows-ops-kpis`: the per-definition KPI rollup. Additive across all 13 contract surfaces; one new table, no change to any existing one.
  - **What shipped.** `WorkflowDefinitionMetricRollup` (`workflow_definition_metric_rollups`) mirroring `AgentMetricRollup`'s SHAPE — tenant/org + logical id + window bounds + `computed_at` + a zod-validated `metrics` jsonb — without importing it, because `enterprise` is an optional peer. A pure arithmetic module (`lib/metrics/definition-metrics.ts`: nearest-rank `percentileOf`, `rateOf`, `buildDefinitionMetrics`, bucket flooring), a query/upsert service, a per-organization scheduled queue worker (`workflow-definition-metric-rollup`, 15-minute bucket and interval), a batched read route `GET /api/workflows/metrics/definitions` behind the new `workflows.metrics.view` feature, and four KPI columns on the definitions list.
  - **Two deliberate divergences from the mirrored model, each fixing a latent flaw in it.** `window_key` is its own column and part of the row key — `AgentMetricRollup` identifies a row by `(org, agent, window_start)` alone, so a 7d window and a 30d window computed in different passes can land on the same `window_start` and silently overwrite each other with metrics for a different span. And the key `(tenant, org, workflow_id, window_key, window_start)` is a DATABASE unique constraint that also carries `tenant_id`; the mirrored writer read-then-inserts with no constraint behind it, so two concurrent passes both miss and both insert.
  - **Idempotency is recompute-and-upsert, never increment.** The pass snaps both window boundaries to a 15-minute bucket and rebuilds the whole window from source rows, so two passes inside one bucket produce byte-identical rows and a pass after the bucket rolls over adds a row rather than mutating history.
  - **Metrics deliberately NOT shipped, because nothing populates them honestly.** A per-step latency p95 from `StepInstance.executionTimeMs` is refused: `exitStep` writes that column on the COMPLETED path only, and every FAILED path (`step-handler`, `activity-worker-handler`, `condition-handler`) sets `exitedAt` and leaves it null — the metric would be a success-only latency wearing the name of a step latency. Run duration is measured from `startedAt` to the terminal timestamp instead. Token/cost per agent step is out for the same reason it cannot be imported: it is enterprise-owned.
  - **Engine gap found, documented, not fixed.** `COMPENSATED` is absent from the rollup's terminal statuses because `compensation-handler` flips the status but writes NO terminal timestamp, and `completeWorkflow` returns before its own `completedAt` assignment on the compensating path — so a compensated run has no instant to attribute to any window and can be counted honestly in none. Writing that timestamp is a state-machine change and is Ask-First.
  - **A rollup ROW is per-organization, so a multi-organization or tenant-wide read scope live-computes** over the resolved set instead of being served from stored rows: counts sum across organizations but a percentile does not, and a KPI that is right about three numbers and wrong about the fourth is worse than a slower one. Every response item reports `source: 'rollup' | 'live'` and every stored row is re-validated against its schema on read.
  - **One pre-existing bug fixed in passing.** `GET /api/workflows/instances/failure-queue` never excluded dry runs, so a simulated failure appeared in the triage list and a bulk replay from that list would have started a REAL instance from a dry run's context. The instance list has excluded them by default since §8.2; this union missed the same filter.
  - **Deliberately left for later PRs, stated rather than implied:** repeated-failure alerts (threshold + cooldown via notifications/webhooks), the process correlation view (instance ↔ agent runs ↔ proposals ↔ tasks, joined on processId/stepId), the triggers reverse lookup, a cross-org health overview SURFACE, retention/archival of completed instances and `workflow_events`, and the *stuck* / *awaiting-disposition-too-long* halves of the needs-attention queue — the *failed* and *attention-parked* halves already ship as `api/instances/failure-queue` with error grouping and bulk replay, which is why the queue was not the slice.
  - **Tests.** 85 unit tests across six suites: the percentile arithmetic (nearest rank, small samples, the off-by-one at p95, numeric-vs-lexicographic sorting), rate/denominator semantics, the worker's queue contract and scope refusal, rollup idempotency across repeated and rolled-over buckets, tenant and organization scoping, dry-run exclusion on every path, and route ACL/scope/staleness/validation refusals. Every assertion was mutation-verified: 21 source mutations were applied one at a time and each made its intended test fail.
