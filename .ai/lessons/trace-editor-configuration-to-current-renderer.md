---
title: "Trace editor configuration to its current renderer"
modules: ["ui","sales"]
areas: ["backend-ui","architecture","testing"]
topics: ["ui-components","testing","backward-compatibility"]
---

# Trace editor configuration to its current renderer

Review of the #923 sales-notes specification found that the historical CrudForm selector `editor: uiw` now renders `MarkdownField`, which lazily loads MDXEditor. The Details multiline editor independently uses a Markdown source textarea and preview. A compatible selector name does not establish the current library or equivalent editing controls.

Trace each configured field through its real renderer before describing editor behavior or importing a dependency. Keep accepted compatibility selectors stable. State deliberate differences in controls, and test the persisted text across every create/update/clear/cancel path rather than infer an editing round trip from a shared Markdown storage type.

Evidence: `packages/ui/src/backend/CrudForm.tsx`, `packages/ui/src/backend/inputs/MarkdownField.tsx`, `packages/ui/src/backend/inputs/MdxEditorImpl.tsx`, `packages/ui/src/backend/detail/InlineEditors.tsx`, and `.ai/specs/2026-11-21-sales-document-notes-clarity.md`.
