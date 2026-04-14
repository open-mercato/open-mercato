# Architectural Review: Inbox-Ops Lead Intake Spec Suite

**Reviewer:** Agent (Martin Fowler lens)
**Date:** 2026-04-14
**Scope:** 5 specs reviewed in dependency order + cross-spec analysis
**Verdict:** ~~Needs Revision (3 High, 8 Medium issues across specs)~~ **Approved** (all issues resolved 2026-04-14)

---

## Executive Summary

The spec suite is **architecturally sound overall**. The dependency chain is well-sequenced, the additive-only approach respects BC contracts, the module isolation is correct (inbox_ops owns extraction, customers owns CRM mutations), and the UMES pattern is properly applied. The Knowledge Base as a wiki-governed LLM customization layer is an elegant design.

However, the review identified **3 cross-spec inconsistencies**, **1 naming convention violation**, **1 performance concern in the enrichment pipeline**, and several gaps in the auto-approval spec's payload summarization that would degrade CRM action evaluation quality.

---

## Spec 1: CRM Action Handlers & Foundation

### Summary
Adds 3 action handlers (`create_deal`, `update_contact`, `update_deal`), extends 4 enums, declares custom fields on deals. Additive-only, no new entities, no new routes. Clean bounded-context design.

### Critical
None.

### High
- **Commits 1 and 3 are effectively the same commit.** Both modify `validators.ts` Zod enums. The spec acknowledges "may be merged" but should be definitive. Merge them. Artificial commit boundaries create review overhead and increase partial-application risk for the "coordinated atomic commit" rationale stated in the spec itself.

### Medium
- **`update_contact` dual-feature RBAC is non-obvious.** `REQUIRED_FEATURES_MAP` maps `update_contact` to `customers.people.manage`, but the handler performs a runtime check for `customers.companies.manage` when `entityType === 'company'`. This "static map + runtime override" pattern has no precedent in the existing `REQUIRED_FEATURES_MAP`. It should be documented as a deliberate exception, or the map should use a composite key like `update_contact:person` / `update_contact:company` (preferred).
- **No explicit transaction boundary for dedup check.** The acceptance-time dedup in `create_contact` queries CRM, then creates. Between the check and the command execution, another concurrent acceptance could create the contact (TOCTOU race). The window is small (~ms) but the spec states "Execution-time dedup is the only reliable check" -- it should then ensure that reliability via a serializable transaction or unique constraint.

### Low
- Line number references ("lines 85-128 of `inbox-actions.ts`") will drift after edits. Remove or use function-name references instead.
- **Checklist item: Undo behavior** -- the spec states `executeCommand` provides undo. Correct, but `update_contact` and `update_deal` handlers should document that undo reverts to the previous field values (not a hard delete), which is a different undo semantic than `create_deal` (soft-delete).

---

## Spec 2: Knowledge Base

### Summary
New `InboxKnowledgePage` entity with CRUD API, backend pages, token budget, prompt injection, seed defaults, and prompt refactoring from positional params to options object. The biggest spec by scope.

### Critical
- **`tokenEstimate` is not a persisted field on the entity, but Spec 5 references it as one.** The KB entity definition has no `tokenEstimate` / `token_estimate` column. The API computes `tokenCount` on-the-fly from `Math.ceil(content.length / 4)`. But Spec 5's wiki agent tools (`list_knowledge_pages`, `read_knowledge_page`) return `tokenEstimate` as if it's a stored field. **Resolution required:** Either (a) add `token_estimate` as a persisted column updated on save, or (b) document that it's always computed and align Spec 5 to use the same field name. Option (a) is preferred -- it avoids recomputing on every list query.

### High
- **Prompt refactoring (Commit 7) is the riskiest change in the entire suite.** Refactoring `buildExtractionSystemPrompt` from 5 positional params to an `ExtractionPromptOptions` object modifies every call site: `extractionWorker.ts`, `api/extract/route.ts`, and all tests in `__tests__/extractionPrompt.test.ts`. The spec buries this in Commit 7 without listing all affected call sites. **Recommendation:** Promote this to Commit 1 or 2 (before the entity work) since it's the prerequisite for both Spec 3 (`enrichmentMatch` param) and the KB injection itself. All other specs depend on this interface being stable.
- **API response uses `tokenCount`, Spec 5 tools use `tokenEstimate`.** Pick one name and use it everywhere. Suggest `tokenEstimate` since the heuristic is an estimate, not an exact count.

### Medium
- **No cache strategy for KB pages loaded during extraction.** Every extraction worker invocation queries `InboxKnowledgePage` from the DB. At high email volume (e.g., 100+ emails/hour), this is a repeated query for data that changes rarely. Consider a short TTL cache (60-120s) with invalidation via the `knowledge_page.*` events defined in the spec. The events infrastructure is already there -- wire it up.
- **Token budget: hard block on POST but soft warning from agent tools.** The CRUD API returns 400 when budget is exceeded. Spec 5's `update_knowledge_page` tool says it "returns a warning but does not block." This behavioral inconsistency between two write paths to the same entity will confuse users. **Recommendation:** Be consistent -- either both block or both warn. Since the token budget is advisory (LLM context windows are much larger), make both paths warn.
- **Missing `deleted_at` handling in slug uniqueness constraint.** The unique constraint is on `(organization_id, tenant_id, slug)` without considering `deleted_at`. A soft-deleted page blocks re-creation of the same slug. Add `WHERE deleted_at IS NULL` partial unique index instead.

### Low
- Seed defaults (4 starter pages) should have their categories explicitly listed in a table: Getting Started (general), Contact Types (leads), Auto-Approval Rules (auto_approval), Lessons Learned (lessons).
- The `search` query parameter on GET list route is defined but the spec doesn't describe whether it searches title-only, content-only, or both. Specify.

---

## Spec 3: Enrichment Matching Pipeline

### Summary
Adds `enrichmentMatcher.ts` pipeline stage before `contactMatcher`. Deterministic matching via 4 methods (thread headers, email-in-body, name+company, subject reference). No new entities, APIs, or UI.

### Critical
None.

### High
- **Methods 3 and 4 independently fetch up to 200 CRM records each.** Both call `findWithDecryption` with `limit: 200` on the same entity with the same filter. That's 2 redundant queries returning the same data. **Fix:** Extract a shared `loadCrmRecords(em, scope, deps, limit)` function called once; pass the result to both methods.
- **N+1 query pattern in Method 1.** `matchByThreadHeaders` loads proposals by `$in: previousEmailIds` (good), but then loops through proposals and queries `InboxProposalAction` one proposal at a time: `for (const proposal of proposals) { const actions = await em.find(InboxProposalAction, { proposalId: proposal.id, ... }) }`. **Fix:** Batch the action query: `em.find(InboxProposalAction, { proposalId: { $in: proposalIds }, ... })` and group client-side.
- **Missing index verification for `InboxEmail.messageId`.** Method 1 queries `inbox_emails` by `messageId` field. If no index exists, this is a full table scan per extraction. **Check:** Verify the existing migration includes `CREATE INDEX idx_inbox_emails_message_id ON inbox_emails(message_id)` or add one.

### Medium
- **Subject patterns (Method 4) are English-only.** Patterns like `RE: Lead - {name}` and `FW: {name} - Scoring Report` won't match German "AW:", French "TR:", Spanish "RV:", etc. The spec should at minimum use a locale-aware prefix set: `(?:RE|AW|SV|RV|FW|Fwd|WG|TR|RIF)`. This is a one-line regex fix with significant multi-tenant impact.
- **`extractEntityNameFromPayload` helper is fragile.** It checks `payload.name`, `payload.contactName`, `payload.title` -- but Spec 1's `createDealPayloadSchema` uses `title`, `updateContactPayloadSchema` has no name field (uses `entityId`), and `updateDealPayloadSchema` has no name either. The helper will return empty string for most CRM actions. Add `payload.entityId` as a fallback identifier.
- **Cross-spec dependency on Spec 2's prompt refactoring is implicit.** The commit plan says "Commit 2: Integrate into extraction pipeline" and adds `enrichmentMatch` to `ExtractionPromptOptions`. But this options object doesn't exist until Spec 2, Commit 7 is done. The spec correctly notes this dependency in the BC section but the commit plan should have an explicit prerequisite: "Requires Spec 2, Commit 7 (options object refactoring) to be merged first."

### Low
- The `ENRICHMENT_CONFIDENCE_THRESHOLD = 0.8` is a module-level constant. Consider making it configurable via `InboxSettings` (alongside `knowledgeTokenBudget` from Spec 2) so tenants with different CRM data quality can tune it.

---

## Spec 4: Auto-Approval Engine

### Summary
Two-phase extraction: extract actions (existing), then evaluate auto-approval per action via second LLM call. Wiki-governed rules, opt-in autonomy, full auditability via `decisionTrace` JSON field. Clean architecture with good fail-safe semantics.

### Critical
None.

### High
- **`summarizePayloadForApproval` doesn't handle Spec 1's new CRM action types.** The switch statement has cases for `create_contact`, `create_order`, `create_quote`, `log_activity`, `draft_reply`, `link_contact` -- but NOT for `create_deal`, `update_contact`, `update_deal`. These fall through to `default: return ''`. This means the auto-approval LLM receives **no payload context** when evaluating CRM actions. The LLM is asked "should this be auto-approved?" but doesn't see *what* the action contains (deal title, contact name, custom fields). **Fix:** Add cases for all three Spec 1 action types.
- **Event naming violation: `inbox_ops.actions.auto_approved` uses plural `actions`.** The OM convention is `module.entity.action` with **singular entity**: `inbox_ops.action.rejected`, `inbox_ops.action.edited`, `inbox_ops.action.executed`. This should be `inbox_ops.action.auto_approved`. Event IDs are a FROZEN surface -- getting this wrong on first commit is costly.
- **RBAC bypass scope should be explicit.** The `ensureUserCanExecuteAction` bypass for `SYSTEM_USER_ID` is a blanket `return`. This means the system user bypasses not just feature checks but any future validation added to this function (rate limits, entity-level locks, etc.). **Recommendation:** Instead of an early return, explicitly check the required features from `REQUIRED_FEATURES_MAP` against a synthetic "system" feature set, or add a comment `// SECURITY: This bypass is intentional for auto-approval. Any new validation added here must consider SYSTEM_USER_ID.`

### Medium
- **`em.fork().flush()` on execution failure is suspicious.** Inside the `executeAutoApprovedActions` loop, when an action fails, the code calls `em.fork().flush()`. Forking creates a new unit-of-work that doesn't see uncommitted changes from the parent EM. The `action.autoApproved = false` mutation happened on the parent EM's managed entity -- the fork won't persist it. **Fix:** Collect mutations in the main EM and flush once after the loop.
- **`recalculateProposalStatus(em.fork(), proposalId, scope)`** -- same issue. The fork won't see the action status updates from `executeAction`. Use the same EM instance.
- **`ActionsAutoApprovedPayload` missing `failedCount`.** The payload has `autoApprovedCount` and `pendingCount` but not `failedCount`. Since execution failures clear `autoApproved` and set `status: 'failed'`, the notification subscriber can't report how many auto-approved actions failed. Add `failedCount` to the payload.
- **`action.confidence` is a string, `DecisionTrace.confidence` is a number.** The evaluator does `confidence: parseFloat(action.confidence)`. This works but is a silent type coercion. Document the intentional conversion, or change the DecisionTrace schema to accept string.

### Low
- The `INBOX_OPS_AUTO_APPROVAL_MODEL` env var is mentioned in the table but not referenced in the `runAutoApprovalWithConfiguredProvider` code (which uses `input.modelOverride` passed from the evaluator). Show the wiring.
- The default timeout of 30s is generous for a secondary LLM call. Consider 15s -- auto-approval should be fast.

---

## Spec 5: Wiki Agent

### Summary
Conversational AI agent on proposal detail page with 7 tools (5 read, 2 write). Self-contained Vercel AI SDK integration. System prompt as a KB page. Clean architecture with no new entities.

### Critical
None.

### High
- **Model is hardcoded to `anthropic('claude-sonnet-4-20250514')`.** Spec 4 correctly uses `resolveOpenCodeModel(providerId, ...)` which respects environment configuration. The wiki agent should use the same pattern so tenants can choose their provider/model. Hardcoding couples the agent to a specific provider and prevents cost optimization.
- **No rate limiting on chat endpoint.** The `POST /api/inbox-ops/agent/chat` endpoint triggers an LLM call per request with streaming. Without rate limiting, a user (or bot) could generate unlimited LLM calls. Apply the existing `rateLimiter` from `lib/rateLimiter.ts` (already used by the extraction pipeline) with a per-user, per-minute limit.

### Medium
- **Tool call results rendering not addressed.** The `useChat` hook from Vercel AI SDK emits messages including tool invocation results. The `InboxAgentChat` component renders `m.content` for all messages, but tool calls produce structured results (not plain text). The component should either: (a) filter tool-call messages and render a summary, or (b) explicitly render tool results in a structured format (e.g., collapsible code blocks). Currently, tool calls would render as `[object Object]` or empty strings.
- **Injection spot ID `admin.page:inbox-ops/proposals/[id]:after` needs verification.** The OM widget injection convention uses spot IDs like `data-table:<entityId>:*` and `crud-form:<entityId>:*`. The `admin.page:*` pattern should be verified against existing injection spots. If this is a new pattern, document it.
- **Chat component has no error handling for failed API calls.** The `useChat` hook supports an `onError` callback. The component should handle network errors, 403s (permission denied), and 500s gracefully instead of silently failing.

### Low
- The default agent prompt mentions "Undo auto-approved actions" as a capability, but no undo tool is defined in the 7 tools. The agent can only view proposals and edit KB pages. Remove the undo claim from the default prompt or add an `undo_action` tool.
- The `search_contacts` tool uses `$like` search on `displayName`. For encrypted fields, `$like` won't work with `findWithDecryption`. The spec should use `findWithDecryption` with exact match or delegate to the search index (from `packages/search`).

---

## Cross-Spec Issues

### 1. `tokenEstimate` / `tokenCount` Inconsistency (Spec 2 + Spec 5)

Spec 2 API responses use `tokenCount`. Spec 5 tool responses use `tokenEstimate`. The entity may or may not persist this value. **Action:** Decide on one name, persist it as a column, update on every content save. Both specs must use the same name.

### 2. Auto-Approval Payload Summarizer Missing CRM Types (Spec 1 + Spec 4)

Spec 4's `summarizePayloadForApproval` switch statement has no cases for `create_deal`, `update_contact`, `update_deal` from Spec 1. The LLM evaluating auto-approval for CRM actions gets zero payload context. **Action:** Add cases in Spec 4 for all Spec 1 action types.

### 3. Prompt Refactoring Dependency (Spec 2 + Spec 3)

Spec 3 adds `enrichmentMatch` to `ExtractionPromptOptions`. This interface is created by Spec 2, Commit 7. The execution plan says Specs 3, 4, 5 can run in parallel after Spec 2. **Clarification:** Spec 3 can only start after Spec 2, **Commit 7** specifically (not just "after Spec 2 completes" generically). If Spec 2 commits are merged incrementally, Spec 3 is blocked until Commit 7 lands.

### 4. Event Naming Violation (Spec 4)

`inbox_ops.actions.auto_approved` breaks the singular entity convention. All existing events use singular: `inbox_ops.action.executed`, `inbox_ops.action.rejected`. **Fix:** Rename to `inbox_ops.action.auto_approved`. This is a FROZEN surface -- must be correct on first commit.

### 5. US-04 (Reply Sending) Not Covered

The app spec lists US-04: "As a sales rep, draft a reply in the proposal, review, send." The `draft_reply` action handler exists (creating a draft interaction). But none of the 5 specs address the "review and send" workflow where the user edits and sends the draft. If this is intentionally deferred, it should be explicitly called out in the execution plan as out-of-scope.

### 6. US-05 (Category Filter UI) Partially Covered

Spec 1 adds new categories (`lead_intake`, `lead_enrichment`, `lead_followup`) and i18n labels. But no spec adds a category filter dropdown to the proposal list page UI. The filter already works at the API level (`?category=lead_intake`), but the UI discoverability is missing.

---

## Checklist Summary

### Spec 1 — CRM Actions
- **Security**: Passed
- **Performance**: Passed
- **Cache**: N/A (no new read-heavy endpoints)
- **Commands**: Passed (uses existing `executeCommand` pattern)
- **Risks**: Passed (thorough risk table)
- **Verdict**: **Approved with minor revisions** (merge commits 1+3, document dual-feature RBAC)

### Spec 2 — Knowledge Base
- **Security**: Passed
- **Performance**: Needs revision (missing cache strategy for extraction-time KB loading)
- **Cache**: Needs revision (events exist but no cache wired)
- **Commands**: N/A (CRUD, not command pattern)
- **Risks**: Passed
- **Verdict**: **Needs revision** (tokenEstimate persistence, prompt refactoring ordering, slug uniqueness with soft-delete)

### Spec 3 — Enrichment Matching
- **Security**: Passed
- **Performance**: Needs revision (duplicate CRM fetch, N+1 in Method 1, missing messageId index)
- **Cache**: N/A (transient pipeline data)
- **Commands**: N/A
- **Risks**: Passed (thorough, honest about limitations)
- **Verdict**: **Needs revision** (deduplicate CRM queries, fix N+1, verify messageId index, add i18n subject prefixes)

### Spec 4 — Auto-Approval
- **Security**: Passed with notes (RBAC bypass is intentional but should be more explicit)
- **Performance**: Passed
- **Cache**: N/A
- **Commands**: Passed (reuses executeAction)
- **Risks**: Passed
- **Verdict**: **Needs revision** (event naming, payload summarizer for CRM types, em.fork issues)

### Spec 5 — Wiki Agent
- **Security**: Passed
- **Performance**: Needs revision (no rate limiting on chat)
- **Cache**: N/A
- **Commands**: N/A
- **Risks**: Passed
- **Verdict**: **Needs revision** (configurable model, rate limiting, tool result rendering)

---

## Priority Action Items (ordered by impact)

| # | Severity | Spec | Issue | Fix | Status |
|---|----------|------|-------|-----|--------|
| 1 | **High** | 4 | Event name `actions` (plural) breaks FROZEN convention | Rename to `inbox_ops.action.auto_approved` | **Resolved** |
| 2 | **High** | 4 | `summarizePayloadForApproval` missing CRM action types | Add `create_deal`, `update_contact`, `update_deal` cases | **Resolved** |
| 3 | **High** | 2+5 | `tokenEstimate` vs `tokenCount` + not persisted | Add `token_estimate` column, align name across both specs | **Resolved** |
| 4 | **High** | 2 | Prompt refactoring should be earlier in commit plan | Move to Commit 2 (unblocks Spec 3) | **Resolved** |
| 5 | **High** | 3 | Duplicate CRM record fetch in Methods 3+4 | Share one query across both methods | **Resolved** |
| 6 | **High** | 3 | N+1 on `InboxProposalAction` in Method 1 | Batch query with `$in: proposalIds` | **Resolved** |
| 7 | **High** | 5 | Model hardcoded to specific provider | Use `resolveOpenCodeModel` pattern | **Resolved** |
| 8 | **Med** | 4 | `em.fork().flush()` won't persist parent EM mutations | Use single EM, flush once after loop | **Resolved** |
| 9 | **Med** | 3 | English-only subject prefix patterns | Add `AW|SV|RV|WG|TR|RIF` prefixes | **Resolved** |
| 10 | **Med** | 5 | No rate limiting on chat endpoint | Apply existing `rateLimiter` | **Resolved** |
| 11 | **Med** | 2 | No cache for KB pages during extraction | Add short-TTL event-invalidated cache | **Resolved** |
| 12 | **Med** | 2 | Soft-deleted pages block slug reuse | Use partial unique index with `WHERE deleted_at IS NULL` | **Resolved** |
| 13 | **Med** | 4 | `recalculateProposalStatus` uses forked EM | Use same EM instance | **Resolved** |
| 14 | **Med** | Cross | US-04 reply sending not covered | Explicitly defer in execution plan | Open (execution plan scope) |
| 15 | **Med** | Cross | US-05 category filter UI not covered | Add filter dropdown to proposal list | Open (execution plan scope) |

### Additional fixes applied (beyond original findings)

| Spec | Fix |
|------|-----|
| 1 | Merged commits 1+3 → 9 total commits (was 10) |
| 1 | Added Undo Semantics section documenting undo behavior per handler |
| 1 | Removed brittle line-number references, replaced with function names |
| 2 | Added seed defaults table with explicit category/slug mappings |
| 3 | Added messageId index verification note |
| 3 | Fixed `extractEntityNameFromPayload` for CRM action payloads (`entityId`, `dealId`) |
| 3 | Made Spec 2 Commit 2 prerequisite explicit in commit plan |
| 4 | Added `failedCount` to event payload |
| 4 | Added explicit SECURITY comment on RBAC bypass |
| 4 | Documented `confidence` string→number type conversion |
| 5 | Added tool result rendering in chat component (handles `toolInvocations`) |
| 5 | Fixed default agent prompt (removed false undo claim) |
| 5 | Added error handling + error display to chat component |

### Vercel AI SDK v6 compliance pass (2026-04-14)

After reviewing Piotr's CTO talk (pkarw-12.04.26) and auditing against AI SDK v6 (`ai@^6.0.0`), the following additional fixes were applied:

| Spec | Fix |
|------|-----|
| 4 | Migrated `generateObject` → `generateText` + `Output.object()` (SDK v6, `generateObject` is deprecated) |
| 4 | Updated `result.object` → `result.output` (SDK v6 return property) |
| 4 | Added SDK v6 compatibility note |
| 5 | Replaced `toDataStreamResponse()` → `toUIMessageStreamResponse()` (SDK v6 preferred) |
| 5 | Added `stopWhen: stepCountIs(10)` for multi-step tool calls (replaces deprecated `maxSteps`) |
| 5 | Added `tool()` helper pattern documentation for type-safe tool definitions |
| 5 | Updated `useChat` rendering from `m.content`/`m.toolInvocations` → `m.parts` (SDK v6) |
| 5 | Added Triple-Exposure Pattern section per CTO directive (MCP + Vercel AI SDK + HTTP endpoint) |
| 5 | Added SDK v6 compliance summary note |
| 5 | Made chat component reusable with `subagentEndpoint` prop |

---

### Review -- 2026-04-14
- **Reviewer**: Agent (Martin Fowler lens)
- **Security**: Passed (with note on Spec 4 RBAC bypass)
- **Performance**: ~~Needs revision~~ Passed (N+1 fixed, duplicate query fixed, rate limiting added)
- **Cache**: ~~Needs revision~~ Passed (KB page cache with event invalidation added)
- **Commands**: Passed
- **Risks**: Passed (all 5 specs have thorough risk tables)
- **Verdict**: ~~Needs revision~~ **Approved** -- 13/15 items resolved in specs; 2 remaining items (#14, #15) are execution plan scope, not spec defects

### Re-review -- 2026-04-14
- **Reviewer**: Agent
- **Verdict**: **Approved** -- all architectural issues resolved. Specs are ready for implementation.

### SDK v6 compliance review -- 2026-04-14
- **Reviewer**: Agent (CTO lens + AI SDK v6 audit)
- **SDK version**: `ai@^6.0.0` (6.0.44)
- **generateObject usage**: Migrated to `generateText` + `Output.object()` in Spec 4
- **streamText patterns**: Spec 5 uses `toUIMessageStreamResponse()`, `stopWhen`, `tool()` helper
- **useChat rendering**: Spec 5 uses `message.parts` (not deprecated `toolInvocations`)
- **Triple-exposure**: Spec 5 documents MCP + Vercel AI SDK + HTTP endpoint pattern per CTO directive
- **Verdict**: **Approved** -- all specs compliant with AI SDK v6 and CTO architecture vision
