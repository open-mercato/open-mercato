# What a model is given: withholding fields from model input

> **Program:** second part of F1, [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md), issue open-mercato/open-mercato#8593.
> **Status:** direction awaits human confirmation. Option B is the chosen default; option A below is a conditional design, not authorization to implement it. Current-code claims were checked in the read-only repository; tests are proposed.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

Tools and page-context builders can send decrypted record data to a model. A field filter would cover only declared record shapes on selected paths. The default is to ship no field-level control and document exactly what is sent. The narrower optional control remains specified below with its gaps, including OpenCode over MCP.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen default | Fallback |
|---|---|---|---|
| Q1 | Build a narrow field-withholding control, or record no field-level control? | ⚠ NEEDS HUMAN CONFIRMATION. B: no control; retain provider policy and document tool results, page contexts, search text, attachments and user input as model input | A: implement the conditional design below only after explicit approval; do not describe it as comprehensive masking |
| Q2 | Does option A preserve unmasked chat transcripts? | ⚠ NEEDS HUMAN CONFIRMATION. No: the typed chat transcript, its UI parts and stored tool output carry the masked/truncated result too | A separate model/UI output design needs its own approval and tests; the execute API and underlying business rows remain unchanged |

The program's **Decisions — DEC-11**, **Phase 0 — Assumptions and hygiene** and **Known limits** already record Q1=B, its pending human confirmation and the disclosure gate. Under B, the carrier is `apps/docs/docs/deployment/gdpr/impact-assessment-notes.mdx#what-the-assistant-sends-to-a-model`, section **What the assistant sends to a model**, specified by [`2026-11-16-gdpr-deployment-docs.md`](2026-11-16-gdpr-deployment-docs.md), **Proposed Solution** and **Implementation Plan — Stage 1**, step 1. That design requires the section to state that decrypted tool outputs, page-context records, search titles/snippets, attachments, module-built prompts and user text may leave the installation, including through legacy OpenCode over MCP; provider permission is not field minimisation. The program's **Known limits** links that delivery artifact and states **No field-level model-input control**. These are established design requirements, not evidence that the page has shipped. B is not complete until the statement ships and Q1 is confirmed before #8593 closes.

## 📝 Overview

Option B has no code change or new API. Option A withholds values only where a declared result is formatted. A controller must be able to see the uncovered paths beside the setting, rather than infer that a field cannot ever reach a model.

## 📝 Problem Statement

| Route | Current behavior and evidence | Option A coverage |
|---|---|---|
| Typed-agent tools | Private `formatToolResult` serializes the handler result; the tool returns that string to the AI SDK (`packages/ai-assistant/src/modules/ai_assistant/lib/agent-tools.ts:145-154`, `:315-319`) | Declared object records only; chat transcript receives the same filtered result |
| Page-context hydration | Direct tool-handler calls in `packages/core/src/modules/customers/ai-agents-context.ts:88-105` and `catalog/ai-agents-context.ts:108-127` | Declared records, through the new exported formatter |
| Legacy OpenCode over MCP | `docker/opencode/opencode.jsonc.example` points to the app MCP endpoint; `ai_assistant/lib/mcp-server.ts:142-170` serializes `executeTool` output for OpenCode's model | Not covered; MCP is a model path as well as an interactive client path |
| Code mode | Preformatted string output in assistant `lib/codemode-tools.ts` | Not covered |
| Search | Presenter titles/subtitles in assistant `lib/ai-tools/search-pack.ts` | Not covered |
| Attachments, inbox/warranty prompts, user text | Free text/files, without result-entity declarations | Not covered |

`executeTool` also serves the human-facing execute route, so global filtering there changes a separate API contract. Typed chat output is different: `api/ai/chat/route.ts:268-284` extracts UI parts from the streamed tool output. Filtering the tool's returned string also filters the transcript/UI output and persisted representation. Option A explicitly accepts that effect; it makes no promise that chat users see the unmasked result.

The current formatter is private. Page builders cannot call it without a new package export. A tool's generic keys do not identify an entity, so declarations must carry that information; key-name heuristics are not a substitute.

## 📝 Proposed Solution (option A only)

1. Add optional `resultEntities` declarations to first-party tools. A declaration identifies record roots by a JSON Pointer, lists the exact record properties it returns as `fields`, and says whether that root is one record or an array of records. A tool with no declaration is unfiltered and listed as uncovered.
2. Add `withheldFields`, an empty-by-default list of `{ entityId, field }`, to `ai_tenant_model_allowlists`. Extend the loaded result of `AiTenantModelAllowlistRepository.getEffectivePolicy(scope)` from [`2026-11-16-ai-data-protection.md`](2026-11-16-ai-data-protection.md), **Policy loading and selection**, with `withheldFields`; keep the existing `AiTenantModelAllowlistSnapshot`, `getForTenant` and `getSnapshot` contracts unchanged. Organization row wins, then tenant row; an explicit empty withheld list on an organization row wins too. Formatting callers load this policy even when `enforceForCalls` is false: provider permission and field withholding are separate settings. `none` means an empty list; `unavailable` refuses model formatting with `ai_policy_unavailable` before content leaves, never an empty-policy fallback. Settings validate choices against declared fields, use feature ACL and return `updatedAt` for optimistic locking.
3. Add `formatModelToolResult` in `ai_assistant/lib/model-tool-result.ts`, exported through the assistant package. Typed-agent execution and both page-context builders call it after authorized execution. They pass the actual tool definition and server-derived scope, not a guessed entity or browser-supplied policy. Only the model-formatting paths change; execute API responses and underlying business records do not.
4. An empty withheld list delegates to the existing formatter unchanged: no new JSON envelope, validation substitution or byte ceiling. A non-empty list activates the formatter: mask matching declared fields with `[withheld]`, then apply the structure-preserving size rule below. For typed agents this exact value is also the chat transcript's tool output and UI-part source. No unfiltered copy is persisted beside it by this formatter.
5. Beside the list show code mode, search, attachments, module-built prompts, user text, undeclared tools and **legacy OpenCode over MCP: not covered**. MCP clients cannot reliably be classified as people; option A leaves their output unchanged and states that it may go to a model.

### Paths and size budget

`path` uses RFC 6901 JSON Pointer: empty string is the result root; `/records` selects a property; `~0` and `~1` escape tilde and slash; numeric segments address array indices. No dots, wildcards, recursive descent or implicit array expansion. `cardinality: 'many'` means the selected value must be an array and each element is a record of the declared entity; `one` means a record object. `field` is an exact record property name, including a custom-field property where the tool declares it. Nested record locations use additional declarations, for example `/result/people` with `many`; declarations may not overlap ambiguously.

A declared root with the wrong shape is replaced at that root by `[withheld: invalid declaration]`, and recorded as a bounded code without values. An absent pointer is reported as absent, never searched heuristically. Pack tests must cover each declared shape; absence is a coverage gap visible in settings, not proof of filtering.

With a non-empty withheld list, the budget is **32,768 UTF-8 bytes of serialized JSON per formatted result**, after masking. These active-policy results are always valid JSON; empty-policy calls retain their legacy representation and limits. When over budget, remove whole trailing array items or object properties in stable order, preserving the largest prefix that fits, and wrap as `{ "result": <retained structure>, "truncated": true, "marker": "[truncated]" }`; include envelope bytes in the budget. If an oversized scalar or first member cannot fit, use `{ "result": null, "truncated": true, "marker": "[truncated]" }`. Never slice serialized JSON or split a UTF-8 sequence. Results below budget are serialized unchanged except for masking. This is a byte ceiling, not a model-token budget.

### Known limits, shown beside the control

A name in a note, a search snippet or a file is not a declared field. OpenCode can retrieve that same data over MCP. Undeclared third-party tools are untouched. Typed-agent chat transcripts are masked too. Withholding a field in one covered route is not a guarantee that it cannot reach a model by another route.

## 📝 Delta (option A only)

### Capability: ai-model-input-minimisation

#### ADDED Requirement: Withheld fields on declared paths
The system SHALL replace listed field values on declared record paths before model formatting. The same filtered output SHALL appear in the typed-agent transcript and its stored tool output. The direct execute API and underlying business rows SHALL remain unchanged. Uncovered routes SHALL be stated beside the setting.

##### Scenario: Model and transcript
- WHEN a tenant withholds a declared person's primary email and runs a typed-agent tool
- THEN the model input and the transcript tool output contain `[withheld]`, including UI parts sourced there, while the execute API still returns the authorized email

##### Scenario: Page context
- WHEN a context builder uses the same declared tool and policy
- THEN its prompt text contains the same replacement, using the exported formatter

##### Scenario: OpenCode over MCP
- WHEN OpenCode calls that tool over MCP
- THEN its output is unchanged, and the settings coverage explicitly lists this path as uncovered

##### Scenario: Entity and byte limits
- WHEN another entity has a field of the same name
- THEN it is unchanged unless separately listed
- WHEN an active non-empty withholding policy formats JSON exceeding 32,768 UTF-8 bytes
- THEN the result remains valid JSON, within the budget, with `truncated: true` and `[truncated]`

## 📝 Architecture

OSS helper, optional tool declarations, scoped allow-list repository and settings page. Customers and catalog call the exported helper through a package import; the helper never reads their tables. `executeTool`, MCP output and authorization contracts remain unchanged. Use shared settings components, `apiCall`, guarded writes, i18n and semantic tokens. The formatter does not broaden the tool's ACL or mutation approval.

## 📝 Data Models

Option B: none. Option A: `ai_tenant_model_allowlists.withheld_fields jsonb NOT NULL DEFAULT '[]'`, with migration and snapshot. Reuse its `updated_at`; API responses include `updatedAt` and writes use the shared optimistic-lock header/conflict UI. No generic unnamed tenant-settings table.

## 📝 API Contracts (option A)

```ts
resultEntities?: Array<{ entityId: string; path: string; cardinality: 'one' | 'many'; fields: string[] }>
formatModelToolResult(input: {
  tool: AiToolDefinition
  scope: { tenantId: string; organizationId?: string | null }
  withheldFields: ReadonlyArray<{ entityId: string; field: string }>
  result: unknown
}): string
```

The formatter is synchronous and pure, receives the already-loaded scoped policy, and returns legacy text unchanged when that list is empty. With an active non-empty list it validates declarations using Zod and returns JSON text. It never resolves another tenant's policy. Export its input type additively. `PUT /api/ai_assistant/settings/allowlist`, the provider-policy sibling's existing route, accepts optional `withheldFields`; the settings read returns the list, coverage and `updatedAt`, and requires the existing settings feature. Both specs use the same scope and repository method; no second endpoint or loader is introduced. Lists have `pageSize` at most 100. No change to MCP's result type.

## 📝 Migration & Backward Compatibility

B ships documentation only. A adds optional declarations and an empty default; existing tools keep their output unless the administrator selects withholding. Its opt-in transcript masking and size ceiling must appear in the upgrade note; do not claim that people using chat are unaffected. Old `formatToolResult` call signatures remain usable internally during migration. No frozen tool id, route, result API or declaration member is removed.

## 📋 Phasing

| Phase | Outcome | Gate |
|---|---|---|
| B | Model-input statement and Known limits link | Confirm Q1 and deliver the two carrier edits before #8593 closes |
| A1 | Formatter/declarations/settings and mandatory recording test | Only if Q1 selects A; same change includes all tests below |
| A2 | Remaining first-party tool declarations | Each pack ships its declaration and shape tests together |

## 📋 Implementation Plan

### Default B
1. Program owner records Q1 and outcome in the decision list and Phase 0; deployment-docs owner writes **What the assistant sends to a model**; Known limits links it.
2. Verify statement against the route inventory and shipped provider-policy coverage. Do not close the documentation task with an empty placeholder.

### Conditional A
1. Add exported types/formatter and JSON Pointer validation. Unit tests `model-tool-result.test.ts`: empty policy, field match, other entity, escaped keys, nested arrays, absent/wrong shapes, no declaration, UTF-8 budget, oversized scalar, valid JSON and exact marker.
2. Declare people/companies/deals tools and route both context builders through the helper. Shape tests per pack and context tests prove actual definition, scope and withheld list arrive at the shared helper. Policy tests cover organization override, tenant fallback, explicit empty override, no row and unavailable storage; withholding remains active with `enforceForCalls=false`.
3. Add settings column, migration, validators, optimistic locking and UI coverage/limits. Keep the execute route and MCP untouched. Unit tests pin masked chat UI parts and stored tool output.
4. Add a deterministic **test-only recording model adapter** before integration delivery. Register only under `OM_TEST_MODE=1` and a lane-owned adapter setting, absent in production; no network or vendor keys. Expose recorded inputs only through a test-authenticated fixture facility, scoped to test tenant/run, with explicit cleanup. Both integration environment blocks enable the lane. Adapter absence fails the lane; it never downgrades coverage to unit tests.
5. Deliver TC-AI-MIN-001 and TC-AI-MIN-002 in A1; remaining packs follow in A2. Archive Delta only after implementation if the capability directory exists.

| File | Action under A |
|---|---|
| `packages/ai-assistant/src/modules/ai_assistant/lib/{model-tool-result.ts,types.ts,agent-tools.ts}` and package exports | Add formatter/type and route typed output |
| Assistant `data/entities.ts`, repositories, settings API/UI, migrations and locale files | Scoped list and coverage |
| `packages/core/src/modules/{customers,catalog}/ai-agents-context.ts`; first-party tool packs | Pass actual tool declarations and shared policy |
| Assistant test-adapter fixture, CLI integration environment, unit suites and `__integration__/TC-AI-MIN-00{1,2}.spec.ts` | Deterministic mandatory coverage |

## 🧪 Integration Coverage (mandatory if A is selected)

Both tests create their own tenant, organization, authorized users, person and settings through APIs, and delete fixtures and recordings in `finally`. No demo records or external provider. The recording adapter is an implementation deliverable, not assumed existing infrastructure.

| Test | Covers |
|---|---|
| TC-AI-MIN-001 | Settings API write/read and stale edit conflict; settings UI selects a field and lists OpenCode/MCP as uncovered; with provider enforcement off and withholding selected, typed-agent turn invokes declared people tool; recorded model input and saved/streamed chat output contain marker and no email; direct tool execute API still returns email; another tenant's output is unchanged |
| TC-AI-MIN-002 | Customer/catalog page context passes the same withheld policy; adapter records masked prompt; arrays/nested data and oversized result yield valid bounded JSON with marker; legacy MCP result is unchanged and explicitly uncovered; test-authenticated recordings cannot be read across tenants |

B has no new API/UI path; its gate is documentation review against the inventory.

## 📝 Edge Cases & Failure Scenarios

| Case | Behavior |
|---|---|
| Undeclared tool or absent path | No invented entity mapping; coverage gap is visible |
| Declared path has wrong shape | Replace selected root with invalid-declaration marker, no values in diagnostic |
| Another route carries the withheld value | Uncovered paths listed; no whole-system guarantee |
| Withholding removes UI-part data | Typed transcript reflects filtered result; explicit Q2 tradeoff |
| Test recording adapter missing | Conditional A integration lane fails; no skip to unit-only coverage |

## 📝 Risks & Impact Review

| Scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Narrow control read as complete protection | High | Tenants choosing A | Uncovered OpenCode/MCP and other paths beside setting | Reason B is default; same value can leave another route |
| No control but documentation omitted | High | B deployments | Named docs section and program closure decision | Other owners must deliver carrier edits |
| Masking damages transcript/UI parts | Medium | A chat users | Q2 explicitly accepts it; integration checks actual saved output | Administrator chooses reduced usefulness |
| Declaration shape drifts | Medium | Covered tools | Shape tests, invalid-root marker and visible absent paths | Third-party declarations still require review |

## Final Compliance Report — 2026-11-16

| Rule | Status | Notes |
|---|---|---|
| Direction decision recorded | Defaulted, pending confirmation | Q1=B with concrete carrier; Q2 conditional only |
| Additive contracts and tenant scope | Compliant design | Optional declarations, scoped settings, old execute/MCP contracts preserved |
| Integration coverage | Required if A | Recording adapter ships in A1; no conditional unit-only fallback |
| Honest limits | Compliant design | OpenCode/MCP and masked transcript explicitly covered in inventory and UI text |

**Verdict:** B is the default subject to Q1 confirmation and carrier delivery. A remains unapproved.

## Changelog

### 2026-11-16
- Split from the AI data-protection spec after independent review. The first design filtered in the tool executor by key name. The review showed that the executor also serves people and stored rows, that code mode returns a string a key walk cannot see, that page-context hydration bypasses it, that search results carry titles not field names, and that field names such as `name` and `description` would blank unrelated data. This version filters only where a result is formatted for a model, only for tools that declare what they return, and puts the question of building it at all to a person.

- Council round two fixes (GPT-6.1 Sol workers): r2iqa-13 — inventory and disclose OpenCode over MCP; r2iqa-37 — Q1 default and named docs/program carriers; r2iqa-38 — exported scoped formatter; r2iqa-39 — mandatory recording adapter and integrations; r2iqa-40 — JSON Pointer and byte/truncation rules; g6-28 — masked typed transcript stated and tested.
- Council round two fixes, pass two (GPT-6.1 Sol workers): bound option B to the deployment-docs carrier's actual Stage 1 and marked its missing section explicitly; synchronized the sibling's effective-policy method, result member, settings route and version name; kept conditional withholding active independently of provider enforcement, with matching failure and test requirements.
- Council round two fixes, pass three (GPT-6.1 Sol workers): recognized program DEC-11 and G5's already-specified model-input section and Stage 1 carrier; retained Q1 confirmation and actual statement delivery as closure gates.
