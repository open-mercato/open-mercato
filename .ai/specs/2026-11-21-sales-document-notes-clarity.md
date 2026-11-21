# Sales document notes clarity

Extends: .ai/specs/SPEC-047-2026-02-25-sales-document-detail-pages-v2.md
Issue: #923

## TLDR

Proposed: staff creating or editing a quote or order create its single Document note with the existing formatted Markdown editor; Details retains its current Markdown source-text editor and preview. A separately named Team notes tab retains the dated note history. Labels explain the two purposes without changing storage, recipients or permissions.

## Resolved assumptions (autonomous defaults)

| Question | Decision | Reason |
|---|---|---|
| Merge the field and history? | Preserve both; distinguish Document note from Team notes. | The issue permits clear differentiation; merging would change storage, audit and integration behavior. |
| Creation editor? | Reuse CrudForm richtext with its canonical MarkdownField/MDXEditor path (`editor: uiw` is the existing compatibility selector). | It supports the same Markdown strings that detail and history editors already handle. |
| Split capabilities? | One presentation capability across the document lifecycle. | Both edits address the same choice of where to write a note; no separate domain behavior is introduced. |
| Describe visibility? | Explain storage/purpose, without promising customer delivery or confidentiality. | Existing APIs and document rendering remain authoritative; this change sends nothing. |

## Overview and Problem Statement

Issue #923 describes three inconsistent ways to write notes. Current `SalesDocumentForm.tsx` exposes a Comments textarea when creating a document. The detail page exposes Comment through `DetailFieldsSection` multiline editing, while its Comments tab uses the independent `/api/sales/notes` history through `NotesSection`. That history mixes Add comment and Add note labels. Staff cannot easily tell whether a field replaces the document note or appends to the history.

The bounded outcome is consistent names, persisted Markdown and purpose, with the two persisted concepts kept separate. Creation offers the canonical formatted Markdown toolbar; Details deliberately retains source-text Markdown editing and preview. Consolidating databases, sending customer messages, changing note permissions and rebuilding the shared notes component are outside scope.

## Prior spec drift

SPEC-047 describes the single `comments` header field and a separate notes tab. Those storage purposes remain. Its create-field table documents the current textarea; the present detail page already supports Markdown source-text multiline editing and preview, rather than the creation toolbar. This proposal extends presentation using the existing richtext field type while retaining both field/tab IDs.

## Research

[Odoo quotation documentation](https://www.odoo.com/documentation/18.0/applications/sales/sales/sales_quotations/create_quotations.html) distinguishes document notes from record activity. Its [Chatter documentation](https://www.odoo.com/documentation/17.0/applications/productivity/discuss/chatter.html) describes logged notes on records. [ERPNext terms documentation](https://docs.frappe.io/erpnext/terms-and-conditions) likewise treats text stored on a transaction as its own document content. The applicable lesson is explicit purpose, not importing messaging, followers or a new comments subsystem.

## Proposed Solution

- Creation: label the existing `comments` field Document note; use `type: richtext`, `editor: uiw` (the existing selector for MarkdownField/MDXEditor). A short hint says it is saved with the document and edited in Details, while Team notes holds dated notes.
- Details: label the existing singular `comment` projection Document note and use Add document note as its placeholder. Keep its existing inline editor and save operation.
- History: retain the `comments` tab ID but display Team notes. Use Add note consistently for its add action and existing composer. Explain above the history that it stores dated team notes separately from the document note. Rename the empty state to No notes yet.
- Localize changed copy in every existing sales locale. Keep legacy translation keys, field/group IDs, tab URLs and extension handles stable.

## Delta

### Capability: sales-document-notes

#### MODIFIED Requirement: Consistent document-note editing

The system SHALL offer a formatted Markdown toolbar at creation, then retain source-text Markdown editing and preview for that same persisted Document note in Details.

##### Scenario: Create and reopen a document note

- WHEN staff create either a quote or an order with a formatted Document note
- THEN the existing comments payload persists its Markdown and the Details document note displays that content after reopening.

Frozen by: `packages/core/src/modules/sales/components/__tests__/salesDocumentFormChannelToggle.test.tsx`

##### Scenario: Edit, clear and cancel Document note in Details

- WHEN staff edit the Document note in Details and save through the existing versioned document PUT, then reopen the document
- THEN the edited Markdown is persisted, and existing Team note IDs, bodies and count remain unchanged.
- WHEN staff save an empty Document note
- THEN the existing null/empty clearing behavior persists and Team notes remain unchanged.
- WHEN staff cancel a Details draft
- THEN no document PUT occurs and both stores retain their previous values.

#### ADDED Requirement: Distinguishable note purposes

The system SHALL distinguish the single Document note from the dated Team notes history through localized labels and help text.

##### Scenario: Add a team note without replacing the document note

- WHEN staff open Team notes and add a note
- THEN it appears in the dated history and the existing document note remains unchanged.

##### Scenario: Cancel a note edit

- WHEN staff enter a team note and cancel its composer
- THEN no note request is sent and the document note remains unchanged.

## Architecture

Primary module: sales. Reuse `CrudForm` richtext/MarkdownField (MDXEditor), `DetailFieldsSection` and `NotesSection`. No shared UI component changes, new services or cross-module relationships. Existing `apiCall`, guarded mutations and optimistic locking continue to protect writes. Existing notes data adapter retains its create/update/delete paths and scope.

Client boundary: `SalesDocumentForm.tsx` and document detail `page.tsx` already use client rendering for editing and data loading; no new client file or provider is introduced. MarkdownField retains its existing lazy import of MdxEditorImpl; the historical `uiw` selector is not a new UIW import or dependency. No eager Markdown import, new bundle dependency, shell change or hydration override. Verify create-page interactivity and Markdown input in the integration scenario; package/app build is the route/bundle compatibility check.

## Data Models and API Contracts

No entities, schemas or migrations change. The document string persists as `SalesOrder.comments` or `SalesQuote.comments`; the existing detail projection/legacy update alias is `comment`. Notes remain separate `SalesNote` records with author/time metadata.

Affected paths to exercise, with unchanged contracts:

- `POST /api/sales/orders` and `POST /api/sales/quotes`: `comments` remains an optional Markdown/plain string under existing validation limits.
- `GET /api/sales/orders?id=...` and quotes equivalent: verify the persisted document note.
- `PUT /api/sales/orders` and `PUT /api/sales/quotes`: exercise the existing `comment` update alias and version headers through Details, including clear/cancel.
- `POST/GET /api/sales/notes`: verify formatted team history and separation from the document field.
- Cleanup uses existing scoped DELETE routes. No extra requests occur on Cancel.

No permissions or encryption rules change. This is presentation only; rollback restores labels/editor while existing Markdown remains readable by the current detail/history rendering.

## UI/UX

Routes: `/backend/sales/documents/create` and `/backend/sales/documents/[id]?kind=order|quote`.

The standard form and inline editors retain their existing save/cancel and keyboard behavior. Creation has the formatted Markdown toolbar; Details intentionally retains a Markdown source textarea and preview. That difference is explicit and does not require shared InlineEditors changes. Team notes preserves loading, empty, error and optimistic-conflict states. Copy wraps using existing semantic typography tokens. No new dialog, color, icon or bespoke layout is needed. Existing notes read/write visibility stays intact.

Mockups: standard existing CrudForm and notes UI with terminology changes; no new layout. Current-app screenshots will be captured with implementation QA when the managed ephemeral environment runs. No accepted prototype is replaced.

## Edge Cases and Failure Scenarios

- Existing plain notes render unchanged; do not transform or migrate old strings.
- Empty note remains optional and clears under the current API semantics.
- API validation/conflict errors remain handled by the existing form and inline/editor paths; never issue a second write to the other note store.
- Adding/cancelling a team note does not update the document field. Changing Document note does not create a history note.
- Narrow screens retain the shared Markdown editor behavior; help copy must wrap.
- Existing translations remain available at their current keys; do not rename keys consumed by other modules.

## Risks & Impact Review

| Risk | Severity / area | Mitigation and residual risk |
|---|---|---|
| Mistaking a document note for a team-history entry | Medium / staff workflow | Distinct labels and always-visible purpose text; integration verifies separate stores. |
| Formatting controls alter saved string syntax | Low / document content | Existing Markdown storage/rendering; test formatted and plain note round trips. Existing character limits remain. |
| Editor increases initial route cost | Low / creation UI | Reuse lazy CrudForm UIW path, no eager import or dependency. Verify production build and interaction. |
| Copy implies sharing/privacy changes | Medium / user expectations | Describe storage/purpose only; no customer-delivery or confidentiality promise. |

## Migration & Backward Compatibility

No public contract changes. Keep `comments`, `comment`, `channels-comments`, the `comments` tab ID, existing APIs, ACLs, events, widget spots and translation keys. No data migration or new dependency. Existing automation that selects translated labels must follow the new user-facing terminology; regression tests use the new labels.

## Integration Coverage

Add self-contained `TC-SALES-923-document-notes.spec.ts` in the sales module. Cover both order and quote: create via the real UI using a formatting control on Document note, reopen detail, and create a formatted Team note. Edit the Document note through Details, reload and verify its GET value; assert the Team note IDs, bodies and count are unchanged. Clear the Document note with the existing null/empty semantics, then cancel another Details draft without a PUT. Cancel a team-note draft without a POST. Verify both stores through their APIs after each action and clean up all created records in finally. Cover 390px layout and keyboard submission/cancel using the shared editor. Use API fixtures for customer/channel setup rather than demo records.

## Phasing

One phase: align the existing note surfaces and verify persistence boundaries.

## Implementation Plan

1. Characterize the current creation field in the existing form test harness; run green and commit before changing its type.
2. Change the creation editor, document labels and history labels/help; translate every changed locale. Update the characterization to the new behavior and test persistence in both note stores.
3. Add and run self-contained integration coverage for order/quote and cancellation; run the ordered repository validation gate and capture UI evidence, including the intentional Details source editor and creation toolbar.
4. Archive the Delta to `.ai/specs/capabilities/sales-document-notes.md`; independent review and ready implementation PR referencing this design.

## Final Compliance Report

One module, existing primitives, scoped existing writes, stable contracts and existing encryption. No migrations or new dependencies. Integration tests and review must accompany implementation; this document does not claim they passed.

## Changelog

- 2026-11-21: Proposed consistent note terminology and Markdown persistence for #923. Independent review amendments explicitly retain the Details source editor, identify MDXEditor correctly, and add Details edit/clear/cancel persistence and separation oracles.
