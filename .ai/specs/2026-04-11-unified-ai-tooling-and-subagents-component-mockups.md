# Unified AI Tooling and Subagents - Component Mockups

Companion to:
- `.ai/specs/implemented/2026-04-11-unified-ai-tooling-and-subagents.md`
- `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents-screen-mockups.md`

Purpose:
- define the reusable building blocks for Phase 2 and Phase 3
- keep component structure separate from the main spec narrative

## 1. `AiChat` Shell

```text
+--------------------------------------------------------------------------------------+
| Header                                                                               |
| [ agent badge ]  Title                           [ mode ] [ debug ] [ overflow menu ]|
+--------------------------------------------------------------------------------------+
| Context strip                                                                        |
| entity: catalog.product   record: prod_123   attachments: 2   tools: 5              |
+--------------------------------------------------------------------------------------+
| Transcript                                                                           |
|                                                                                      |
| user bubble                                                                          |
| assistant bubble                                                                     |
| tool-call event card                                                                 |
| ui-part card                                                                         |
|                                                                                      |
+--------------------------------------------------------------------------------------+
| Composer                                                                             |
| [ textarea........................................................................ ] |
| [ attach ] [ page context ] [ send ]                                                 |
+--------------------------------------------------------------------------------------+
```

Behavior notes:
- header always makes the selected agent and mode obvious
- context strip is compact but visible for debugging
- transcript supports plain text, tool events, and UI parts in one stack

## 2. Agent Picker

```text
+--------------------------------------------------------------+
| Select agent                                                 |
|--------------------------------------------------------------|
| Search [ customers........................................ ] |
|--------------------------------------------------------------|
| General                                                      |
|  - Workspace assistant                 chat    tools: 7      |
|                                                              |
| Customers                                                    |
|  - Account assistant                   chat    tools: 9      |
|  - Deal copilot                        object  tools: 5      |
|                                                              |
| Catalog                                                      |
|  - Merchandising assistant             chat    tools: 8      |
|  - Pricing explainer                   object  tools: 4      |
+--------------------------------------------------------------+
```

Behavior notes:
- grouped by module/domain
- show execution mode and approximate tool breadth inline
- surface only agents the current user can access

## 3. Attachment Tray

```text
+------------------------------------------------------------------+
| Attachments                                                      |
|------------------------------------------------------------------|
| [ + Upload ]                                                     |
|------------------------------------------------------------------|
| 1. hero.jpg                           image/jpeg      ready       |
|    source: bytes                      extracted: no               |
|                                                                  |
| 2. offer-spec.pdf                     application/pdf  ready      |
|    source: signed-url                 extracted: yes              |
|                                                                  |
| 3. stock-export.xlsx                  metadata-only    fallback   |
|    note: unsupported binary, model sees filename and type only   |
+------------------------------------------------------------------+
```

Behavior notes:
- attachment processing state should be visible before send
- the fallback mode must be explicit so users know what the model can actually consume

## 4. Debug Drawer

```text
+--------------------------------------------------------------------------------------+
| Debug                                                                                |
|--------------------------------------------------------------------------------------|
| Request                                                                              |
| - agentId: catalog.merchandising_assistant                                           |
| - mode: chat                                                                         |
| - pageContext: catalog.product / prod_123                                            |
|                                                                                      |
| Runtime                                                                              |
| - prompt sections: ROLE, SCOPE, DATA, TOOLS, ATTACHMENTS, MUTATION POLICY           |
| - resolved model: tenant default                                                     |
|                                                                                      |
| Events                                                                               |
| 1. tool: catalog.get_product_detail                                                  |
| 2. tool: attachments.read_attachment                                                 |
| 3. ui-part: record-card                                                              |
+--------------------------------------------------------------------------------------+
```

Behavior notes:
- split by request, runtime resolution, and events
- avoid raw internal noise unless the user expands deeper details

## 5. Prompt Override Editor

```text
+--------------------------------------------------------------------------------------+
| Prompt override                                                                      |
|--------------------------------------------------------------------------------------|
| Hard safety sections                                                                 |
| [ROLE.................locked....................................................... ] |
| [MUTATION POLICY......locked....................................................... ] |
|                                                                                      |
| Tenant additive sections                                                             |
| [ Additional business rules........................................................ ] |
| [ Additional tone/style guidance................................................... ] |
| [ Domain glossary.................................................................. ] |
|                                                                                      |
| Preview                                                                              |
| [ Show merged prompt ]  [ Diff from default ]                                        |
|                                                                                      |
| [ Save draft ] [ Publish ]                                                           |
+--------------------------------------------------------------------------------------+
```

Behavior notes:
- the UI should make the locked vs editable boundary obvious
- merged preview is necessary before publish

## 6. Tool Pack Matrix

```text
+------------------------------------------------------------------------------------------------+
| Tool packs                                                                                     |
|------------------------------------------------------------------------------------------------|
| Pack                              | Included tools                       | Enabled | Writable   |
|-----------------------------------|--------------------------------------|---------|-----------|
| search.core                       | hybrid_search, get_record_context    |   [x]   |    no     |
| attachments.core                  | list, read, transfer                 |   [x]   |   mixed   |
| customers.account_read            | person, company, deal detail         |   [x]   |    no     |
| customers.account_write           | update deal, tag assignment          |   [ ]   |   yes     |
| catalog.merchandising_read        | product detail, media, offers        |   [x]   |    no     |
| catalog.merchandising_write       | update product, update category      |   [ ]   |   yes     |
+------------------------------------------------------------------------------------------------+
```

Behavior notes:
- this should help admins understand capability at a glance
- writable packs should be visually distinct even if disabled

## 7. Object Result Panel

```text
+--------------------------------------------------------------------------------------+
| Structured result                                                                     |
|--------------------------------------------------------------------------------------|
| schema: deal_brief_v1                                                                 |
|                                                                                      |
| {                                                                                    |
|   "summary": "Renewal likely slips into next quarter",                               |
|   "risks": ["pricing pushback", "missing stakeholder alignment"],                    |
|   "nextActions": [                                                                   |
|     "schedule procurement follow-up",                                                |
|     "share revised commercial proposal"                                              |
|   ]                                                                                  |
| }                                                                                    |
|                                                                                      |
| [ Copy JSON ] [ Copy Markdown ] [ Re-run ]                                           |
+--------------------------------------------------------------------------------------+
```

Behavior notes:
- object-mode should never dump raw output into the normal transcript without formatting
- copy actions matter because these results are likely to be reused elsewhere

## 8. Mutation Preview Card (Phase 3)

Rendered in-transcript when the runtime intercepts a mutation-capable tool call and creates a pending action. This is the primary approval surface for the interactive in-chat HIL flow described in the main spec (§9).

```text
+--------------------------------------------------------------------------------------+
| [!] Approval required                                   expires in 09:42            |
|--------------------------------------------------------------------------------------|
| Update deal DEAL-42 "Northwind Renewal Q3"                                          |
| agent: customers.account_assistant       tool: customers.update_deal                 |
|--------------------------------------------------------------------------------------|
| Field diff                                                                           |
|   stage        Negotiation  ->  Won                                                  |
|   closeDate    null         ->  2026-04-18                                          |
|   wonReason    null         ->  "Pricing accepted"                                   |
|--------------------------------------------------------------------------------------|
| Side effects                                                                         |
| - deals.deal.updated event will fire                                                 |
| - pipeline "Enterprise" totals will recompute                                        |
| - attached QBR PDF will stay linked                                                  |
|--------------------------------------------------------------------------------------|
| [ Cancel (Esc) ]                                    [ Confirm (Cmd/Ctrl+Enter) ]    |
+--------------------------------------------------------------------------------------+
```

Behavior notes:
- composer is soft-disabled while this card is pending, but the user can still scroll and re-read prior turns
- the countdown ticks locally but the authoritative `expiresAt` is server-side; once the countdown hits zero, the buttons replace with an "Expired — ask again to retry" state
- on `Confirm`, the card transitions into `confirmation-card` (see 10) while the server executes; on `Cancel`, the agent posts a short continuation and the composer re-enables
- if the tab reloads mid-approval, `<AiChat>` calls `GET /api/ai/actions/:id` and re-renders the card in its current state

## 9. Field Diff Card (Phase 3)

Reusable component used both inside `mutation-preview-card` and — in the future Stacked Approval Queue (D17) — as a standalone row renderer.

```text
+--------------------------------------------------------------+
| Field diff                                                   |
|--------------------------------------------------------------|
| stage             Negotiation   ->   Won                     |
| closeDate         (empty)       ->   2026-04-18              |
| wonReason         (empty)       ->   "Pricing accepted"      |
| attachments       2 linked      ->   2 linked (unchanged)    |
+--------------------------------------------------------------+
```

Behavior notes:
- fields that do not change are either hidden or dimmed; never omit them silently if the agent referenced them in its plan
- sensitive fields (tokens, secrets, encryption blobs) MUST be masked even in the diff — the server renders `***` for these, never the raw value
- the diff is authoritative only at propose time; stale confirms are rejected server-side by the `recordVersion` check, so the UI does not need to re-diff live

## 10. Confirmation Card (Phase 3)

Transient state shown between `[Confirm]` click and the server's `mutation-result-card` response. Prevents double-submit and tells the user the system is doing the work.

```text
+--------------------------------------------------------------+
| [spinner] Executing: Update deal DEAL-42                     |
| Re-checking permissions, scope, and freshness...             |
|--------------------------------------------------------------|
| [ Cancel is no longer available ]                            |
+--------------------------------------------------------------+
```

Behavior notes:
- disabled buttons, not hidden ones — users need to understand the action is in-flight, not vanished
- if the server responds with a `412` (stale version) or `422` (validation failed), this card transitions to an error variant explaining the failure and inviting the user to ask again rather than retry blindly

## 11. Mutation Result Card (Phase 3)

Terminal state rendered after successful execution. Replaces the `mutation-preview-card` in the transcript (the preview is not kept around — its job is done) and lets the agent continue the conversation naturally.

```text
+--------------------------------------------------------------------------------------+
| [✓] Saved: deal DEAL-42 "Northwind Renewal Q3"                                       |
|--------------------------------------------------------------------------------------|
| stage        Negotiation  ->  Won                                                    |
| closeDate    null         ->  2026-04-18                                             |
| wonReason    null         ->  "Pricing accepted"                                     |
|--------------------------------------------------------------------------------------|
| [ Open record ]                                                                      |
+--------------------------------------------------------------------------------------+
```

Behavior notes:
- fires a DOM event bridge refresh so the underlying record page (if embedded) reflects the save without a manual reload
- the agent immediately follows the card with a short natural-language confirmation ("Done — anything else?") so the transcript reads like a conversation, not a form submission log
- on failure, a red variant of this card is rendered with a short error message and a "Try again" action that nudges the user to re-ask rather than blindly retry

## 12. Future: Approval Queue Row (Phase 4+, D17)

Design-only placeholder so consumers know the data contract is stable. Same `field-diff-card` renderer, different container. Not implemented in this spec.

```text
+--------------------------------------------------------------------------------------+
| Pending approvals (3)                                assigned to: sales-ops          |
|--------------------------------------------------------------------------------------|
| Agent                       Action                       Record        Expires   [ ] |
|--------------------------------------------------------------------------------------|
| customers.account_assistant Update deal (stage=Won)      DEAL-42       09:42    [ ] |
| catalog.merchandising_asst  Update product pricing       PROD-910      14:05    [ ] |
| sales.order_assistant       Issue partial refund $120    INV-2011      03:17    [ ] |
|--------------------------------------------------------------------------------------|
| [ Approve selected ]  [ Reject selected ]  [ Open in chat ]                          |
+--------------------------------------------------------------------------------------+
```

Behavior notes:
- each row expands into a full `field-diff-card` inline; the component contract is reused exactly
- bulk approve/reject fans out to the same single-action endpoints so every approval still runs the full server-side re-check
- "Open in chat" re-hydrates the originating `<AiChat>` with the pending action so the user can drop back into the conversation

## Notes for Implementation

- Reuse the same underlying runtime state across shell, debug drawer, and object result panel.
- Keep the component contracts additive so modules can embed only the pieces they need.
- Prefer simple composition over one giant "AI console" component.
- The four Phase 3 cards are server-emitted only; client code never synthesizes them. The UI-part registry treats them as trusted markers but still re-fetches authoritative record state from the normal record endpoints before rendering anywhere outside the approval flow.
