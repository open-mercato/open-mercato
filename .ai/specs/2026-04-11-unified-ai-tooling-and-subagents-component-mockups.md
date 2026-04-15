# Unified AI Tooling and Subagents - Component Mockups

Companion to:
- `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`
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

## Notes for Implementation

- Reuse the same underlying runtime state across shell, debug drawer, and object result panel.
- Keep the component contracts additive so modules can embed only the pieces they need.
- Prefer simple composition over one giant "AI console" component.
