# Run Plan — 2026-07-27-workflows-ux-phase2a

**Branch:** `feat/workflows-ux-phase2a` · **Base:** `feat/workflows-ux-phase1` (STACKED, 3-deep — see Risks) · **Owner:** pat-lewczuk
**Source spec:** `.ai/specs/2026-07-26-workflows-ux-redesign.md` §3.1/§3.5/§3.6/§8.2 + §10 Phase 2a
**Umbrella issue:** #4251 · **Advances:** #4245 (context schema/ledger — the keystone) · **Depends on:** PR #4551 (Phase 1)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | contextSchema field on the definition with round-trip tests | done | fe3694ae0 |
| 1 | 1.2 | Editor plumbing: preserve contextSchema and metadata.editor through load/save/draft | done | 70d514c6c |
| 1 | 1.3 | ContextSchemaEditor UI on the definition panel | done | 5050cb370 |
| 2 | 2.1 | Pure context-ledger module with fixpoint and maybe semantics | done | 892e73b61 |
| 2 | 2.2 | Zod-to-ledger flattener and outputContract wiring | done | 3e03f7f04 |
| 2 | 2.3 | Context-schema API route | done | d9caa2097 |
| 3 | 3.1 | Expression-reference extraction and ledger-checked warnings in Problems | done | 8dbf86e1b |
| 3 | 3.2 | Variable picker button in activity config fields | done | 2985c3a3f |
| 3 | 3.3 | Picker in mapping rows and trigger expressions | done | f274bf78c |
| 4 | 4.1 | Pinned samples storage with size cap and precedence resolver | done | bcd7ee91e |
| 4 | 4.2 | Registry mock widening and would-do mocks for effectors | done | 0aa5714ed |
| 4 | 4.3 | Test-step API route with mock-first semantics and new ACL feature | done | 7558db879 |
| 4 | 4.4 | Editor Test-step UI with output preview and pin-as-sample | done | 1972a0992 |
| 5 | 5.1 | Structured validation error bodies on definition routes | done | fd0b938e5 |
| 5 | 5.2 | Docs, UPGRADE notes, and spec changelog | done | e6e0823c3 |
| 2 | 2.1-review-fix | Explicit comparator in ledger serialization | done | db12744ff |
| 1 | 1.2-review-fix | Legacy edit page preserves contextSchema and metadata.editor; ledger serialization + focus minors | done | 242ddb00b |

## Goal

Ship Phase 2a — the context backbone: a declared `contextSchema` on definitions, a pure per-step context ledger (fixpoint over the graph, `always`/`maybe` presence, honest `unknown` nodes), a variable picker fed by the ledger with reference validation in the Problems panel, pinned per-step samples with a precedence chain, a mock-first per-node Test step, the context-schema API, and structured validation error bodies.

## Scope

`packages/core/src/modules/workflows/`: data (validators contextSchema + metadata.editor, entities TS mirrors), lib (context-ledger NEW, expression-refs NEW, sample-resolver NEW, definition-error-body NEW, activity-registry mock widening, activity-types mocks, interpolateVariables export), api (context-schema route NEW, test-step route NEW, openapi, definitions error bodies), components (ContextSchemaEditor NEW, VariablePickerButton NEW, ActivityConfigFields/MappingArrayEditor/DefinitionTriggersEditor wiring, visual-editor page plumbing + Test-step UI), acl.ts (+1 feature), i18n ×4, docs.

## Non-goals (2b or later, per spec cut lines)

- Pill/token rendering inside inputs, drag-from-input-panel, transform pipeline grammar, strict interpolation default, endpoint picker (#4235), trigger filter-builder — Phase 2b.
- Agent typed I/O (INVOKE_AGENT absent on this lineage).
- `definition.io` alias/dual-emit: the ports contract does NOT exist on the develop lineage (it lives on feat/agent-orchestrator-mvp); reconciliation is that branch's merge concern. contextSchema is defined fresh here.
- Redaction/encryption envelope for samples (no generic redactor exists — XL): replaced by an explicit no-redaction warning in UI + docs; gate is definitions.edit.
- Run-detail "Use as sample" (needs a step-I/O read API); samples source from pins and Test-step outputs only.
- Real execution of side-effecting activities in Test step (impossible to roll back — effects fire post-commit): mock-first with structured refusals.

## Risks

- **3-deep stack** (develop ← phase0 #4532 ← phase1 #4551 ← this). Merge order documented; GitHub auto-retargets down the chain.
- **Silent stripping hazard**: `workflowDefinitionDataSchema`/`workflowMetadataSchema` strip unknown keys and the editor REBUILDS definition+metadata on save — steps 1.1/1.2 must land before anything writes contextSchema/samples, and the editor must carry loaded metadata in state (round-trip tests are the guard).
- **Ledger honesty**: only typed producers contribute types (contextSchema.input, USER_TASK formSchema, trigger targetKeys, SET_VARIABLE paths, UPDATE_ENTITY with declared outputSchema — currently 2 commands); everything else is a named `unknown` node. No fabrication.
- **Enum freeze**: activity registry must register before validators' first import (documented Phase 1 constraint; the ledger's contract seam is injected, not imported, to stay pure/browser-safe).
- **Samples may hold real data**: no redaction in 2a — explicit warning copy + UPGRADE note; size-capped.

## External References

- None. Mockup Screen 2 (picker popover with type badges + samples) is the visual reference.

## Implementation Plan

### Phase 1 — contextSchema

**1.1** `contextSchemaSchema` in validators (`{ input?: { fields: [{name, type: text|number|boolean|select|date, label?, required?, options?}] } }` — same field vocabulary as userTaskConfig formSchema), `contextSchema` optional on `workflowDefinitionDataSchema` + `WorkflowDefinitionData` TS + create/update input schemas (drafts already passthrough). Tests: PUT/POST round-trip keeps it; absent stays absent.

**1.2** Visual editor: load contextSchema into state; re-attach in BOTH save payload sites and BOTH draft payload sites (like `triggers`); carry the LOADED `metadata` object in state and spread it when rebuilding (so unknown/editor keys survive) — groundwork for 4.1. Test: page-level payload builder extracted pure + unit-tested if feasible, else transform-level tests.

**1.3** `ContextSchemaEditor` (FormFieldArrayEditor pattern) on the definition metadata panel (new collapsible "Context" section beside triggers). i18n ×4.

### Phase 2 — Ledger

**2.1** Pure `lib/context-ledger.ts`: input `{steps, transitions, triggers, contextSchema}` + injected `resolveOutputContract(activityType, config)` seam. Kahn order with back-edge tolerance; per-step entries `{path, type, presence: always|maybe, source: {kind, stepId?, activityId?, labelKey}, sample?}`; merge-key modeling per the triage's producer inventory (namespaced activity outputs, `${activityId}_result` async, SET_VARIABLE paths, USER_TASK formData flat, trigger targetKeys + unknown payload wildcard, sub-workflow outputMapping keys, join branches key). Presence: `always` iff on every incoming route. Import-boundary purity test + thorough unit tests (join maybe, cycle, unknown nodes, diamond).

**2.2** `lib/ledger-schema-flatten.ts`: Zod schema → ledger entries (object/scalar/array-of-object, depth ≤3, else `unknown`); wire UPDATE_ENTITY's outputContract through the injected seam in the editor's resolver (client-safe: resolve via a small API? NO — commandRegistry is jsdom-safe per Phase 1; verify and use directly in the server route; for the CLIENT ledger, outputContract resolution goes through the 2.3 API response, not local resolution). Decide in-step with evidence; tests.

**2.3** `GET api/definitions/[id]/context-schema` (+`?stepId=`): serves the server-computed ledger (server has full registry + command schemas), response `{steps: {stepId: {entries}}}`, feature `workflows.definitions.view`, typed openApi + registered in the openapi guard test. Route tests incl. maybe-at-join fixture.

### Phase 3 — Picker + validation

**3.1** Pure `lib/expression-refs.ts` extracting `{{context.*}}` refs from step/transition activity configs + mappings; editor merges ledger-miss warnings (severity warning, never blocking) into Problems via collect-validation-issues; input red-ring on offending fields where cheap. Tests: extraction + mapping to node/edge.

**3.2** `VariablePickerButton` (Popover + ledger tree grouped by source, type badges, maybe markers, sample values when present; click inserts `{{path}}` at cursor via shared `insertAtCursor`) wired into ActivityConfigFields text/textarea/datetime-template branches. Client fetches the ledger from 2.3's API (SWR-ish memo on definition state changes; debounced). i18n ×4. Component tests: insertion at cursor, grouping, maybe badge.

**3.3** Same picker in MappingArrayEditor value cells and DefinitionTriggersEditor sourceExpression rows (trigger rows get the trigger-scope ledger: `__trigger.*` + payload wildcard). Tests.

### Phase 4 — Samples + Test step

**4.1** `metadata.editor.samples` in workflowMetadataSchema (`record(stepId, {pinnedAt, source: manual|test, data})`, total-size refine ≤64KB) + TS mirror; pure `lib/sample-resolver.ts` (pin > last test output (in-memory) > ledger-derived placeholder) + tests; editor keeps samples in the carried metadata (1.2 groundwork). No-redaction warning copy where pinning happens.

**4.2** Registry: widen `mock` to `((config, ctx) => unknown) | 'refuse'`; add would-do mocks: SEND_EMAIL `{sent:false, simulated:true, wouldSendTo}`, EMIT_EVENT `{emitted:false, simulated:true, eventName}`, CALL_WEBHOOK `{simulated:true, wouldCall:{url,method}}`, UPDATE_ENTITY `{executed:false, simulated:true, commandId}`, EXECUTE_FUNCTION `'refuse'` (arbitrary code), WAIT synthetic `{waited:true, simulated:true}`, CALL_API `'refuse'` in 2a (its one-time-key path is not simulation-safe; GET allowlist can come later). Tests per entry.

**4.3** `POST api/definitions/[id]/test-step` `{stepId?, activityType, config, context}`: interpolate (export `interpolateVariables`), mock-first; `'refuse'`/no-mock → structured `{refused: true, reason}`; new ACL feature `workflows.definitions.test_run` (dependsOn definitions.edit) in acl.ts (admin wildcard covers seeding); typed openApi + guard-test registration; route tests (auth/feature/tenant, mock result, refusal shape).

**4.4** Editor: ▶ Test step button in the activity config area — builds context from the sample resolver, calls 4.3, renders output preview (JsonDisplay-style) with simulated/refused states, "Pin as sample" writes `metadata.editor.samples[stepId]` (with the no-redaction warning). Picker (3.2) shows pinned/test samples. i18n ×4. Component test with mocked apiCall.

### Phase 5 — Errors + docs

**5.1** `lib/definition-error-body.ts` normalizing Zod issues to `{path, code, message, expected?, got?}` in-place on definitions POST/PUT 400 bodies (BC-safe: `path`+`message` preserved for format-validation-error); tests on both routes.

**5.2** Docs: user-guide (context schema, picker, test step, samples incl. no-redaction warning), module AGENTS.md (ledger module, contextSchema contract, test-step route), UPGRADE_NOTES (new ACL feature sync note, samples caveat), spec changelog line.
