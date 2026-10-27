# Phase 2b Implementation Briefing — Workflows UX Redesign

Spec: `.ai/specs/2026-07-26-workflows-ux-redesign.md` (all quotes below from it unless noted).
Roadmap entry (spec:441): **"2b: pill transform pipeline (new interpolator grammar); strict mode; endpoint picker (#4235); trigger event-picker/filter-builder/mapping; agent typed I/O (§3.4/§7.1); drag-from-input-panel."** — "Closes: #4245, #4235. Depends: Phase 1 registry, #4230."

All code paths relative to repo root `/Users/pat-lewczuk/projects/open-mercato/2/open-mercato`. Phase 0/1/2a are already merged on `feat/agent-orchestrator-mvp` (registry, ledger, picker, samples, test-step, context-schema API all exist).

## Governing constraints (from AGENTS.md files)

- `packages/core/src/modules/workflows/AGENTS.md`:
  - Interpolation rule (Always #7): `{{context.*}}`, `{{workflow.*}}`, allowlisted `{{env.*}}`, `{{now}}`; never read secrets from env.
  - `lib/context-ledger.ts` and `lib/expression-refs.ts` MUST stay **pure** (no React/ORM/DI/registry imports); output-contract resolution is the injected `resolveOutputContract` seam; browser never resolves contracts locally.
  - Ref-check misses are **Problems-panel WARNINGS, never blocking** — strict mode changes runtime behavior, not save validation.
  - `contextSchema` is canonical; `definition.io.inputs` is a read-through alias. Definition-format evolution must be **additive** (`BACKWARD_COMPATIBILITY.md`; definition JSONB is a contract surface — Ask First applies).
  - Activity registration must stay UI-safe (no server-only imports from `lib/activity-types.ts`; use the `bindActivityExecutor` seam).
  - Samples are NOT redacted; per-type config validation is warnings-only in Phase 1 ("strict mode is a later opt-in" — that is this phase).
  - Ask First: changing state machines, SSRF guard, trigger storm controls, coupling modules to workflow internals.
- `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`:
  - Core must never import enterprise; the workflow bridge is DI `agentWorkflowBridge` resolved via `tryResolve` (optional peer; the agents API 404s when absent and core UI must degrade).
  - `generated/file-agents.generated.ts` is generator output — never hand-edit; OUTCOME.md = frontmatter `kind` + FIRST fenced ```json block = JSON-Schema; SAMPLE.json optional example input.
  - Never expose cross-tenant runs/proposals; audit rows append-only.
- Root `AGENTS.md`: run `yarn generate` after module-file changes; i18n for all user-facing strings (4 locales in `workflows/i18n/`); no `any`; zod + `z.infer`.

---

## 1. Pill transform pipeline (new interpolator grammar)

### (a) Requirements (spec:212)
> "**Inline transforms on pills** (ServiceNow): chainable audited transforms (`format date`, number format, case, concat, `default if missing`, pick field) serialized as a small pure-function pipeline (`{{ context.deal.closeDate | date('yyyy-MM-dd') }}`). This is **new expression-language surface** — the interpolator must learn the pipeline grammar; scoped as its own Phase 2b item. No arbitrary JS (§9.6)."

Also spec:211: "Pills render as tokens with sample values … a broken pill … renders red and files a Problems entry" (pill *rendering* is 2a-adjacent; 2b's binding scope is the grammar + transforms).

### (b) Code anchors
- Runtime engine: `packages/core/src/modules/workflows/lib/activity-executor.ts:1566` `export function interpolateVariables(config, context, workflowInstance?)`. Two branches: single-token match `/^\{\{([^}]+)\}\}$/` (:1572) preserves value type; mixed-text `config.replace(/\{\{([^}]+)\}\}/g, …)` (:1621) stringifies. `getNestedValue` :1683. Unresolved paths silently return the original token/config (the lenient pass-through).
- Call sites (complete): :310 (async enqueue-time interpolation into job payload), :583 (`executeActivityByType`, sync path), :1221 (`executeCallApi` re-interpolates its own config), and `api/definitions/[id]/test-step/route.ts:175` (mock-first Test step).
- Client grammar mirror: `lib/expression-refs.ts:89` `TEMPLATE_PATTERN = /\{\{([^}]+)\}\}/g` + `normalizeContextPath` :96 (skips `now`/`workflow.*`/`env.*`). Header comment says grammar "mirrors interpolateVariables".
- Other `{{`-aware spots that must tolerate pipes: `lib/context-ledger.ts:230` (`literalValueType` treats strings containing `{{` as unknown — fine), `lib/agent-result-mapping.ts:38-46` (`warnOnTemplateMapping` — mapping values are NOT templates, unaffected), `components/fields/VariablePickerButton.tsx:131` (inserts `{{${path}}}`).

### (c) Approach
- Add a pure `lib/interpolation-pipeline.ts`: tokenizer for `path | fn(args) | fn2(...)` inside `{{ }}` and a fixed transform table (`date`, `number`, `upper`/`lower`/`title`, `concat`, `default`, `pick`) — pure functions, no arbitrary JS, args as JSON-ish literals. Export `parseInterpolationToken(token) -> { path, transforms }` so both runtime and refs lib share one parser.
- Rewire `interpolateVariables` both branches to parse via the shared parser: resolve base value (context/workflow/env/now as today), then fold transforms; on unknown transform name or bad args, treat per interpolation mode (lenient: pass token through unchanged as today; strict: throw — see §2). Preserve exact current behavior for pipe-free tokens (byte-for-byte BC — paths containing `|` are today looked up literally and virtually never resolve, so grammar takeover is safe; note it).
- Update `expression-refs.ts` `normalizeContextPath` to strip the transform tail so refs still check the base path against the ledger; keep purity.
- `VariablePickerButton` unchanged for insertion; add transform-chip editing later (UI can be minimal in 2b: transforms typed inline; document grammar in the picker popover footer/i18n hint).
- `test-step` route and `ActivityTestPanel` get transform evaluation for free via `interpolateVariables`.
- i18n keys for any new hints in all 4 locales.

### (d) Test surface
- Extend `lib/__tests__/activity-executor.test.ts` (interpolation cases live here) — single-token type preservation with transforms, mixed-text, unknown transform, arg parsing, `default if missing`.
- New `lib/__tests__/interpolation-pipeline.test.ts` for the parser proper.
- Extend `lib/__tests__/expression-refs.test.ts` — refs extracted from piped tokens check base path only.
- `components/__tests__/variablePickerButton.test.tsx` unaffected unless UI added.

---

## 2. Strict interpolation mode (per-definition opt-in)

### (a) Requirements (spec:214)
> "**Strict interpolation:** new definitions default `interpolation: 'strict'` — an unresolvable path fails the activity (routing its error edge) instead of passing literal `{{…}}` outward. Existing definitions stay `'lenient'` until edited (additive, opt-in)."

Note: error *edges* are Phase 3 (§5.9); in 2b "fails the activity" = normal activity failure path (retry policy → step/instance failure), which is exactly what error routes later hook into.

### (b) Code anchors
- Definition schema: `data/validators.ts:651` `workflowDefinitionDataSchema` (`contextSchema` at :655, `io` at :656) — add optional `interpolation: z.enum(['strict','lenient'])`.
- Failure plumbing: `ActivityExecutionError` in `lib/activity-executor.ts` (used at :302-306 for async-refusal); sync activities throw → transition-handler/compensation path.
- The three runtime call sites (:310, :583, :1221) + test-step :175 must pass the mode; enqueue-time interpolation (:310) means strictness for async activities is enforced **at enqueue**, before the job serializes frozen config (registry runtime contract, spec:192).
- Editor payload pass-through: `lib/definition-payload.ts` (carries `contextSchema`/`io` through save/draft round-trips — add `interpolation` the same way); `lib/draft-restore.ts`.
- "New definitions default strict": creation flows — `POST api/definitions` validator (`data/validators.ts`), visual editor new-definition path (`backend/definitions/visual-editor/page.tsx`), templates (`examples/templates/*.json` must stay schema-valid — a test enforces it, see `lib/__tests__/workflow-templates.test.ts`).

### (c) Approach
- Thread `interpolation?: 'strict' | 'lenient'` (absent = lenient) from definition → `WorkflowInstance` execution context → `interpolateVariables(config, context, workflowInstance, { mode })` (or read off a field the executor already carries; the definition is loaded at every call site's caller).
- In strict mode, an unresolved context path (and failed transform) throws `ActivityExecutionError` with the offending token — surfaces through the existing retry/failure machinery and the structured definition-error body (`lib/definition-error-body.ts`).
- Keep `{{env.*}}` allowlist misses and unknown `{{workflow.*}}` keys under the same strict rule; `'*'`-wildcard-covered trigger payloads are runtime lookups so no special casing needed.
- Default `'strict'` only where a definition is *created* (API create path may set it when body omits it — decide: schema `.default()` on create input, NOT on the shared data schema, to avoid rewriting existing rows on update). Existing definitions untouched until edited (additive).
- Surface the mode in the editor definition metadata panel (near `ContextSchemaEditor`, `backend/definitions/visual-editor/page.tsx`) with plain-language copy; test-step response should mirror strict failures so authors see them pre-run.

### (d) Test surface
- `lib/__tests__/activity-executor.test.ts`: strict vs lenient resolution, enqueue-time strict failure for async.
- `lib/__tests__/definition-payload.test.ts` + `draft-restore.test.ts`: `interpolation` survives round-trips.
- API tests (`api/__tests__/`): create defaults to strict; update leaves absent field absent; structured error body on strict failure.
- Spec integration list (spec:466): "registry-validated activity config rejection" and test-run paths.

---

## 3. Endpoint picker (#4235)

### (a) Requirements
- Issue #4235 (OPEN, `feature`, size L, backlog A7): "Add a picker for OM endpoints with: autocompletion of parameters (required vs optional), response schemas, upfront validation … Depends on: A2 (real response schemas in API docs) [#4230]. Related: the same field-suggestion mechanism should extend to webhooks/signals."
- Spec:202 (§3.3): "`makeCrudRoute` OpenAPI gains real response object schemas (the Zod already exists; the doc generator must stop collapsing to `string`). This is the prerequisite for the **Endpoint Picker** (§5.3) and CALL_API output typing. Hand-written routes without response schemas degrade to `unknown` contributions."
- Spec:279 (§5.3): "**CALL_API** (#4235, needs #4230): endpoint browser/search from the OpenAPI catalog; parameters split required/optional with typed controls; body form from request schema; response schema shown and wired into the ledger; SSRF/tenant-match constraints as helper text. CALL_WEBHOOK shares the form (URL, method, headers table, body builder, signing hint)."
- **#4230 is still OPEN** — the "collapses to `string`" fix has not landed (verify against `packages/shared/src/lib/openapi/__tests__/generator-response-fallback.test.ts` which pins current fallback behavior).

### (b) Code anchors
- OpenAPI catalog: `apps/mercato/src/app/api/docs/openapi/route.ts` — full OpenAPI 3.1 doc via `attachOpenApiDocsToModules` + `buildOpenApiDocument` (`packages/shared/src/lib/openapi/generator.ts:1034`) + `sanitizeOpenApiDocument`. **Template mirror exists**: `packages/create-app/template/src/app/api/docs/openapi/route.ts` — the Template Sync Checklist (`packages/create-app/AGENTS.md`) applies to any change under `apps/mercato/src/app/**`.
- CRUD OpenAPI factory: `packages/shared/src/lib/openapi/crud.ts` (`createCrudOpenApiFactory`); route docs typed in `packages/shared/src/lib/openapi/types.ts`.
- CALL_API runtime: `lib/activity-executor.ts:1213-1230` (`executeCallApi`, config `{ endpoint, method, headers, body, validateTenantMatch }`), one-time API key minting; registry entry in `lib/activity-types.ts` (CALL_API is deliberately sync-only — `mintsPerRequestKey`); config zod in `data/activity-config-schemas.ts`.
- UI to extend: `components/fields/ActivityConfigFields.tsx` (:415-600; `VariablePickerButton` wired at :472/:504/:591); picker precedents: `components/fields/CommandPicker.tsx` (UPDATE_ENTITY, backed by `GET /api/workflows/commands` ← `lib/workflow-safe-commands.ts`) and `FunctionPicker.tsx`.
- Ledger wiring: `lib/server-output-contract.ts` (server `resolveOutputContract`) + `lib/ledger-schema-flatten.ts` (`flattenSchemaToContract`) — CALL_API's `outputContract` can resolve the picked endpoint's response schema.

### (c) Approach
- First land the #4230 half if not already merged by Phase-1 track: `generator.ts` must emit real object schemas for declared zod responses (test exists) — check whether only hand-written routes still degrade.
- Add a workflows-scoped catalog endpoint (e.g. `GET /api/workflows/endpoints`, feature `workflows.definitions.view`) that loads the sanitized OpenAPI doc server-side and projects a trimmed index: `{ path, method, summary, tag, params: [{name, in, required, type}], requestSchema?, responseSchema? }`. (Fetching the full multi-MB doc client-side per keystroke is the alternative — prefer the trimmed server projection; the doc route is app-level, so build the projection from the same `buildOpenApiDocument` inputs via a small shared helper, or fetch `/api/docs/openapi` server-side.)
- New `components/fields/EndpointPicker.tsx` modeled on `CommandPicker`: search/browse grouped by tag; picking fills `endpoint` + `method`; required/optional params render typed rows (path/query merged into the endpoint string or a params object); body form from request schema via the existing schema-driven form pieces; free-text stays as fallback (registry pattern: "both keep free-text fallback").
- Wire CALL_API `outputContract: (config) => …` in `lib/activity-types.ts` to look up the picked endpoint's response schema (server-side seam only — `server-output-contract.ts`), flattened by `flattenSchemaToContract`; unknown endpoints stay `'unknown'` (honest degradation).
- Keep SSRF/tenant-match helper text (i18n) on the form; CALL_WEBHOOK shares the headers-table/body-builder subcomponents.

### (d) Test surface
- `packages/shared/src/lib/openapi/__tests__/generator-response-fallback.test.ts` (update expectations when #4230 lands).
- New API test for the catalog projection route (`api/__tests__/`).
- `lib/__tests__/call-api.test.ts`, `resolve-call-api-role-ids.test.ts` (existing CALL_API behavior must not regress); `server-output-contract.test.ts` + `ledger-schema-flatten.test.ts` for the new contract resolution.
- `components/__tests__/activityConfigFields.test.tsx` + new `endpointPicker` component test.

---

## 4. Trigger event-picker / filter-builder / mapping

### (a) Requirements
- Spec:441 names the item; supporting quotes: spec:161 — ledger contributions include "typed trigger `contextMapping` outputs"; spec:108 — "trigger fields `debounceMs`/`maxConcurrentInstances` get plain-language copy and safe defaults"; spec:121 — "every step/route/trigger edited in schema-driven CrudForm panels"; spec:278 (EMIT_EVENT, same mechanism) — "event-name dropdown from module `events.ts` registries (enumerable `as const`), payload schema hint + pill-builder; free text stays for custom events with a warning chip"; spec:356 — Test tab "trigger simulation (pick a declared event trigger, edit a schema-derived sample payload, fire — tests filters + contextMapping without domain writes)" (Test-tab part is later phase; the schema plumbing starts here).

### (b) Code anchors
- Editor: `components/DefinitionTriggersEditor.tsx` (580 lines; local-state dialog editor saved with the definition). Event field already uses `EventPatternInput` (:27 import) — `packages/ui/src/backend/inputs/EventPatternInput.tsx` → `useAvailableEvents` → `GET /api/events` served by `packages/events/src/modules/events/api/route.ts` (`getDeclaredEvents()` from `@open-mercato/shared/modules/events`, `packages/shared/src/modules/events/factory.ts:102`; requireFeatures `workflows.view`). So an event *picker* exists; **no payload schema exists anywhere** — `EventDefinition` carries `id/label/description/category/module/entity/excludeFromTriggers/clientBroadcast/portalBroadcast` only.
- Filter builder today: hand-rolled rows `{ field: string, operator, value: string(JSON-parsed fallback) }` with `FILTER_OPERATORS` const (`DefinitionTriggersEditor.tsx:38-54`); mapping rows `{ targetKey, sourceExpression, defaultValue }` (:63-66).
- Runtime: `lib/event-trigger-service.ts` — `evaluateFilterConditions` :295 (AND over payload), `mapEventToContext` :311 (bare `getNestedValue(payload, sourceExpression)` — NOT `{{}}` templates), `initialContext` build :708-721 (`...payload, ...mappedContext, __trigger:{...}`); wildcard subscriber `subscribers/event-trigger.ts` (excluded prefixes: `query_index`,`search`,`workflows`,`cache`,`queue`).
- Ledger today: `lib/context-ledger.ts:267-303` — trigger contributes a `'*'` wildcard `unknown` entry, `contextMapping` target keys as **untyped** `maybe`, and typed `__trigger.*` metadata.
- Ref extraction: `lib/expression-refs.ts:188-208` — trigger `sourceExpression` values are payload paths, skipped by the ledger check.

### (c) Approach
- Add optional payload typing to event declarations (additive on `EventDefinition` in `packages/shared/src/modules/events/` — e.g. `payloadSchema?: JsonSchemaNode` or field list) and expose it through `GET /api/events`; CRUD-category events can get a generated default (`{ id, organizationId, tenantId, entityType? }`) without per-module work. This is a cross-package contract surface → **additive only, Ask First applies**.
- Upgrade `DefinitionTriggersEditor` filter rows: `field` becomes a payload-path picker fed by the selected event's payload schema (free text fallback + warning chip for pattern/custom events); `value` gets typed controls per field type; keep the stored `WorkflowDefinitionTrigger.config` shape unchanged (`filterConditions`/`contextMapping` are a data-model contract per workflows AGENTS.md).
- Same picker for `contextMapping.sourceExpression` (payload paths); `targetKey` free text. Once the event payload schema is known, type the ledger's trigger `contextMapping` entries (`context-ledger.ts:275-286`) instead of `unknown` — pass trigger event schemas through `computeContextLedger` options or as pre-resolved types on the trigger definition input (keep purity: plain data in, no fetching inside the lib).
- Plain-language copy + safe defaults for `debounceMs`/`maxConcurrentInstances` (i18n, all 4 locales).
- Optional: migrate the dialog to a CrudForm panel per spec §2.2 if cheap; otherwise keep the existing dialog and defer.

### (d) Test surface
- `lib/__tests__/event-trigger-cache.test.ts`, `event-trigger-redos.test.ts`, `code-triggers.test.ts` (runtime semantics unchanged — guard that).
- `lib/__tests__/context-ledger.test.ts` — typed trigger contributions.
- New component test for the triggers editor (none exists today — add `components/__tests__/definitionTriggersEditor.test.tsx`).
- `packages/events/src/modules/events/api/__tests__/route.test.ts` — payloadSchema exposure.

---

## 5. Agent typed I/O (§3.4 / §7.1)

### (a) Requirements
- Spec:206 (§3.4): "`INVOKE_AGENT`'s `outputContract` resolves from the selected agent's OUTCOME.md JSON-Schema (already machine-readable; its restricted subset maps 1:1 onto the ledger types). Envelope keys (`kind`, `disposition`, `proposalId`, `proposalPayload`, `data`) typed by the platform; `data`/`proposalPayload` typed by OUTCOME. `outputMapping` rows become two pickers (OUTCOME/envelope key ⇄ ledger path with autocomplete); a mapping referencing an absent key is an author-time **error**, killing the silent no-op. The input builder validates against the agent's declared input shape, with 'Insert sample' from SAMPLE.json."
- Spec:327 (§7.1): "Input builder validated against agent input shape + SAMPLE.json insert; outputMapping as schema-key pickers; both feed the ledger (§3.4). `subject` becomes a structured picker over ledger `entityRef`s."
- Outcome *routes* (§7.2) are Phase 5 — out of 2b scope.

### (b) Code anchors
- Core activity: registry entry `lib/activity-types.ts:260-278` (`INVOKE_AGENT`, sync-dispatched, parks on dedicated queue, no mock, currently NO `outputContract`); config zod `data/activity-config-schemas.ts:111-130` (`agentId`, `input`, `onResult`, `outputMapping` — "values are plain dot-paths into the normalized agent result envelope", `subject`).
- Result mapping: `lib/agent-result-mapping.ts:48-72` (`mapAgentResultToContext`; envelope source keys built :54-61; `warnOnTemplateMapping` :38-46 is the runtime-warn-only silent no-op to kill at author time). Call sites: `lib/step-handler.ts:558` (inline branch), `lib/activity-worker-handler.ts:353` (parked resume).
- Ledger: `lib/context-ledger.ts:474-521` (`invokeAgentContributions`, source kind `'invokeAgent'`, everything `maybe`, mapping targets typed `unknown`); default park signal const :472.
- Bridge: `lib/activity-executor.ts:1044-1090` (resolves DI `agentWorkflowBridge`); enterprise side `packages/enterprise/src/modules/agent_orchestrator/lib/runtime/invokeAgentForWorkflow.ts`.
- Agent schemas (enterprise): `lib/sdk/defineFileAgent.ts:70-127` (OUTCOME.md parse → `{ kind, schema }`), `:150-162` (SAMPLE.json read), `LoadedFileAgent.outcomeSchema` :52; in-process agents: `lib/sdk/defineAgent.ts:82-83` (`result: { kind, schema }` zod); committed manifest `generated/file-agents.generated.ts`.
- Agents API: `packages/enterprise/src/modules/agent_orchestrator/api/agents/route.ts` — list exposes `id/resultKind/runtime/label/description/icon/sampleInput/facts` but **NOT the outcome JSON-Schema**; no input schema exists at all (SAMPLE.json is the only input artifact).
- Core UI: `components/fields/AgentInvokeConfigField.tsx` (agent picker + `inputs`/`outputs` as `Mapping[]` rows via `components/fields/MappingArrayEditor.tsx`; 404-tolerant when enterprise absent); `components/AgentSelector.tsx`; form transform `lib/nodeFormTransforms.ts` (see `node-form-transforms-invoke-agent.test.ts`).

### (c) Approach
- **Enterprise, additive:** expose `outcomeSchema` (raw JSON-Schema subset) on the agents API (list or `[id]` detail; list already ships `sampleInput`, so adding `outcomeSchema` there is consistent and one fetch).
- **Core UI:** in `AgentInvokeConfigField`, when an agent is selected: (1) "Insert sample" button filling `input` rows from `sampleInput`; (2) output-mapping source cells become a picker over envelope keys (`kind`,`disposition`,`agentId`,`proposalId`,`proposalPayload`,`data`) expanded with OUTCOME-schema properties under `data.*`/`proposalPayload.*` (kind-dependent: `informative` ⇒ `data`, `actionable` ⇒ `proposalPayload`); target cells get ledger-path autocomplete (`VariablePickerButton` insertMode `'bare'`). A source path not present in the schema ⇒ validation **error** on the field (author-time; runtime stays warn-only for BC).
- **Ledger typing:** give the INVOKE_AGENT registry entry an `outputContract` resolved server-side from the selected agent's outcome schema (via a seam the enterprise module can register — mirror how UPDATE_ENTITY uses `commandRegistry.outputSchemaOf`; core must not import enterprise, so register a resolver through DI or accept the schema snapshot into the activity config at save). Feed typed mapping-target entries in `invokeAgentContributions` (type from the resolved source path) instead of `unknown`; presence stays `maybe` (path-dependent merge documented at :66-78 is unchanged).
- **Input validation:** without a declared input schema, validate `input` keys against SAMPLE.json keys as a *warning* only (spec says "declared input shape" — SAMPLE.json is the closest existing artifact; a real input schema is an enterprise follow-up).
- **`subject` picker:** ledger has no `entityRef` type yet (`LedgerType` at `context-ledger.ts:83-90`) — implement as a structured `{ entityType, entityId ← ledger pill }` mini-form; full `entityRef` typing is §3.1 scope, don't block on it.

### (d) Test surface
- `lib/__tests__/agent-result-mapping.test.ts`, `node-form-transforms-invoke-agent.test.ts`, `invoke-agent-async.test.ts`, `invoke-agent-queue-split.test.ts`, `invoke-agent-retryable.test.ts`, `executor-pause-on-park.test.ts` (must not regress).
- `lib/__tests__/context-ledger.test.ts` — typed invokeAgent mapping targets.
- Enterprise: `__tests__/defineFileAgent.test.ts`, `agents` API route test for `outcomeSchema` exposure; `submit-outcome.test.ts` untouched.
- Component: `components/__tests__/mappingArrayEditor.test.tsx` + new AgentInvokeConfigField test.

---

## 6. Drag-from-input-panel

### (a) Requirements (spec:210)
> "**Variable picker** … The Input data panel (§5 template) also supports **dragging a field directly into a parameter** (n8n's muscle-memory gesture) — click and drag are both first-class."

Spec:275 (§5 template): every activity inspector has "**(d)** the **Input data panel** (ledger + samples) alongside".

### (b) Code anchors
- Picker + insertion: `components/fields/VariablePickerButton.tsx:127-143` (`handleInsert` → `insertAtElementCursor`), `lib/insert-at-cursor.ts` (+ `lib/__tests__/insert-at-cursor.test.ts`).
- Ledger supply to dialogs: `backend/definitions/visual-editor/page.tsx:752-770` (`dialogLedger` client-side compute, `nodeDialogLedgerEntries`/`edgeDialogLedgerEntries`; node dialog = step's incoming view, edge dialog = TARGET step's view), passed at :1335/:1340 into `NodeEditDialogCrudForm` / `EdgeEditDialogCrudForm`.
- Samples: `lib/sample-resolver.ts` (pin > last test output > placeholder), `metadata.editor.samples` (validators.ts:683-692, 64KB cap).
- Dialog hosts: `components/NodeEditDialogCrudForm.tsx`, `EdgeEditDialogCrudForm.tsx`; per-field pickers already rendered inside `ActivityConfigFields.tsx`.

### (c) Approach
- Build an `InputDataPanel` component: the same grouped ledger listing as the picker popover (reuse `groupEntries`/sample formatting — extract shared helpers from `VariablePickerButton.tsx`), rendered as a docked column inside the node/edge dialog (space exists in the CrudForm dialog layout; collapsible on narrow widths).
- Make each row `draggable` (HTML5 DnD): `dataTransfer.setData('text/plain', '{{path}}')` gives browser-native drop into any `<input>`/`<textarea>` for free; additionally set a custom MIME (`application/x-om-ledger-path`) so template-capable fields can intercept `onDrop` and insert via `insertAtElementCursor` (correct cursor placement + `'bare'` mode for mapping cells).
- Keep click-to-insert (picker button) untouched — both gestures first-class.
- A11y: rows remain buttons (click path); drag is enhancement only.

### (d) Test surface
- New component test (jsdom DnD is limited — test `dataTransfer` payload construction + drop-handler insertion logic as units; reuse `insert-at-cursor.test.ts` patterns).
- `components/__tests__/variablePickerButton.test.tsx` — refactor-safety for extracted shared helpers.
- Spec's UI integration path (spec:467): "wire pill from picker" Playwright flow — extend with a drag variant if the integration suite supports `browser_drag`.

---

## Existing test files most relevant to Phase 2b (extend, don't fork)

`packages/core/src/modules/workflows/lib/__tests__/`: `activity-executor.test.ts`, `expression-refs.test.ts`, `context-ledger.test.ts`, `context-ledger-import-boundary.test.ts` (purity guard — new libs with browser exposure should get the same), `sample-resolver.test.ts`, `ledger-schema-flatten.test.ts`, `server-output-contract.test.ts`, `agent-result-mapping.test.ts`, `event-trigger-cache.test.ts`, `event-trigger-redos.test.ts`, `code-triggers.test.ts`, `call-api.test.ts`, `definition-payload.test.ts`, `draft-restore.test.ts`, `workflow-templates.test.ts`, `insert-at-cursor.test.ts`, `collect-validation-issues.test.ts`.
`components/__tests__/`: `variablePickerButton.test.tsx`, `activityConfigFields.test.tsx`, `activityTestPanel.test.tsx`, `mappingArrayEditor.test.tsx`, `contextSchemaEditor.test.tsx`.
Elsewhere: `packages/shared/src/lib/openapi/__tests__/generator-response-fallback.test.ts`, `packages/events/src/modules/events/api/__tests__/route.test.ts`, `packages/enterprise/src/modules/agent_orchestrator/__tests__/defineFileAgent.test.ts`.

## Risks / unknowns

1. **#4230 still OPEN** — the endpoint picker's value depends on real response schemas; if the Phase-1 parallel track hasn't landed, 2b must either include the generator fix (shared-package contract surface → Ask First) or ship the picker with degraded (`unknown`) response typing.
2. **Strict mode without error routes**: spec says strict failure "routes its error edge", but error edges are Phase 3 (§5.9). In 2b a strict failure follows the plain activity-failure path (retry → fail). Document this sequencing in the PR; do not build ad-hoc error routing.
3. **Grammar takeover of `|` inside `{{ }}`**: today a path containing `|` is looked up literally (and silently passes through). Technically a behavior change for any definition abusing `|` in a path — vanishingly unlikely, but call it out per BACKWARD_COMPATIBILITY (definition JSONB is a contract surface; change is additive-in-practice).
4. **Agent input shape does not exist** — only SAMPLE.json. "Validated against the agent's declared input shape" can only be sample-key-based warning validation in 2b; a real input schema is enterprise follow-up work.
5. **Core↔enterprise seam for INVOKE_AGENT `outputContract`**: core's registry cannot import enterprise; the OUTCOME schema must flow through DI (enterprise-registered resolver) or an API-supplied snapshot. Choose one and keep `context-ledger.ts` pure (schema arrives as plain data).
6. **Event payload schemas are a new cross-package contract** on `EventDefinition` (`packages/shared`) — additive only, and modules will adopt slowly; the trigger UI must degrade gracefully (free text + warning chip) for schema-less events, which will be the majority initially.
7. **`/api/docs/openapi` lives in the app layer** (`apps/mercato/src/app/…` with a create-app template mirror) — any edit there triggers the Template Sync Checklist; prefer a workflows-module projection route to avoid touching the app tree.
8. **Ledger `entityRef`/composite types** (§3.1) are not implemented — the `subject` picker and record pickers can only be structural sugar in 2b.
9. **Definition-level `interpolation` default on create**: putting `.default('strict')` on the shared data schema would flip existing lenient definitions on their next full-body update — the default must live only on the create input path.
10. **Scope pressure**: six items, several cross-package. Natural cut lines if needed: transform pipeline + strict mode (engine pair) → endpoint picker → trigger typing → agent typed I/O → drag panel (pure UI, safe last).
