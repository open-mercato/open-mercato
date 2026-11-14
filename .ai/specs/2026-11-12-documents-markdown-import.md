# Documents — Markdown Import

- **Date:** 2026-11-12
- **Status:** Implemented (branch `feat/documents-review-findings`)
- **Scope:** OSS (`.ai/specs/`)
- **Package:** `@open-mercato/documents` · module id `documents`
- **Related:** `.ai/specs/2026-07-08-documents-collaborative-editor.md` (host module), `.ai/specs/2026-11-11-documents-ai-review-findings.md` (outline and finding section labels rely on heading nodes)

## TLDR

**Key Points:**
- Users can create documents from `.md` files on the documents list page with **Import Markdown**. Headings become real H1–H3 editor nodes, so the outline and review section labels work immediately.
- Conversion runs in the browser with libraries already in the monorepo (`react-markdown` + `remark-gfm`, rendered with `react-dom/server` `renderToStaticMarkup`). Documents are created through the existing APIs: `POST /api/documents`, then `PUT /api/documents/{id}/content`.

**Scope:** list-page action and file picker, Markdown → HTML conversion helper, client-side validation and limits, progress and summary feedback, i18n (en/pl/de/es/ko), unit and integration tests, user-guide section.

**Out of scope:** server-side import endpoint, other formats (`.docx`, `.html`), images bundled with the Markdown, front matter, export to Markdown, drag-and-drop.

**Concerns:** none for data or contracts: no new API route, entity, event, ACL feature or DI key. The documents package declares two dependencies that were already resolved in the workspace (`react-markdown@^10.1.0`, `remark-gfm@^4.0.1`, same ranges as `@open-mercato/ui`).

## Overview and Problem Statement

Teams keep contracts, policies and notes as Markdown. Pasting them into the editor loses structure (headings arrive as bold paragraphs), so the outline and the section labels on review findings stay empty. An import that maps Markdown structure to editor nodes removes that manual reformatting.

## Proposed Solution and Architecture

Client-only feature on the documents list page: `DocumentsTable` (button + hidden file input) → `useMarkdownImport` hook (validation, sequential import, progress, flash, navigation) → lazy-loaded `lib/markdownImport.ts` converter → existing `POST /api/documents` and `PUT /api/documents/{id}/content`. The server path is unchanged.

## Data Models and API Contracts

No new entities, columns, routes or events. Reuses `POST /api/documents` (`{ title, folderId }`, `documents.create`) and `PUT /api/documents/{id}/content` (`{ contentHtml, contentText }`, `documents.edit`), and `DELETE /api/documents/{id}` for cleanup of a document whose content save failed.

## UX

- **Entry point:** an outline **Import Markdown** button (lucide `FileUp`) in the documents table header, shown when the user can create documents in the current destination (same `canCreateDocument` gate as **Create document**: `documents.create` plus edit access to the selected folder).
- **File picker:** hidden `<input type="file" multiple accept=".md,.markdown,text/markdown,text/plain">`, labelled for assistive technology.
- **Destination:** the folder currently selected in the folder tree, or the root.
- **Progress:** the button is disabled and reads "Importing {current} of {total}…" (polite live region) while files are processed sequentially.
- **Result:** one flash message — success ("Imported 3 documents"), partial (warning with per-file reasons) or failure (error with per-file reasons). One successful file opens the new document; several refresh the list.
- No dialog is added, so no extra keyboard contract applies.

## Conversion Rules

Implemented in `packages/documents/src/modules/documents/lib/markdownImport.ts` (light constants and validators in `lib/markdownImportValidation.ts`, so the list page loads the Markdown parser only on first import via dynamic `import()`).

| Markdown | HTML handed to the content API |
|---|---|
| `#`, `##`, `###` (and setext) | `<h1>`–`<h3>` (deeper levels map to `<h4>`–`<h6>`) |
| paragraphs, `*italic*`, `**bold**`, `~~strike~~`, inline code | `<p>`, `<em>`, `<strong>`, `<del>`, `<code>` |
| links | `<a href>`; unsafe schemes removed by react-markdown's `defaultUrlTransform` |
| bullet / ordered lists | `<ul>` / `<ol>` |
| GFM task lists | `<ul data-type="taskList"><li data-type="taskItem" data-checked>` (editor TaskList/TaskItem), checkbox inputs dropped |
| GFM tables | `<table><thead><tr><th>`… |
| block quotes, fenced code | `<blockquote>`, `<pre><code>` |
| raw HTML (inline or block) | dropped (`skipHtml: true`); no `rehype-raw` |

- **Title:** plain text of the first H1 (entities decoded, clamped to 512 characters, the title field limit); fallback is the file name without its extension (underscores become spaces). The H1 stays in the body, matching the seeded templates, which keep their H1 in the content.
- **`contentText`:** a plain-text projection of the HTML is sent; the server derives the stored text from the materialized document anyway.

## Limits

| Limit | Value | Source |
|---|---|---|
| Files per import | 20 | `MARKDOWN_IMPORT_MAX_FILES` |
| File size | 1 MiB | `MARKDOWN_IMPORT_MAX_FILE_BYTES` |
| Converted HTML | 2 MiB | `DOCUMENTS_MAX_CONTENT_HTML_BYTES` (server limit, checked before upload) |
| Accepted files | `.md`, `.markdown`, `.mdown`, `.mkd`, `.txt`, or `text/markdown`/`text/plain` without extension | `validateMarkdownImportFile` |

Selecting more than 20 files rejects the whole selection. Non-text MIME types, files containing NUL bytes and empty files are rejected per file with a reason.

## Security

- The client never trusts its own HTML: `PUT /api/documents/{id}/content` (`documents.content.replace` command) runs `materializeDocumentContentReplacement`, which parses the HTML with the editor's ProseMirror schema (`getDocumentEditorExtensions`) inside a script-disabled happy-dom window and re-serializes it. Only schema nodes, marks and attributes survive; `<script>`, event-handler attributes and unknown tags are discarded. The Tiptap Link extension also rejects disallowed URI schemes on parse.
- Raw HTML in Markdown is dropped before it reaches the server (defense in depth), and URLs go through `defaultUrlTransform`.
- Writes go through `apiCallOrThrow` wrapped in `useGuardedMutation(...).runMutation(...)` with `retryLastMutation` in the context; ACL, tenant scoping, body limits and mutation guards are the existing route checks (`documents.create` for create, `documents.edit` plus editor tier for content).
- If saving content fails after the document was created, the client deletes the empty document (best effort) and reports the file as failed.

## Tests

- Unit: `packages/documents/src/modules/documents/__tests__/markdownImport.test.ts` — heading levels, marks/links/quotes/code, GFM table, bullet/ordered/task lists, raw HTML and `javascript:` links stripped, server materialization keeps headings/table/task items, title from first H1 and filename fallback, title clamp, file type/size/empty validation, converted-HTML limit. The package Jest config transforms the ESM-only unified/micromark dependency tree for these tests.
- Integration: `packages/documents/src/modules/documents/__integration__/TC-DOCUMENTS-MD-001.spec.ts` — writes a `.md` fixture to a temp dir, imports it through the real file chooser on `/backend/documents`, asserts the opened document renders H1/H2/bold/table, drops the raw `<script>`, lists both H2 sections in the outline, verifies title and stored HTML through the API, and deletes the document in `finally`.

## Risks & Impact Review

| Scenario | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Malicious Markdown (raw HTML, `javascript:` links) | High | `skipHtml`, `defaultUrlTransform`, server schema re-parse | Low |
| Content save fails after create, leaving an empty document | Low | best-effort DELETE and per-file error | Empty document remains if DELETE also fails (user lacks `documents.delete`) |
| User has `documents.create` but not `documents.edit` | Low | per-file error and cleanup | Button is visible but the import fails for that user |
| Large selections stall the page | Low | 20-file / 1 MiB caps, sequential processing, disabled button | Low |
| Markdown constructs the editor does not support (footnotes, HTML) | Low | dropped or flattened to text by the schema | Some formatting lost |

## Final Compliance Report

No contract-surface changes; i18n in all five locales; DS tokens only (shared `Button`, lucide icon, no custom colors); writes wrapped in `useGuardedMutation`; integration test is self-contained with API cleanup.

## Migration & Backward Compatibility

Additive only. `DocumentsTable` gains two required props (`onImportMarkdown`, `markdownImportProgress`); the component is internal to the documents list page and not an exported contract surface. No API, schema, event, ACL or generated-file changes.

## Changelog

- 2026-11-12 — Initial spec and implementation.
