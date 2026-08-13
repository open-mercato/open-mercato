# Execution Plan: docs-copy-page

## Goal

Add a "Copy page as Markdown" button to every MDX documentation page in `apps/docs/` (Docusaurus v3), so users can one-click copy the full page content as clean Markdown for pasting into AI tools.

## Scope

- Publish raw `.md`/`.mdx` source at `/raw/<path>` during development and production builds
- Swizzle `DocItem/Content` so the copy control renders on every doc page independently of TOC availability
- Create a `CopyPageButton` component that fetches the raw source and copies it to the clipboard
- Add CSS styling consistent with the existing docs theme
- Show copied and failure feedback after clicking
- Verify every generated doc page includes the copy control

## Non-goals

- Landing page or non-doc pages
- DOM-to-Markdown conversion

## Implementation Plan

### Phase 1: Core implementation

1.1. Add the raw-MDX plugin and production source publishing
1.2. Create `CopyPageButton` with raw-source fetch, clipboard API, and error feedback
1.3. Swizzle `DocItem/Content` to inject the button unconditionally
1.4. Add CSS styling for the button

### Phase 2: Validation

2.1. Build the docs site and run the Node test suite
2.2. Assert every generated documentation page contains `data-copy-page-button`

## Risks

- Docusaurus internal component structure may change in future versions — mitigated by wrapping `DocItem/Content` and asserting the generated output
- The raw-source plugin and button URL derivation can drift — mitigated by production-build validation

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

> The four entries below that say `working tree` landed together in `782a872b7`.

### Phase 1: Core implementation

- [x] 1.1 Add raw-MDX plugin and production source publishing — 2b7e27ab4
- [x] 1.2 Create CopyPageButton with raw-source fetch, clipboard API, and error feedback — c64bff745
- [x] 1.3 Swizzle DocItem/Content to inject the button unconditionally — working tree
- [x] 1.4 Add CSS styling for the button — working tree

### Phase 2: Validation

- [x] 2.1 Build the docs site and run the Node test suite — working tree
- [x] 2.2 Assert every generated documentation page contains `data-copy-page-button` — working tree
