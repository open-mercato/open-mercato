# Unified AI Tooling and Subagents - Screen Mockups

Companion to:
- `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`

Purpose:
- keep implementation-oriented ASCII screen mockups outside the main spec
- give Phase 2 and Phase 3 work concrete UI targets without locking the final visual design too early

## 1. Playground Page
Route:
- `/backend/config/ai-assistant/playground`

Intent:
- one place to test general, customers, and catalog agents
- support both chat-mode and object-mode runs
- make page context and attachment testing visible

```text
+--------------------------------------------------------------------------------------------------+
| AI Assistant Playground                                                                         |
| Test agents, prompts, tools, files, and structured outputs                                      |
+--------------------------------------------------------------------------------------------------+
| Agent          [ General workspace assistant                          v ]  Mode [ Chat v ]       |
| Model override [ inherit tenant default............................ ]  Debug [x]  Dry run [ ]   |
| Context source [ Manual v ]   Page ID [ backend/catalog/products ]   Entity [ catalog.product ] |
| Record ID      [ prod_123......................................... ]   Prompt preset [ Default ] |
+--------------------------------------------------------------------------------------------------+
| Allowed tools                                                                 | Attachments      |
|--------------------------------------------------------------------------------|------------------|
| [x] search.hybrid_search                                                      | + Upload file     |
| [x] search.get_record_context                                                 | ---------------- |
| [x] catalog.get_product_detail                                                | 1. hero.jpg      |
| [x] catalog.list_product_media                                                |    image/jpeg    |
| [ ] catalog.update_product                                                    | 2. spec.pdf      |
| [ ] attachments.transfer_record_attachments                                   |    application/  |
|                                                                                |    pdf           |
+--------------------------------------------------------------------------------------------------+
| Transcript / Result                                                                              |
|--------------------------------------------------------------------------------------------------|
| user: "Summarize this product and tell me what the attached image suggests we should improve."   |
|                                                                                                  |
| assistant:                                                                                        |
| - Product is active, configurable, and currently sold in EUR.                                    |
| - Variant media is sparse compared to the description.                                           |
| - The attached image suggests the hero crop should be tighter.                                   |
|                                                                                                  |
| [ record-card ] [ list-summary ] [ warning-note ]                                                |
|                                                                                                  |
| > If Mode = Object, this pane switches to formatted JSON / schema result preview.                |
+--------------------------------------------------------------------------------------------------+
| Input                                                                                             |
|--------------------------------------------------------------------------------------------------|
| [ Ask something about the selected agent....................................................... ] |
| [ Send ]  [ Run object mode ]  [ Clear ]                                                         |
+--------------------------------------------------------------------------------------------------+
| Debug drawer                                                                                      |
|--------------------------------------------------------------------------------------------------|
| step 1: resolve agent -> catalog.merchandising_assistant                                         |
| step 2: hydrate page context -> ok                                                                |
| step 3: tool call -> catalog.get_product_detail(id=prod_123)                                     |
| step 4: tool call -> attachments.read_attachment(id=att_456)                                     |
+--------------------------------------------------------------------------------------------------+
```

## 2. Agent Settings Page
Route:
- `/backend/config/ai-assistant/agents`

Intent:
- tenant admin can inspect agents, prompt overrides, tool packs, and attachment policy
- hard safety rules remain server-owned; admin controls are additive

```text
+--------------------------------------------------------------------------------------------------+
| AI Agents Settings                                                                               |
| Manage prompts, tools, and file policy per agent                                                 |
+--------------------------------------------------------------------------------------------------+
| Sidebar                                                                 | Main panel             |
|-------------------------------------------------------------------------|------------------------|
| Agents                                                                  | Agent: customers.account|
| - General workspace                                                     | assistant              |
| - Customers                                                             |------------------------|
|   - account assistant                                                   | Status: enabled        |
|   - deal copilot                                                        | Execution: chat        |
| - Catalog                                                               | Default model: tenant  |
|   - merchandising assistant                                             | Features: customers.*  |
|   - pricing explainer                                                   |                        |
|-------------------------------------------------------------------------| Prompt sections        |
| Filters                                                                 |------------------------|
| [ Enabled only ]                                                        | [ROLE...............]  |
| [ Show object agents ]                                                  | [SCOPE..............]  |
| [ Search...................... ]                                        | [DATA...............]  |
|                                                                         | [TOOLS..............]  |
|                                                                         | [ATTACHMENTS........]  |
|                                                                         | [MUTATION POLICY....]  |
|                                                                         | [RESPONSE STYLE.....]  |
|                                                                         |                        |
|                                                                         | Tenant additive        |
|                                                                         | override:              |
|                                                                         | [....................] |
|                                                                         | [....................] |
|                                                                         |                        |
|                                                                         | [ Save override ]      |
+--------------------------------------------------------------------------------------------------+
| Tool packs                                                                                        |
|--------------------------------------------------------------------------------------------------|
| [x] search.hybrid_search   [x] customers.get_company_detail   [x] customers.get_person_detail    |
| [x] customers.list_deals   [ ] customers.update_deal          [ ] attachments.transfer_*         |
+--------------------------------------------------------------------------------------------------+
| Attachment policy                                                                                  |
|--------------------------------------------------------------------------------------------------|
| Images [ allow ]   PDFs [ allow ]   Generic files [ allow metadata-only ]   Max size [ 20 MB ]  |
| OCR text [ prefer when available ]   Binary fallback [ mention unsupported files to model ]      |
+--------------------------------------------------------------------------------------------------+
| Test snippets                                                                                      |
|--------------------------------------------------------------------------------------------------|
| 1. "Summarize the account and next steps."                                                        |
| 2. "Compare this PDF to the CRM record."                                                          |
| 3. "Prepare a structured brief for handoff."                                                      |
+--------------------------------------------------------------------------------------------------+
```

## 3. Embedded Detail Page Pattern
Intent:
- show how a module page embeds a focused agent without turning the page into a standalone chat app

```text
+--------------------------------------------------------------------------------------------------+
| Product Detail                                                                                   |
| Organic Coffee Beans                                                                             |
+-----------------------------------------------+--------------------------------------------------+
| Main detail form                               | Agent side panel                                 |
|-----------------------------------------------|--------------------------------------------------|
| Title            [ Organic Coffee Beans..... ] | Catalog merchandising assistant                  |
| Subtitle         [ Premium roast............ ] |--------------------------------------------------|
| Categories       [ Coffee, Organic......... ] | Context                                          |
| Variants         [ 250g, 500g, 1kg......... ] | - page: backend/catalog/products                 |
| Offers           [ 3 active................ ] | - entity: catalog.product                        |
| Media gallery    [ image ][ image ][ pdf  ] | - record: prod_123                               |
| Metadata         [ roast=medium............ ] |--------------------------------------------------|
|                                               | Ask                                              |
| [ Save ] [ Delete ]                           | [ How should we improve this listing?......... ] |
|                                               | [ Attach file ] [ Send ]                         |
|                                               |--------------------------------------------------|
|                                               | assistant:                                       |
|                                               | - The title is strong.                           |
|                                               | - Variant naming is inconsistent.                |
|                                               | - The image crop should focus on the package.    |
+--------------------------------------------------------------------------------------------------+
```

## 4. Customers Detail Embedded Pattern
Intent:
- show how the CRM assistants should fit next to the existing detail tabs

```text
+--------------------------------------------------------------------------------------------------+
| Company Detail: Northwind Trading                                                               |
+------------------------------------------------------+-------------------------------------------+
| Tabs: Notes | Activities | Deals | People | Tasks    | Customers account assistant               |
|------------------------------------------------------|-------------------------------------------|
| Notes timeline                                        | Suggested actions                          |
| - Meeting summary                                     | - Follow up on open deal in 3 days        |
| - Pricing discussion                                  | - Ask for updated annual spend            |
|                                                       |-------------------------------------------|
| People                                                | Ask                                        |
| - Jane Doe, Buyer                                     | [ Summarize this account and next step.. ] |
| - John Roe, Finance                                   | [ Attach QBR PDF ] [ Send ]               |
|                                                       |-------------------------------------------|
| Deals                                                 | assistant:                                 |
| - Renewal Q3                                          | - Account healthy but blocked on pricing.  |
| - Upsell pilot                                        | - Jane is main commercial contact.         |
+--------------------------------------------------------------------------------------------------+
```

## Notes for Implementation

- The playground should prioritize transparency over polish.
- The settings page should prioritize edit safety over density.
- Embedded agent panels should stay secondary to the main business record, not replace the record UI.
