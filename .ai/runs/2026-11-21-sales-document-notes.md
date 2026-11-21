# Sales document notes clarity

Source doc: .ai/specs/2026-11-21-sales-document-notes-clarity.md
Design PR: #10262
Issue: #923

## Goal

Make the single document note and dated team-note history clear across quote/order creation and details, with Markdown persistence preserved.

## Scope

Sales creation form, document detail labels/help, existing locales, regression and self-contained integration coverage. Reuse CrudForm MarkdownField and the current Details/NotesSection editors. Keep field/group/tab IDs, API shapes, commands, permissions and stores intact. No shared UI or database changes, messaging, new provider or dependency.

## Implementation Plan

### Phase 1: Clear note purposes

1. Characterize the existing creation note configuration before changing it.
2. Apply the canonical creation Markdown field, Document note / Team notes terminology and localized help. Add the regression and integration tests.
3. Archive the capability Delta and run focused checks, the ordered repository gate and managed UI integration scenarios.
4. Address independent review findings, record evidence, and publish the ready implementation PR.

## Risks

Creation offers the formatted editor while Details intentionally retains Markdown source text and preview. Team notes must remain independent of document-note updates. Confirm both stores through APIs after create/edit/clear/cancel; keep fixtures isolated and clean them in finally. No customer-sharing promise is added.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Clear note purposes

- [ ] 1.1 Characterize the existing creation note configuration.
- [ ] 1.2 Align editors, labels and localized help with persistence coverage.
- [ ] 1.3 Archive capability and validate the final behavior.
- [ ] 1.4 Complete independent review and publish evidence.
