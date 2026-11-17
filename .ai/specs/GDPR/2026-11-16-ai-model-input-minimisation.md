# What a model is given: withholding fields from model input

> **Program:** second part of F1, [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md), issue open-mercato/open-mercato#8593.
> **Status:** decision record. Option B is decided (program DEC-11): no field-level model-input control, and G5's disclosure ships before #8593 closes. Alternative A below is the rejected design, kept as a record; it is not built from this spec. Current-code claims were checked in the read-only repository.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

Tools and page-context builders can send decrypted record data to a model. A field filter would cover only declared record shapes on selected paths. The decision is to ship no field-level control and document exactly what is sent. The narrower control that was considered stays below as a rejected alternative, with its gaps, including OpenCode over MCP.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Decision | Alternative considered |
|---|---|---|---|
| Q1 | Build a narrow field-withholding control, or record no field-level control? | B (program DEC-11): no field-level control. Provider policy stays the enforceable control; every route in the Problem Statement table, from tool results and page contexts to embeddings, text extraction and web research, is documented as model input. A filter would cover declared typed-tool output only, while the other routes still reach the model, and it would be read as masking | A: the narrow withholding design below; rejected and not built. A later field-level control needs its own spec and must never be described as comprehensive masking |
| Q2 | Does option A preserve unmasked chat transcripts? | Moot under B: no formatter is added, so the typed chat transcript, its UI parts and stored tool output keep the current tool result. For the record, A would have put the masked/truncated result in all three | A separate model/UI output split; not designed |

The program's **Decisions — DEC-11**, **Phase 0 — Decisions and hygiene** and **Known limits** record Q1=B and the disclosure gate. The carrier is `apps/docs/docs/deployment/gdpr/impact-assessment-notes.mdx#what-the-assistant-sends-to-a-model`, section **What the assistant sends to a model**, specified by [`2026-11-16-gdpr-deployment-docs.md`](2026-11-16-gdpr-deployment-docs.md), **Proposed Solution** and **Implementation Plan — Stage 1**, step 1. That design requires the section to name every model-input route in the **Problem Statement** table and state that the data on each route may leave the installation, including through legacy OpenCode over MCP; provider permission is not field minimisation. The program's **Known limits** links that delivery artifact and states **No field-level model-input control**. These are established design requirements, not evidence that the page has shipped. B is complete when the statement ships, before #8593 closes.

## 📝 Overview

Option B has no code change or new API. The controller learns from G5's section which inputs reach a model and decides on that basis. Rejected alternative A would have withheld values only where a declared result is formatted; a controller would then have needed the uncovered paths beside the setting, rather than infer that a field can never reach a model.

## 📝 Problem Statement

| Route | Current behavior and evidence | Alternative A coverage (rejected) |
|---|---|---|
| Typed-agent tools | Private `formatToolResult` serializes the handler result; the tool returns that string to the AI SDK (`packages/ai-assistant/src/modules/ai_assistant/lib/agent-tools.ts:145-154`, `:315-319`) | Declared object records only; chat transcript receives the same filtered result |
| Page-context hydration | Direct tool-handler calls in `packages/core/src/modules/customers/ai-agents-context.ts:88-105` and `catalog/ai-agents-context.ts:108-127` | Declared records, through the new exported formatter |
| Legacy OpenCode over MCP | `docker/opencode/opencode.jsonc.example` points to the app MCP endpoint; `ai_assistant/lib/mcp-server.ts:142-170` serializes `executeTool` output for OpenCode's model | Not covered; MCP is a model path as well as an interactive client path |
| Code mode | Preformatted string output in assistant `lib/codemode-tools.ts` | Not covered |
| Search | Presenter titles/subtitles in `packages/ai-assistant/src/modules/ai_assistant/ai-tools/search-pack.ts` | Not covered |
| Attachments, inbox/warranty prompts, user text | Free text/files, without result-entity declarations | Not covered |
| Agent runtime callers | `runAiAgentText` / `runAiAgentObject` in `ai_assistant/lib/agent-runtime.ts`, called by the chat and run-object routes, `workflows/lib/ai-draft-runner.ts` and `channel_discord/lib/ai-reply.ts`; each sends its prompt, conversation and tool output | Typed-agent tool results only |
| Agent orchestrator context and evaluation | Enterprise `agent_orchestrator/lib/runtime/nativeAgentRunner.ts` runs `runAiAgentObject` over context modules resolved by `lib/context/contextResolver.ts` (documents, retrieval, OCR); `lib/eval/llmJudge.ts` sends run output and expected output to a judge model | Not covered |
| Assistant command routing | `ai_assistant/api/route/route.ts` sends the user query and tool names to `generateObject` | Not covered |
| Inbox and warranty prompts | `inbox_ops/lib/llmProvider.ts`, `inbox_ops/lib/translationProvider.ts`, `inbox_ops/ai-tools.ts` and `warranty_claims/lib/aiAssist.ts` send email bodies, claim text and lines | Not covered |
| Embeddings | `packages/search/src/vector/services/embedding.ts` sends indexed record text and search queries to the configured embedding provider (`search/lib/embedding-config.ts`) | Not covered |
| Attachment text extraction | `attachments/lib/ocrService.ts` sends image and PDF page content to the OCR model | Not covered |
| Web research | `packages/web-research-model/src/adapter.ts` sends the search query to a model with a web-search tool | Not covered |
| Input moderation | `ai_assistant/lib/moderation.ts` sends the current user turn to the OpenAI moderations endpoint when a surface opts in | Not covered |
| Decision model | `ai_assistant/lib/decision-model-service.ts` (DI `decisionModelService`) and `lib/decision-adapters/openrouter.ts` send a decision request; no first-party caller today | Not covered |

`executeTool` also serves the human-facing execute route, so global filtering there changes a separate API contract. Typed chat output is different: `api/ai/chat/route.ts:268-284` extracts UI parts from the streamed tool output. Filtering the tool's returned string also filters the transcript/UI output and persisted representation. Alternative A would have accepted that effect, with no promise that chat users see the unmasked result.

The current formatter is private. Page builders cannot call it without a new package export. A tool's generic keys do not identify an entity, so declarations must carry that information; key-name heuristics are not a substitute.

## 📝 Proposed Solution

Option B, decided. No code, setting or API changes. G5 writes **What the assistant sends to a model** in its Stage 1. The section lists every route in the table above, including embeddings, attachment text extraction, web research, input moderation, agent-orchestrator context and evaluation, and the decision model. Routes whose provider is a separate vendor choice (embeddings, text extraction, moderation, web research) link their rows on the `sub-processors` page, which names the vendor and how to disable the flow; the section still states what data each route sends. It states that provider permission is not field minimisation. G5's model-input inventory test fails when a new model-calling file is not listed, so the table cannot silently fall behind the code. The program's **Known limits** links it. F1's provider policy ([`2026-11-16-ai-data-protection.md`](2026-11-16-ai-data-protection.md)) stays the control the product enforces. G5 updates the section when later F1 controls ship.

### Alternative A (rejected, not built)

The reviewed design, kept as the record behind DEC-11. Nothing here is implemented; a later field-level control starts from a new spec.

1. Add optional `resultEntities` declarations to first-party tools. A declaration identifies record roots by a JSON Pointer, lists the exact record properties it returns as `fields`, and says whether that root is one record or an array of records. A tool with no declaration is unfiltered and listed as uncovered.
2. Add `withheldFields`, an empty-by-default list of `{ entityId, field }`, to `ai_tenant_model_allowlists`. Extend the loaded result of `AiTenantModelAllowlistRepository.getEffectivePolicy(scope)` from [`2026-11-16-ai-data-protection.md`](2026-11-16-ai-data-protection.md), **Policy loading and selection**, with `withheldFields`; keep the existing `AiTenantModelAllowlistSnapshot`, `getForTenant` and `getSnapshot` contracts unchanged. Organization row wins, then tenant row; an explicit empty withheld list on an organization row wins too. Formatting callers load this policy even when `enforceForCalls` is false: provider permission and field withholding are separate settings. `none` means an empty list; `unavailable` refuses model formatting with `ai_policy_unavailable` before content leaves, never an empty-policy fallback. Settings validate choices against declared fields, use feature ACL and return `updatedAt` for optimistic locking.
3. Add `formatModelToolResult` in `ai_assistant/lib/model-tool-result.ts`, exported through the assistant package. Typed-agent execution and both page-context builders call it after authorized execution. They pass the actual tool definition and server-derived scope, not a guessed entity or browser-supplied policy. Only the model-formatting paths change; execute API responses and underlying business records do not.
4. An empty withheld list delegates to the existing formatter unchanged: no new JSON envelope, validation substitution or byte ceiling. A non-empty list activates the formatter: mask matching declared fields with `[withheld]`, then apply the structure-preserving size rule below. For typed agents this exact value is also the chat transcript's tool output and UI-part source. No unfiltered copy is persisted beside it by this formatter.
5. Beside the list show code mode, search, attachments, module-built prompts, user text, undeclared tools and **legacy OpenCode over MCP: not covered**. MCP clients cannot reliably be classified as people; alternative A leaves their output unchanged and states that it may go to a model.

#### Paths and size budget

`path` uses RFC 6901 JSON Pointer: empty string is the result root; `/records` selects a property; `~0` and `~1` escape tilde and slash; numeric segments address array indices. No dots, wildcards, recursive descent or implicit array expansion. `cardinality: 'many'` means the selected value must be an array and each element is a record of the declared entity; `one` means a record object. `field` is an exact record property name, including a custom-field property where the tool declares it. Nested record locations use additional declarations, for example `/result/people` with `many`; declarations may not overlap ambiguously.

A declared root with the wrong shape is replaced at that root by `[withheld: invalid declaration]`, and recorded as a bounded code without values. An absent pointer is reported as absent, never searched heuristically. Pack tests must cover each declared shape; absence is a coverage gap visible in settings, not proof of filtering.

With a non-empty withheld list, the budget is **32,768 UTF-8 bytes of serialized JSON per formatted result**, after masking. These active-policy results are always valid JSON; empty-policy calls retain their legacy representation and limits. When over budget, remove whole trailing array items or object properties in stable order, preserving the largest prefix that fits, and wrap as `{ "result": <retained structure>, "truncated": true, "marker": "[truncated]" }`; include envelope bytes in the budget. If an oversized scalar or first member cannot fit, use `{ "result": null, "truncated": true, "marker": "[truncated]" }`. Never slice serialized JSON or split a UTF-8 sequence. Results below budget are serialized unchanged except for masking. This is a byte ceiling, not a model-token budget.

#### Known limits it would have shown beside the control

A name in a note, a search snippet or a file is not a declared field. OpenCode can retrieve that same data over MCP. Undeclared third-party tools are untouched. Typed-agent chat transcripts would be masked too. Withholding a field in one covered route is not a guarantee that it cannot reach a model by another route. These limits are the reason for DEC-11.

## 📝 Delta

None. B adds no system requirement; the disclosure requirement belongs to G5's **Proposed Solution** and **Stage 1**. Alternative A is not recorded as a Delta, so nothing is archived from this spec.

## 📝 Architecture

B: no code. The change is one documentation section in `apps/docs`, owned by G5. `executeTool`, MCP output, chat transcripts and authorization contracts stay unchanged. Rejected alternative A would have added an OSS helper, optional tool declarations and a field list on the scoped allow-list repository and settings page; customers and catalog would have called the exported helper through a package import, without the helper reading their tables or broadening a tool's ACL or mutation approval.

## 📝 Data Models

B: none. Rejected alternative A would have added `ai_tenant_model_allowlists.withheld_fields jsonb NOT NULL DEFAULT '[]'`, with migration and snapshot, reusing its `updated_at` for optimistic locking.

## 📝 API Contracts

B: none. Alternative A's reviewed contract, recorded and not built:

```ts
resultEntities?: Array<{ entityId: string; path: string; cardinality: 'one' | 'many'; fields: string[] }>
formatModelToolResult(input: {
  tool: AiToolDefinition
  scope: { tenantId: string; organizationId?: string | null }
  withheldFields: ReadonlyArray<{ entityId: string; field: string }>
  result: unknown
}): string
```

The formatter would have been synchronous and pure, receiving the already-loaded scoped policy and returning legacy text unchanged when that list is empty; with an active non-empty list it would validate declarations using Zod and return JSON text, never resolving another tenant's policy. `PUT /api/ai_assistant/settings/allowlist`, the provider-policy sibling's existing route, would have accepted optional `withheldFields`, with the settings read returning the list, coverage and `updatedAt` under the existing settings feature. No second endpoint, loader or MCP result-type change was part of it.

## 📝 Migration & Backward Compatibility

B ships documentation only. No contract surface changes; existing tools, chat transcripts and execute responses keep their output. Alternative A would have added optional declarations with an empty default, and its opt-in transcript masking and size ceiling would have needed an upgrade note; it is not built.

## 📋 Phasing

| Phase | Outcome | Gate |
|---|---|---|
| B | Model-input statement and Known limits link | Deliver the two carrier edits before #8593 closes |

No phase builds alternative A.

## 📋 Implementation Plan

### Option B
1. Program DEC-11 records Q1=B. The deployment-docs owner writes **What the assistant sends to a model** in G5 Stage 1; the program's **Known limits** links it.
2. Verify the statement against the route inventory and shipped provider-policy coverage. Do not close the documentation task with an empty placeholder.
3. G5 Stage 1 adds the model-input inventory test (`scripts/__tests__/gdpr-model-input-routes.test.mjs`, with its route list `gdpr-model-input-routes.json`). It finds every non-test source file under `packages/*/src` that imports `generateText`, `streamText`, `generateObject`, `streamObject`, `embed` or `embedMany` from `ai` or from the assistant's `lib/ai-sdk` re-export, including a dynamic `import('ai')`, or that calls `runAiAgentText` / `runAiAgentObject`. Each must be listed with its route; each route must appear in the published section; a listed file that no longer exists fails. Direct HTTP callers (moderation, decision adapters) are listed by hand.

### Alternative A
Not built, so no steps. The review fixed what a later field-level control spec would have to deliver in one change: the exported scoped formatter with JSON Pointer validation and unit tests; declarations on the people/companies/deals tools, with both context builders routed through the formatter; the scoped `withheld_fields` setting with optimistic locking and coverage UI; and a deterministic test-only recording model adapter with self-contained integration tests.

## 🧪 Integration Coverage

B adds no API or UI path, so it adds no integration test. Its gate is documentation review against the route inventory, G5's content checks, which assert the exact model-input heading, anchor, every route in the table above and the provider-permission limitation, and G5's model-input inventory test, whose unit cases use temporary fixture files and clean them in `finally`: an unlisted model caller fails, a listed one passes, a removed listed file fails and a listed route missing from the page fails. Alternative A's planned TC-AI-MIN-001 and TC-AI-MIN-002 are not delivered because A is not built.

## 📝 Edge Cases & Failure Scenarios

| Case | Behavior |
|---|---|
| Disclosure section absent or a placeholder at closure | #8593 stays open; an empty placeholder never closes the documentation task |
| Provider permission read as field minimisation | The section states that provider permission is not field minimisation |
| A value reaches a model through OpenCode over MCP, a search snippet, an attachment or a prompt | The route is listed in the disclosure; no route is presented as filtered |
| Chat transcript and UI parts | Unchanged; B adds no formatter, so Q2 is moot |
| A new model path ships later | The inventory test fails until the file is listed with a route and the route is on the page; G5 also updates the section for later F1 controls |
| A model call made by plain HTTP rather than the AI SDK | Not detected by the inventory pattern; listed by hand, and the review rule requires it |

## 📝 Risks & Impact Review

| Scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Narrow control read as complete protection | High | Controllers relying on masking | B builds no field-level control; the disclosure lists every route | A later spec that revisits A must list its uncovered paths beside the setting |
| No control but documentation omitted | High | B deployments | Named docs section, G5 content checks and the program closure gate | Other owners must deliver carrier edits |
| Personal data reaches a model with no field control | High | Tenants using the assistant | F1 provider policy, the disclosure and the controller's own assessment | Accepted under DEC-11; the controller decides from the disclosure, not from a filter |
| Route inventory drifts as new model paths ship | Medium | Disclosure accuracy | G5's inventory test fails on an unlisted AI SDK or agent-runtime caller; step 2 verifies the statement; G5 updates it for later F1 controls | A model call made by plain HTTP is caught only by review |

## Final Compliance Report — 2026-11-16

| Rule | Status | Notes |
|---|---|---|
| Direction decision recorded | Decided | Q1=B under program DEC-11 with a concrete carrier; Q2 moot |
| Additive contracts and tenant scope | Compliant | B changes no contract, setting or tenant-scoped data |
| Integration coverage | Not applicable to B | No API/UI path; G5 content checks assert the section; A's tests are not delivered because A is not built |
| Honest limits | Compliant design | The disclosure names OpenCode/MCP, embeddings, text extraction, web research, moderation, agent context and every other route; an inventory test keeps the list complete for AI SDK callers; provider permission is not field minimisation |

**Verdict:** B is decided (DEC-11) and complete when G5's section ships and the program's Known limits links it, before #8593 closes. Alternative A is rejected and not built.

## Changelog

### 2026-11-16
- Split from the AI data-protection spec after independent review. The first design filtered in the tool executor by key name. The review showed that the executor also serves people and stored rows, that code mode returns a string a key walk cannot see, that page-context hydration bypasses it, that search results carry titles not field names, and that field names such as `name` and `description` would blank unrelated data. This version filters only where a result is formatted for a model, only for tools that declare what they return, and puts the question of building it at all to a person.

- Council round two fixes (GPT-6.1 Sol workers): r2iqa-13 — inventory and disclose OpenCode over MCP; r2iqa-37 — Q1 default and named docs/program carriers; r2iqa-38 — exported scoped formatter; r2iqa-39 — mandatory recording adapter and integrations; r2iqa-40 — JSON Pointer and byte/truncation rules; g6-28 — masked typed transcript stated and tested.
- Council round two fixes, pass two (GPT-6.1 Sol workers): bound option B to the deployment-docs carrier's actual Stage 1 and marked its missing section explicitly; synchronized the sibling's effective-policy method, result member, settings route and version name; kept conditional withholding active independently of provider enforcement, with matching failure and test requirements.
- Council round two fixes, pass three (GPT-6.1 Sol workers): recognized program DEC-11 and G5's already-specified model-input section and Stage 1 carrier; retained Q1 confirmation and actual statement delivery as closure gates.

### 2026-11-17
- Route inventory completed: embeddings, attachment text extraction, web research, input moderation, agent-runtime callers, agent-orchestrator context and evaluation, assistant command routing and the decision model are now listed, the search-pack path is corrected, and G5's model-input inventory test fails on an unlisted model caller.
- Superseded by DEC-11 / Q1=B: no formatter, withholding or transcript masking is built. Entries above that describe filtering, masked transcripts or conditional withholding record Alternative A.
