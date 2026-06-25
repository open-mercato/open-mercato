# Markdown editor: revert DS-v3 HTML fields to Markdown and adopt MDXEditor

- **Status:** Implemented
- **Issue:** [#2653](https://github.com/open-mercato/open-mercato/issues/2653) — "bug: list of the team members (staff) - strip html - more broad issue with markdown vs html"
- **Date:** 2026-06-06
- **Scope:** OSS — shared UI (`@open-mercato/ui`) + core modules (staff, catalog, planner, resources) + create-app template

## Context / Problem

The DS Foundation v3 migration (commit `dc719cac8`, 2026-05-13) opted several rich-text
`description` fields into the HTML rich-text editor by adding `editor: 'html'` to their
`CrudForm` field config. Before that, staff descriptions used the Markdown editor (UIW —
`@uiw/react-md-editor`), which is what the rest of the app (catalog, CRM, …) uses.

Two defects followed (reported in #2653):

1. **Raw HTML leaked into list previews.** Staff list cells rendered the `description`
   either through a Markdown preview (`teams`, `team-roles`) or raw (`team-members`).
   Markdown does not interpret HTML tags, so values authored with the HTML editor
   (e.g. `<span style="font-weight:bold">Backend</span>`) showed literal tags in lists.
2. **Editor inconsistency.** Only ~7 fields used the HTML editor; everything else used
   Markdown. The maintainers (@pkarw, @pat-lewczuk) asked to **restore Markdown** (it is the
   preferred, LLM-friendly source format) and, while at it, to evaluate a **better Markdown
   editor** than the old split-pane UIW.

@pat-lewczuk approved replacing UIW with **MDXEditor** (Lexical-based WYSIWYG, Markdown as the
source of truth, MIT licensed).

## Decision

1. **Revert all `editor: 'html'` richtext fields back to Markdown** (`editor: 'uiw'`): staff
   `TeamForm`, `TeamRoleForm`, `TeamMemberForm`, staff profile create; `planner`
   `AvailabilityRuleSetForm`; `resources` `ResourceCrudForm`, `ResourceTypeCrudForm`.
2. **Replace the UIW Markdown editor with MDXEditor** behind a single canonical component,
   `MarkdownField`, used by `CrudForm` (full create/edit forms). Markdown stays the stored
   format; MDXEditor renders it WYSIWYG with a Markdown/diff/source toggle. **Inline click-to-edit
   fields (`InlineMultilineEditor`) keep a lightweight DS `Textarea` (raw Markdown)** instead of
   the full editor — a toolbar is overkill for a single in-place field, and the plain `<textarea>`
   preserves reliable `Ctrl+Enter` save; display still renders via `MarkdownPreview`.
3. **Theme MDXEditor with DS tokens** so it matches DS inputs in light and dark mode (chrome
   `--base*`/`--accent*` scale, toolbar divider, content typography, CodeMirror source view,
   text contrast).
4. **Keep list previews plain-text via `markdownToPlainText`**, which strips Markdown syntax
   **and** legacy HTML tags and decodes entities — so lists are clean for both new Markdown rows
   and pre-existing HTML rows. **No data migration is required.**

### Why not keep / restyle UIW

UIW is a split-pane source+preview editor; its appearance is inseparable from its editing model,
so it cannot be made to look like a modern WYSIWYG without losing functionality. MDXEditor is
MIT, React-native, emits clean Markdown, and was the maintainer's chosen target.

### Why MDXEditor over Milkdown

Both are MIT and markdown-native. MDXEditor was selected for the fastest path to a WYSIWYG that
the maintainers liked; Milkdown remains a viable future option if deeper DS theming control is
needed.

## Scope (files)

**New (`@open-mercato/ui`):**
- `src/backend/inputs/MarkdownField.tsx` — canonical Markdown editor: `dynamic(() => MdxEditorImpl, { ssr:false })` with a jsdom test stub (textarea) so unit tests do not load MDXEditor's ESM/CSS.
- `src/backend/inputs/MdxEditorImpl.tsx` — MDXEditor wrapper: controlled `value`/`onChange` (buffered, commit on blur), DS-styled toolbar (`UndoRedo`, BIU, code, strike/sub/sup, lists, block-type, link, image, table, thematic break, `DiffSourceToggleWrapper`), dark via `dark-theme` class. Side-effect-imports `@mdxeditor/editor/style.css` (the package only exports its CSS under the JS import condition, not the CSS `style` condition, so a `globals.css` `@import` cannot resolve it).
- `src/types/css.d.ts` — ambient `declare module '*.css'` for that stylesheet import. A `/// <reference>` to it from `MdxEditorImpl.tsx` makes the ambient travel into every package that type-checks `@open-mercato/ui` source (scheduler, webhooks, checkout, ai-assistant, …), so the cross-package typecheck resolves the import (otherwise TS2882).

**Editor swap:**
- `src/backend/CrudForm.tsx` — Markdown field renders `MarkdownField`; UIW editor + `remark-gfm` preview plumbing removed.
- `core/.../catalog/products/create/page.tsx`, `core/.../catalog/products/[id]/page.tsx` — UIW `MarkdownEditor` → `MarkdownField`.
- `src/backend/inputs/SwitchableMarkdownInput.tsx` — UIW → `MarkdownField`.
- `src/backend/detail/InlineEditors.tsx` (`InlineMultilineEditor`) — UIW → lightweight DS `Textarea` (raw Markdown source; display still renders via `MarkdownPreview`). Inline quick-edit deliberately does **not** use the full MDXEditor toolbar.

**Field reverts (`editor: 'html'` → `editor: 'uiw'`):** staff `TeamForm`, `TeamRoleForm`,
`TeamMemberForm`, `backend/staff/profile/create/page.tsx`; planner `AvailabilityRuleSetForm`;
resources `ResourceCrudForm`, `ResourceTypeCrudForm`.

**List previews:** `staff/backend/staff/{team-members,teams,team-roles}/page.tsx` use
`markdownToPlainText`; helper at `src/backend/markdown/markdownToPlainText.ts` (strips Markdown +
legacy HTML, decodes entities).

**Styling:** `apps/mercato/src/app/globals.css` + `packages/create-app/template/src/app/globals.css`
— the MDXEditor DS theming block (`.om-mdx-editor` / `.om-mdx-prose` / `.cm-*`). The editor's base
stylesheet is imported by the component (see above), not globally.

**Dependencies:** add `@mdxeditor/editor` to `@open-mercato/ui`; remove `@uiw/react-md-editor`
from the workspace (root + app). `@uiw/react-markdown-preview` is **retained** — it backs the
read-only `MarkdownPreview` renderer, which is unrelated to the editor.

## Backward Compatibility & Migration

- **Contract surfaces:** No public API, import path, event ID, DI key, ACL feature, or DB schema
  changes. `CrudForm`'s `editor` field option is unchanged (`'simple' | 'uiw' | 'html'`);
  `'uiw'` and the default now render MDXEditor. No third-party import path is removed
  (`MarkdownField`/`MdxEditorImpl` are additive; consumers use `CrudForm`/`editor` as before).
- **Data:** stored values remain Markdown strings. Records authored with the HTML editor between
  2026-05-13 and this change keep their HTML in storage; MDXEditor tolerates inline HTML when
  editing, and `markdownToPlainText` strips it in list previews — so **no backfill is needed**.
- **Dependency removal:** `@uiw/react-md-editor` had no third-party-facing export from our
  packages; it was an internal editor implementation detail, so removing it is not a breaking
  change for downstream modules.

## Testing / Integration Coverage

- **Unit (existing, updated):** `CrudForm.*` suites, `CustomDataSection`, `lazy-heavy-libraries`,
  customers `InlineEditors` test, and `markdownToPlainText` test — all updated to the
  `MarkdownField` test stub. `yarn workspace @open-mercato/ui test` (1503) and
  `yarn workspace @open-mercato/core test` (5494) pass; `typecheck` (ui + core) green.
- **Manual verification:** Markdown editing + WYSIWYG rendering (headings, bold/italic/underline,
  strike, inline code, lists incl. task lists, blockquote, table, thematic break, link),
  light + dark mode (toolbar, block-type select open/closed, tooltips, CodeMirror source view,
  text contrast), and clean list previews for both Markdown and legacy-HTML rows.
- **Integration:** full `yarn test:integration:ephemeral` — 1471 passed. The only regression from
  this change, `TC-LOCK-OSS-024` (sales quote inline comment edit; it filled the old UIW
  `<textarea>`), was resolved by the inline-editor `Textarea` decision and re-verified green
  (6/6). Unrelated/pre-existing reds: `TC-SEARCH-002` (CRM fixture seeding, already red on develop)
  and `TC-CRM-013` (flaky dropdown-menu timeout, passed on retry).

## Changelog

- 2026-06-06: Implemented. Reverted 7 DS-v3 HTML fields to Markdown; replaced UIW with MDXEditor
  behind `MarkdownField`; DS-themed MDXEditor (light/dark, source view, contrast); list previews
  via `markdownToPlainText` (no data migration); removed `@uiw/react-md-editor`.
