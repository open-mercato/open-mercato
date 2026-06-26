# Sub-workflow Explicit Ports + Schema Builder

## TLDR

**Key Points:**
- Give workflows a **visible, business-user-editable input/output contract** ("ports") so a non-technical analyst can see and edit what a sub-workflow accepts and returns *from the parent node, without opening its internals*.
- Pattern: **Explicit Ports + Schema Builder** — a workflow definition declares a typed IO contract; the parent's `SUB_WORKFLOW` node renders those ports and maps fields to them.
- Make definitions **safely versioned** (draft → published, immutable published versions) so editing a shared sub-workflow never silently breaks live callers.

**Scope:**
- `definition.io = { inputs, outputs }` IO contract on the workflow definition with 5 business-friendly types (tekst / liczba / tak‑nie / lista opcji / data → `text / number / boolean / select / date`).
- A **Schema Builder** UI (reusing `FormFieldArrayEditor`) split into IN / OUT sections.
- **Runtime validation/coercion** of mapped values against declared ports at the SUB_WORKFLOW boundary (only when a contract is declared).
- **Component** definitions — reusable library items with no trigger that cannot start standalone — surfaced in a "Biblioteka komponentów" list.
- **Full version lifecycle** for *all* definitions: draft → published, version pinning on SUB_WORKFLOW, "latest published" resolution.
- **Port rendering** on `SubWorkflowNode` (multiple xyflow handles) + **"Otwórz środek"** drill‑down.
- **Breaking-change detection** at publish time, then **drag-and-drop** field mapping as an alternative to the key/value form.

**Concerns:**
- The version lifecycle change alters a **contract surface**: `workflow_definitions` uniqueness `(workflowId, tenantId)` → `(workflowId, version, tenantId)`, and definition resolution moves from "latest enabled" to "latest published". This is the Ask‑First / `BACKWARD_COMPATIBILITY.md` item and the largest blast radius in this spec.
- Runtime type enforcement must be **opt‑in by contract presence** so existing untyped callers are unaffected.
- Drag-and-drop introduces a **second edge class** (data mapping vs control flow) into a canvas that today only models control flow.

---

## Overview

The workflows module lets users compose step-based processes in a visual (React Flow / `@xyflow/react`) editor. A `SUB_WORKFLOW` step invokes another definition as a child and maps data in/out. Today that mapping is a freeform key/value form over **untyped dot-paths**, the child's expected inputs/outputs are **invisible** unless you open it, any definition is implicitly reusable with **no declared contract**, and `workflow_definitions` allows **only one live row per `workflowId`** so editing a shared sub-workflow mutates what every caller resolves to.

This spec introduces an **explicit, typed, business-user-friendly IO contract** ("ports"), a **Schema Builder** to author it, **port rendering + drill-down** on the canvas, and a **draft/published version lifecycle** so a schema edit produces a new version and never silently breaks live callers. The audience is the **business analyst** building automations in the UI — types are presented as five plain labels (tekst/liczba/tak‑nie/lista/data), never Zod or TypeScript.

> **Market Reference**: Studied **n8n** (its "Execute Sub-workflow" node + recently added *workflow input schema* that surfaces a child's expected fields on the parent node) and **Camunda/Zeebe** (the *Call Activity* with explicit input/output **variable mappings** and **process version binding**: `latest` vs pinned `version`). **Adopted**: n8n's visible child input schema on the parent node, and Camunda's explicit IO variable mapping + version binding. **Rejected**: Temporal's typed child workflows (code-first, requires TS — too technical for the target user) and Zapier/Make token mapping (great field-level mapping but the sub-flow's own schema stays hidden — the exact opacity we are removing).

## Problem Statement

1. **Opaque contracts.** A `SUB_WORKFLOW` node shows only `Invokes: <name> v<version>` (`SubWorkflowNode.tsx`). The user cannot see what the child needs or returns without opening it.
2. **Untyped, unvalidated mapping.** `subWorkflowConfig.inputMapping`/`outputMapping` are `Record<string,string>`; `mapInputData`/`mapOutputData` walk dot-paths with **no schema** and **no validation** that mapped keys exist or have the right type (`step-handler.ts`).
3. **No component concept.** There is no flag distinguishing a reusable library component from a runnable workflow (`entities.ts`); reusability is implicit. Components and standalone workflows are listed together (`api/definitions/route.ts`, `backend/definitions/page.tsx`).
4. **Unsafe edits — no real versioning.** `workflow_definitions` is unique on `(workflowId, tenantId)` (`entities.ts:154`); multiple versions cannot coexist as live rows, and resolution is "latest enabled, version DESC" (`find-definition.ts`). Editing a shared sub-workflow mutates the row every caller resolves to — a silent breaking change.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Contract stored in **`definition.io`** (jsonb, additive) on the **child** definition; field mapping stays in the **parent** step's `config.inputMapping`/`outputMapping` | Mirrors the mockup's two tabs ("Schemat portów" edits the child contract; "Mapowanie pól" edits the parent mapping). No new column; additive to the existing jsonb `definition`. Contract versions together with the definition. |
| **Full draft→published versioning for ALL definitions** (Q1) | One uniform lifecycle is simpler to reason about than two; the schema-edit-creates-a-version flow must hold for any callable definition. Cost: a module-wide migration + resolution change (see Migration & BC). |
| **Explicit Publish** (Q2): one mutable `draft` per `workflowId` + N frozen `published` versions | Breaking-change detection runs once, at Publish. Avoids version sprawl. Matches "Zapisz schemat" → publish. |
| **Any definition remains callable** as a sub-workflow (Q4); `kind=component` only *adds* constraints (no trigger, not standalone-startable) + library placement | Backward-compatible: existing seed/demo sub-workflows keep working. A child without `definition.io` falls back to today's freeform passthrough. |
| **Runtime validation/coercion in v1** (Q5), gated on contract presence | Real guarantees for the typed path; zero impact on legacy untyped callers because validation only runs when the child declares `definition.io`. |
| Resolution becomes **"latest published"** (was "latest enabled"); unpinned SUB_WORKFLOW edges **auto-pin** the selected published version (Q3) | Deterministic caller behaviour; pinning is what makes versioning protective. |
| **Adopted defaults (confirm in review):** (N1) only `published` versions auto-start via triggers — drafts are manual/test-run only; (N2) a port validation failure **fails the step** with a structured error routed through existing compensation | Safe-by-default: never auto-run unpublished logic in production; treat bad data like any other activity failure rather than silently dropping fields. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Typed Contract (Zod/TS-generated IO types) | Too technical for the business analyst; requires a build step and code literacy. |
| Token-based mapping only (Zapier/Make style) | Excellent field mapping but hides the sub-workflow's own schema — the core opacity we are eliminating. |
| Components-only versioning | Rejected by user (Q1 = all definitions) in favour of one uniform lifecycle. |
| Advisory-only types in v1 | Rejected by user (Q5 = runtime validation) for stronger guarantees. |

> **Existing foundation:** PR #3679 (merged to `feat/agent-orchestrator-mvp`) already merges a `SUB_WORKFLOW`'s `outputMapping` into the parent context, so output ports actually flow downstream — the prerequisite for chaining ports is already in place.

## User Stories / Use Cases

- **Analityk** wants to **see a sub-workflow's IN/OUT fields and types directly on its node** so that **mapowanie can be done without opening the component**.
- **Analityk** wants to **edit the sub-workflow's port schema (add/remove a field, change its type)** from the parent so that **the contract evolves without leaving the canvas**.
- **Analityk** wants a **warning listing how many existing connections an edit would break** so that **a schema change does not silently corrupt callers**.
- **Builder** wants to **publish a new version of a shared component** so that **existing callers keep running the version they were pinned to**.
- **Builder** wants to **drag a line from a source field to a child IN port** so that **mapping feels like connecting nodes**.

## Architecture

### Contract & two-surface model

```
Child definition (the component)                Parent step (the caller)
┌───────────────────────────────┐               ┌───────────────────────────────┐
│ definition.io                 │  ← "Edytuj    │ step.config (SUB_WORKFLOW)     │
│   inputs:  PortField[]        │     schemat"  │   subWorkflowId               │
│   outputs: PortField[]        │               │   version  (pinned, published)│
│                               │  "Mapowanie   │   inputMapping  : { childPort → parentPath } │
│ (versioned with definition)   │   pól" →      │   outputMapping : { parentKey → childPort } │
└───────────────────────────────┘               └───────────────────────────────┘
        ▲ Schema Builder (FormFieldArrayEditor)          ▲ key/value form OR drag-and-drop data edges
```

### Runtime (SUB_WORKFLOW boundary, validation gated on contract presence)

```
parent.context ──mapInputData(dot-paths)──▶ childContext
                                            │
                         child.definition.io.inputs declared?
                              ├─ no  → start child as today (freeform)
                              └─ yes → validateAgainstPorts(childContext, inputs)   ← coerce + require
                                          fail → step FAILED (structured error → compensation)
                                          pass → startWorkflow(child, version=latest published | pinned)
child completes → result.context ──mapOutputData──▶ outputData
                              child.definition.io.outputs declared?
                              ├─ no  → applyTokenContextWrites as today (#3679)
                              └─ yes → validateAgainstPorts(outputData, outputs) → merge into parent context
```

### Definition resolution & lifecycle

```
lifecycle: draft → published → archived
resolve(workflowId, version?) =
   version pinned  → that exact row
   unpinned        → MAX(version) WHERE lifecycle=published AND enabled  (was: latest enabled)
triggers fire      → resolve unpinned (published only); drafts never auto-start (N1)
component (kind)   → no triggers allowed; manual standalone start rejected; callable as SUB_WORKFLOW only
```

### Commands & Events

- **Event** (new, additive, `createModuleEvents`): `workflows.definition.published` — emitted when a draft is promoted to a published version. Enables audit/notification and future cache invalidation.
- **Publish** is a guarded mutation (not `makeCrudRoute` CRUD): wrap via `useGuardedMutation` client-side and the mutation-guard contract server-side. "Undo" = archive the new published version + restore prior `latest published` pointer (no destructive delete).

## Data Models

### WorkflowDefinition (additive changes only)

Existing columns unchanged. **New/changed:**

- `kind`: enum `workflow | component` — **new column**, default `workflow`. Components: no triggers, not standalone-startable, shown in the component library.
- `lifecycle`: enum `draft | published | archived` — **new column**, default `published` (existing rows backfilled to `published`).
- **Unique constraint change**: `(workflowId, tenantId)` → `(workflowId, version, tenantId)`. *(Contract surface — see Migration & BC.)*
- `definition.io` (inside existing jsonb `definition`, additive, optional):

```ts
type PortFieldType = 'text' | 'number' | 'boolean' | 'select' | 'date'
interface PortField {
  name: string            // stable key, regex /^[a-zA-Z][a-zA-Z0-9_]*$/
  type: PortFieldType
  label: string           // business-facing label
  required: boolean
  options?: string[]      // for type 'select'
}
interface WorkflowIoContract { inputs: PortField[]; outputs: PortField[] }
// WorkflowDefinitionData gains: io?: WorkflowIoContract
```

Validators (`data/validators.ts`): add `portFieldSchema`, `workflowIoContractSchema`; extend `workflowDefinitionDataSchema` with `io: workflowIoContractSchema.optional()`; add a refinement: `kind=component ⇒ (definition.triggers is empty)`.

### No new entity for caller graph

Breaking-change detection queries the existing jsonb (`definition @> [{stepType:'SUB_WORKFLOW', config:{subWorkflowId:X}}]`) — no denormalized reverse-index table in v1 (revisit only if the scan is too slow at scale; see Risks).

## API Contracts

### Definitions list (extend existing `GET /api/workflows/definitions`)
- Add query params: `kind` (`workflow|component`), `lifecycle` (`draft|published|archived`).
- Response item adds `kind`, `lifecycle`.
- ACL: `workflows.definitions.view` (unchanged).

### Publish a draft (new)
- `POST /api/workflows/definitions/{id}/publish`
- Effect: validates the draft, mints a frozen `published` version (`version = max(version)+1`), runs breaking-change detection, emits `workflows.definition.published`.
- Request: `{ acknowledgeBreakingChanges?: boolean }` — required `true` when the preview reports affected callers.
- Response: `{ id, workflowId, version, lifecycle, breakingChanges: CallerImpact[] }`
- ACL: **new** `workflows.definitions.publish` (additive; granted to `admin`, `superadmin`).
- Guard: mutation-guard contract; `openApi` exported.

### Breaking-change preview (new)
- `GET /api/workflows/definitions/{id}/callers` → `{ callers: CallerImpact[] }`
- `CallerImpact = { workflowId, version, stepId, brokenMappings: string[] }` — computed by diffing the draft's ports against each caller's `inputMapping`/`outputMapping` keys.
- ACL: `workflows.definitions.view`.

### Schema + mapping edits
- Reuse the existing definition update route (PUT) to persist `definition.io` (Schema Builder) and parent `inputMapping`/`outputMapping` (mapping form / drag-drop). No new endpoint; drag-drop writes the same `inputMapping` payload.

## Internationalization (i18n)

New keys under `workflows.*` in `i18n/{en,es,de,pl}.json`:
- `workflows.ports.{title,inputs,outputs,addInput,addOutput,required,type}` and 5 type labels `workflows.ports.types.{text,number,boolean,select,date}` (PL: tekst / liczba / tak‑nie / lista opcji / data).
- `workflows.ports.openInside` ("Otwórz środek"), `workflows.ports.editSchema` ("Edytuj schemat").
- `workflows.versioning.{draft,published,archived,publish,cannotRunStandalone}`.
- `workflows.breakingChange.{warning,affectedConnections}` (with `{count}` interpolation).
- Run `yarn i18n:check`; internal-only `throw`/`toast` strings prefixed `[internal]`.

## UI/UX

> All UI MUST follow the Design System: semantic status tokens (no `text-red-*`/`bg-amber-*`), DS text scale (no arbitrary `text-[13px]`), shared primitives (`Alert`, `StatusBadge`, `FormField`, `SectionHeader`, `Tabs`, `Spinner`/`LoadingMessage`), lucide-react icons, dialogs `Cmd/Ctrl+Enter` submit + `Escape` cancel, `aria-label` on icon-only buttons.

- **Schema Builder dialog** (two tabs — "Schemat portów" / "Mapowanie pól"): reuse `FormFieldArrayEditor`, restricted to the 5 types, in IN/OUT sections with a `required` checkbox per field. Breaking-change banner is an `Alert` with **status token** (e.g. `bg-status-warning-*`), **not** `bg-amber-*`; shows `{count}` affected connections.
- **SubWorkflowNode** renders IN ports (top) and OUT ports (bottom) as labeled rows with per-port xyflow `Handle`s; a `subworkflow` badge; "Edytuj schemat" and "Otwórz środek" as two distinct `Button`s.
- **Two edge classes** (control vs data) MUST be distinguished by **semantic DS tokens** (define `--edge-control` / `--edge-data` mapped to existing palette roles, e.g. primary vs accent) — not hardcoded green/purple from the mockup.
- **"Otwórz środek"** opens the child definition (pinned version) in the visual editor (modal or route), read-only unless it is the editable draft.
- **Component library** list ("Biblioteka komponentów"): existing `DataTable` filtered `kind=component`; hint row "subworkflow nie może być uruchamiany samodzielnie".

### Frontend Architecture Contract

The visual editor is an existing heavy client island (`@xyflow/react`).
- **Server/Client boundary:** new dialogs (`SchemaBuilderDialog`, breaking-change `Alert`) and node/edge components are **client** (`"use client"`); the definitions list page stays a server component delegating to the existing client `DataTable`. Caller-preview and publish are server routes; the client calls them via `apiCall`/`useGuardedMutation` (never raw `fetch`).
- **`"use client"` ledger:** `SchemaBuilderDialog.tsx` (form state), `SubWorkflowNode.tsx` (already client; +ports), `WorkflowDataMappingEdge.tsx` (new, interactive), `OpenInsideModal.tsx` (nav). Each justified by interactivity.
- **Client blob guardrail / budgets:** no new heavy deps (reuse `@xyflow/react`, existing primitives); ports/edges add render logic only. Editor route JS budget unchanged ±small; verify with a bundle check before merge.
- **Hydration/interactivity tests:** ports render from contract; drag-drop creates a data edge that persists as `inputMapping`; "Otwórz środek" navigates. Performance evidence: editor interaction (drag, open) stays within current frame budget on a 30-node graph.

## Migration & Compatibility

This is the spec's Ask-First contract-surface change (`BACKWARD_COMPATIBILITY.md` → DB schema + resolution semantics). Per the coding-agent migration rule, author a **scoped** SQL migration for the workflows module and update its `.snapshot-open-mercato.json` in the same change; do **not** run `yarn db:migrate`.

**Schema migration (workflows module):**
1. Add `kind` (default `'workflow'`), `lifecycle` (default `'published'`) columns.
2. Backfill: every existing row → `lifecycle='published'`, `kind='workflow'`. Rows with `enabled=false` → `lifecycle='archived'` (preserves "not resolvable" behaviour). `version` retained.
3. Replace unique index `(workflowId, tenantId)` with `(workflowId, version, tenantId)`. Existing rows have distinct `workflowId` so this never conflicts on backfill.
4. Optional GIN index on `definition` to keep the caller `@>` scan fast.

**Resolution change (`find-definition.ts`):** "latest enabled, version DESC" → "latest **published**, version DESC, enabled". Because all existing rows backfill to `published`, **observed behaviour is identical** for current data; the change only matters once drafts exist. Keep `version`-pinned lookups byte-for-byte unchanged.

**Backward compatibility guarantees:**
- `definition.io` is optional ⇒ existing definitions have **no contract** ⇒ **no runtime validation** ⇒ identical execution (additive).
- `subWorkflowConfig` shape unchanged; unpinned calls keep resolving to latest (now published).
- New ACL `workflows.definitions.publish` is additive; added to `setup.ts` `defaultRoleFeatures` and synced via `yarn mercato auth sync-role-acls`.
- New event `workflows.definition.published` is additive (`as const`).
- Deprecation protocol: no removals. `enabled` column retained (now derived/secondary to `lifecycle`); documented in RELEASE_NOTES with a one-minor bridge before any future removal.

## Implementation Plan

> Sequencing note: Phases 1–4 are independently shippable and **do not require** versioning. Phase 5 (versioning + breaking-change) is the keystone that makes "Edytuj schemat" safe on shared components; if schema editing must be safe on day one, Phase 5 may be pulled ahead of a broad rollout. Order below follows the user's requested order.

### Phase 1 — IO contract + Schema Builder + runtime validation
1. Add `portFieldSchema`, `workflowIoContractSchema`; extend `workflowDefinitionDataSchema` with optional `io` (`data/validators.ts`).
2. Add `lib/port-contract.ts`: `validateAgainstPorts(values, ports) → { coerced } | structured error` (coercion: text→String, number→Number/reject NaN, boolean→`parseBooleanToken`, select→∈options, date→ISO parse).
3. Wire validation into `handleSubWorkflowStep` (`step-handler.ts`): validate mapped inputs before `startWorkflow` and mapped outputs before merge — **only when the child declares `definition.io`**; failure → `status:'FAILED'` with structured error.
4. `SchemaBuilderDialog.tsx` reusing `FormFieldArrayEditor`, restricted to 5 types, IN/OUT sections; two-tab shell ("Schemat portów" / existing mapping form as "Mapowanie pól"). i18n keys.
5. Unit tests: validator coercion/failure per type; `step-handler` validates only when contract present; no-contract path unchanged.

### Phase 2 — Component flag + library listing
1. Add `kind`/`lifecycle` columns + scoped migration + snapshot (foundation also used by Phase 5).
2. Validator refinement: `kind=component ⇒ no triggers`. Reject manual standalone start of a component in `api/instances` (callable only as SUB_WORKFLOW).
3. Extend definitions list API + page with `kind`/`lifecycle` filters; add "Biblioteka komponentów" view.
4. Tests: component cannot autostart/standalone-start; library filter; component still callable as sub-workflow (Q4).

### Phase 3 — Port rendering on SubWorkflowNode
1. Render IN/OUT port rows + per-port xyflow `Handle`s (stable ids `in:<name>` / `out:<name>`) from the child contract.
2. Define `--edge-control` / `--edge-data` DS tokens; control edges keep existing style.
3. Tests/visual: ports reflect contract; node still connects control-flow edges as before.

### Phase 4 — "Otwórz środek" drill-down
1. `OpenInsideModal` (or route) loading the child definition at the pinned version into the existing editor; read-only unless editable draft.
2. Tests: opens correct version; no mutation in read-only mode.

### Phase 5 — Version lifecycle + breaking-change detection (keystone)
1. Unique-constraint migration `(workflowId, version, tenantId)` + resolution change in `find-definition.ts` (latest published).
2. Draft/publish flow: editor "save" writes draft; `POST .../publish` mints a published version, emits `workflows.definition.published`.
3. `GET .../callers` + `lib/caller-graph.ts` (jsonb `@>` scan) + port-diff → `CallerImpact[]`; publish requires `acknowledgeBreakingChanges` when non-empty.
4. SUB_WORKFLOW edges created via the UI auto-pin the selected published version.
5. ACL `workflows.definitions.publish` in `acl.ts` + `setup.ts`; sync.
6. Tests: versions coexist; trigger fires latest published; pinned caller unaffected by new version; breaking-change count correct; backfill parity (existing rows resolve identically).

### Phase 6 — Drag-and-drop data-edge mapping
1. `WorkflowDataMappingEdge.tsx` (data-token colour); `onConnect` detects port handles and writes `inputMapping` (parent path ← available-variable palette per D3) instead of a transition.
2. Flatten available context keys into a source palette (MVP; no per-node typed outputs).
3. Key/value form retained as fallback; round-trip parity test (drag-drop ⇄ form produce identical `inputMapping`).

### File Manifest (primary)
| File | Action | Purpose |
|------|--------|---------|
| `data/validators.ts` | Modify | Port/IO schemas; component refinement |
| `data/entities.ts` | Modify | `kind`, `lifecycle` columns; unique constraint |
| `migrations/*` + `.snapshot-open-mercato.json` | Create/Modify | Scoped schema migration + backfill |
| `lib/port-contract.ts` | Create | Validate/coerce values vs ports |
| `lib/step-handler.ts` | Modify | Gate validation at SUB_WORKFLOW boundary |
| `lib/find-definition.ts` | Modify | Latest-published resolution |
| `lib/caller-graph.ts` | Create | jsonb caller lookup + port diff |
| `api/definitions/route.ts` | Modify | `kind`/`lifecycle` filters |
| `api/definitions/[id]/publish/route.ts` | Create | Publish + breaking-change ack (`openApi`, guard) |
| `api/definitions/[id]/callers/route.ts` | Create | Breaking-change preview |
| `api/instances/route.ts` | Modify | Reject standalone start of components |
| `acl.ts`, `setup.ts` | Modify | `workflows.definitions.publish` |
| `events.ts` | Modify | `workflows.definition.published` |
| `components/fields/SchemaBuilderDialog.tsx` | Create | Ports builder (reuses `FormFieldArrayEditor`) |
| `components/nodes/SubWorkflowNode.tsx` | Modify | Port rows + handles + buttons |
| `components/WorkflowDataMappingEdge.tsx` | Create | Data-mapping edge (Phase 6) |
| `components/OpenInsideModal.tsx` | Create | Drill-down |
| `i18n/{en,es,de,pl}.json` | Modify | New keys |

### Testing Strategy
- **Unit:** port validation/coercion; resolution (latest published, pinned); caller-diff; component constraints.
- **Integration (per spec rule, self-contained fixtures via API):** create child component with `definition.io` → call from parent → assert typed mapping validated and output merged; publish v2 with a removed port → assert pinned caller on v1 unaffected and breaking-change preview reports the v2-bound caller; component rejected on standalone start.

## Risks & Impact Review

### Data Integrity Failures
- Concurrent draft edits / publish: two users publishing the same `workflowId` could race on `version=max+1`. Mitigation: compute next version inside the publish transaction with the new unique `(workflowId, version, tenantId)` as the backstop (insert conflict → retry).
- Runtime validation mid-flight: a coercion failure fails the step atomically before the child starts (inputs) or before merge (outputs); no partial parent-context write.

### Cascading Failures & Side Effects
- Resolution change affects **every** trigger-started and sub-workflow-invoked definition. Mitigation: backfill makes current behaviour identical; covered by a parity test.
- `workflows.definition.published` subscribers must not block publish (persistent subscriber, retried).

### Tenant & Data Isolation Risks
- Caller `@>` scan and publish are tenant-scoped (`tenantId` in every query). No global/shared state introduced.

### Migration & Deployment Risks
- Unique-constraint swap + two new columns: backward-compatible, re-runnable; backfill is O(rows) and bounded per tenant. No downtime expected (additive columns + index swap).

### Operational Risks
- jsonb caller scan cost grows with definition count. Mitigation: GIN index on `definition`; if insufficient at scale, add a denormalized caller index table (explicitly out of scope for v1, logged here).
- Version sprawl from frequent publishes. Mitigation: explicit Publish (not save-as-version) + future `archived` pruning.

### Risk Register

#### Resolution semantics regression
- **Scenario**: Switching "latest enabled" → "latest published" changes which version an existing trigger fires.
- **Severity**: High
- **Affected area**: `find-definition.ts`, all triggers + unpinned SUB_WORKFLOW calls.
- **Mitigation**: Backfill all existing rows to `published`; parity integration test asserting identical resolution pre/post for current data.
- **Residual risk**: A tenant relying on `enabled=false` as a soft "draft" sees those rows become `archived` (still non-resolvable) — equivalent behaviour.

#### Runtime validation rejects previously-passing data
- **Scenario**: A child gains `definition.io`; a caller's loosely-typed value now fails coercion and the step fails.
- **Severity**: Medium
- **Affected area**: `step-handler.ts` SUB_WORKFLOW boundary.
- **Mitigation**: Validation only runs when the child declares a contract (opt-in by authoring it); breaking-change preview surfaces affected callers at publish; failure is a normal step failure (compensable), not data corruption.
- **Residual risk**: Authoring a contract on a busy child can fail in-flight callers until mappings are fixed — intended, surfaced by the preview.

#### Unique-constraint migration
- **Scenario**: Index swap fails or backfill partially applies.
- **Severity**: Medium
- **Affected area**: `workflow_definitions` schema.
- **Mitigation**: Single scoped migration, additive columns first then index swap; re-runnable; snapshot updated in the same change.
- **Residual risk**: None significant; rollback = drop new columns + restore old unique index.

## Final Compliance Report — 2026-06-26

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/workflows/AGENTS.md`
- `packages/ui/AGENTS.md`, `.ai/ds-rules.md`, `.ai/ui-components.md`
- `packages/shared/AGENTS.md` (boolean parsing, i18n)
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No cross-module ORM relationships | Compliant | All within workflows; no new cross-module FK. |
| root AGENTS.md | Filter by organization_id/tenant_id | Compliant | Caller scan, publish, resolution all tenant-scoped. |
| core AGENTS.md | API routes export `openApi` | Compliant | Publish + callers routes export `openApi`. |
| core AGENTS.md | Non-CRUD writes use mutation-guard contract | Compliant | Publish wired through guard; client via `useGuardedMutation`. |
| workflows AGENTS.md | Event IDs `module.entity.action`, declared `as const` | Compliant | `workflows.definition.published`. |
| workflows AGENTS.md | Never mutate instance/definition state without event | Compliant | Publish emits event; draft edits are pre-run authoring. |
| shared AGENTS.md | Boolean parsing via `parseBooleanToken` | Compliant | Used in `boolean` port coercion. |
| ui AGENTS.md / ds-rules | Semantic tokens; no hardcoded status colors; `apiCall` only | Compliant | Edge/warning colours mapped to DS tokens; `apiCall`/`useGuardedMutation`. |
| BACKWARD_COMPATIBILITY.md | DB schema = contract surface; deprecation protocol | Compliant (Ask-First acknowledged) | Additive columns; constraint swap documented; no removals; `enabled` retained with bridge. |
| core AGENTS.md | Editable entities expose `updated_at` / optimistic lock | Compliant | `WorkflowDefinition` already has `updatedAt`; publish path respects it. |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | `kind`/`lifecycle`/`io` reflected in list + publish responses. |
| API contracts match UI/UX | Pass | Publish/callers back the breaking-change banner; list filters back the library. |
| Risks cover all write operations | Pass | Publish, schema edit, runtime validation, migration covered. |
| Commands/guards defined for all mutations | Pass | Publish guarded; CRUD edits via existing route. |
| i18n covers new user-facing strings | Pass | Keys enumerated; `yarn i18n:check` gate. |

### Verdict
- **Fully compliant** — Approved for implementation, with the **Ask-First** acknowledgement that the `workflow_definitions` uniqueness + resolution change is a contract-surface change executed under the documented Migration & Backward-Compatibility plan. Two adopted defaults (N1 trigger-published-only, N2 validation-failure-fails-step) to be confirmed during review.

## Changelog
### 2026-06-26
- Initial specification. Open Questions Q1–Q5 resolved (Q1 all-definitions versioning; Q2 explicit publish; Q4 keep-any-callable; Q5 runtime validation; Q3 latest-published adopted). Defaults N1/N2 adopted pending review confirmation.
