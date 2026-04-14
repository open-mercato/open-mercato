# Execution Plan: Inbox-Ops Lead Intake & CRM Enrichment

**Author:** Piotr (CTO)
**Date:** 2026-04-14
**App Spec:** `2026-04-14-inbox-ops-lead-intake-app-spec.md`

---

## Specs (in implementation order)

| # | Spec file | Feature | Depends on | Technical approach | Complexity | Commits |
|---|-----------|---------|-----------|-------------------|------------|---------|
| 1 | `2026-04-14-inbox-ops-crm-actions.md` | CRM Action Handlers + Foundation | — | Extend `InboxActionDefinition` in customers module. Additive enum changes. Custom fields via `ce.ts`. | Medium | ~9 |
| 2 | `2026-04-14-inbox-ops-knowledge-base.md` | Knowledge Base | #1 | New entity `InboxKnowledgePage`. CRUD API + backend page. Prompt composition in `buildExtractionSystemPrompt`. Token budget heuristic. | Large | ~10 |
| 3 | `2026-04-14-inbox-ops-enrichment.md` | Enrichment Matching | #1 | New `enrichmentMatcher.ts` pipeline stage. Deterministic match outcomes. Separate from existing `contactMatcher.ts`. | Medium | ~3 |
| 4 | `2026-04-14-inbox-ops-auto-approval.md` | Auto-Approval Engine | #2 | Extended structured output from extraction LLM. `autoApproved` + `decisionTrace` on `InboxProposalAction`. Wiki-governed, no hardcoded thresholds. | Medium | ~5 |
| 5 | `2026-04-14-inbox-ops-wiki-agent.md` | Wiki Agent | #2 | Register subagent in `ai-tools.ts` (Vercel AI SDK). 7 tools for KB read/write + proposal inspection. System prompt from `agent_prompt` KB page. Chat component on proposal detail. | Medium | ~7 |

## Key Technical Decisions

### 1. CRM Action Handlers — Extend, don't build

**Mode:** UMES extension of customers module
**Mechanism:** `InboxActionDefinition` registration in `customers/inbox-actions.ts`
**Rationale:** The extensibility model already exists and works. `create_contact`, `link_contact`, `log_activity`, `draft_reply` are already registered this way. Adding `create_deal`, `update_contact`, `update_deal` follows the identical pattern. No new architecture needed.

Key decisions:
- `create_deal` handler uses existing `customers.deals.create` command via `executeCommand`
- `update_deal` handler includes `splitCustomFieldPayload` for custom field integration (first inbox action handler to use this)
- Acceptance-time dedup check on `create_contact` — query CRM before executing, convert to `link_contact` if duplicate found
- All new enum values (categories, discrepancies, participant roles, action types) in ONE coordinated commit

### 2. Knowledge Base — New entity in inbox_ops, prompt composition redesign

**Mode:** Core module extension (inbox_ops)
**Mechanism:** New entity + CRUD + prompt composition
**Rationale:** No existing OM entity fits this use case. The Knowledge Base is inbox_ops-specific — it lives inside the module, not in a generic "content management" module.

Key decisions:
- Token budget: `Math.ceil(text.length / 4)` heuristic, not a real tokenizer. Default 8000 tokens.
- Prompt composition: Add `<knowledge_base>` section to `buildExtractionSystemPrompt`. Load pages ordered by sortOrder, grouped by category. Existing sections unchanged — backward compatible.
- Category-aware injection: `auto_approval` and `lessons` pages injected into auto-approval evaluation (Spec 4), not into extraction prompt. `agent_prompt` pages injected into wiki agent system prompt (Spec 5). `responses` pages always injected (no first-pass optimization in v1).
- KB lifecycle events: 3 new events for cache invalidation. Emit from CRUD API routes.
- Seed defaults: 4 starter pages in `setup.ts` — "Getting Started", "Contact Types", "Auto-Approval Rules" (conservative), "Lessons Learned" (empty template).

### 3. Enrichment Matching — Separate pipeline, not an extension of contactMatcher

**Mode:** Core module extension (inbox_ops)
**Mechanism:** New `enrichmentMatcher.ts` pipeline stage
**Rationale:** The existing `contactMatcher.ts` operates on extracted participants (name + email). Enrichment matching operates on email headers (In-Reply-To, References) and body content (email addresses, name+company mentions). Different inputs, different confidence model, different output shape (multi-candidate with scores vs. single best match).

Key decisions:
- enrichmentMatcher runs BEFORE contactMatcher in the extraction pipeline
- Returns structured outcome: `{ type: 'single' | 'multiple' | 'none' | 'low_confidence', candidates: Array<{ entityId, entityType, confidence, matchMethod }> }`
- Match methods: `thread_header` (1.0), `email_in_body` (0.95), `name_company` (0.7), `subject_reference` (0.5)
- Confidence threshold for "single match": 0.8 (below = `low_confidence`)
- Existing `contactMatcher` continues to run for participant-level matching within extraction

### 4. Auto-Approval — Wiki-governed LLM judgment, not code rules

**Mode:** Core module extension (inbox_ops)
**Mechanism:** Extended extraction pipeline + entity fields
**Rationale:** Auto-approval is a judgment call that the tenant controls through the Knowledge Base. No hardcoded thresholds in code. The LLM reads `auto_approval` + `lessons` pages and decides.

Key decisions:
- Auto-approval evaluation happens AFTER extraction, in the same extractionWorker run. Two-phase: (1) extract actions, (2) evaluate auto-approval per action.
- Could be a second `generateObject` call with auto-approval schema, or extend the first call's schema to include auto-approval decisions. Second call is cleaner — separation of concerns.
- `InboxProposalAction` entity gets 2 new fields: `autoApproved: boolean` (default false), `decisionTrace: jsonb` (nullable)
- Auto-approved actions are executed immediately in the extractionWorker — same `executeAction` codepath, `executedBy: 'system'`
- No `auto_approval` KB pages → all actions default to manual review (opt-in autonomy)
- Notification for auto-approved actions uses existing notification infrastructure, includes undo link via existing undo token

### 5. Wiki Agent — Module subagent with Vercel AI SDK

**Mode:** Core module extension (inbox_ops + ai-assistant)
**Mechanism:** Subagent registration in `ai-tools.ts`, chat component placement
**Rationale:** Aligned with Piotr's April 2026 architecture direction — modules as subagents. inbox_ops registers a subagent whose system prompt is a KB page. The ai-assistant module provides the chat component.

Key decisions:
- System prompt loaded from `agent_prompt` KB page at chat session start — not cached, always fresh
- 7 tools registered: `view_proposal`, `view_email`, `list_knowledge_pages`, `read_knowledge_page`, `update_knowledge_page`, `create_knowledge_page`, `search_contacts`
- Tools are registered as both MCP-compatible (existing pattern) and Vercel AI SDK-compatible (new pattern per Piotr's architecture)
- Chat component placed on `/backend/inbox-ops/proposals/[id]` page via existing ai-assistant injection pattern
- KB write tools (`update_knowledge_page`, `create_knowledge_page`) emit KB lifecycle events (from Spec 2) for cache invalidation
- Tenant without `agent_prompt` KB page → agent uses a hardcoded default prompt (seed page should be there, but defensive fallback)

## Scope flags

All 5 specs are `core-module` scope. This is intentional — inbox-ops lead intake is a platform feature, not an app-level customization. The changes extend two core modules (inbox_ops and customers) with additive-only modifications that follow existing patterns.

**No upstream blockers identified.** All changes are additive (new enum values, new entity, new action handlers, new AI tools). No existing contracts broken. No upstream PRs needed — this is new functionality.

## Estimated total: 5 specs, ~34 atomic commits

## Parallelism

Specs 3, 4, and 5 all depend on Spec 2 but are independent of each other. They can be implemented in parallel after Spec 2 is done. Spec 1 is the foundation — everything depends on it.

```
Spec 1 (Foundation) ─→ Spec 2 (Knowledge Base) ─┬→ Spec 3 (Enrichment)
                                                  ├→ Spec 4 (Auto-Approval)
                                                  └→ Spec 5 (Wiki Agent)
```
