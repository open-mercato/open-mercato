# Execution Plan: docs-copy-page

## Goal

Add a "Copy page as Markdown" button to every MDX documentation page in `apps/docs/` (Docusaurus v3), so users can one-click copy the full page content as clean Markdown for pasting into AI tools.

## Scope

- Swizzle `DocItem/Layout` using the wrapping strategy for upgrade safety
- Create a `CopyPageButton` component with clipboard + DOM-to-Markdown conversion
- Add CSS styling consistent with the existing docs theme
- Visual feedback ("Copied!") after clicking

## Non-goals

- Landing page or non-doc pages
- Build-time MDX source access
- Server-side rendering of the copy content

## Implementation Plan

### Phase 1: Core implementation

1.1. Create `CopyPageButton` React component with DOM-to-Markdown conversion and clipboard API  
1.2. Swizzle `DocItem/Layout` (wrap) to inject the button  
1.3. Add CSS styling for the button  

### Phase 2: Validation

2.1. Run build validation to ensure the swizzle works correctly  

## Risks

- Docusaurus internal component structure may change in future versions — mitigated by using wrap strategy
- DOM-to-Markdown conversion quality depends on page structure — Docusaurus renders clean semantic HTML

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Core implementation

- [x] 1.1 Create CopyPageButton component — cb902d3e4
- [x] 1.2 Swizzle DocItem/Layout — cb902d3e4
- [x] 1.3 Add CSS styling — cb902d3e4

### Phase 2: Validation

- [x] 2.1 Run build validation — cb902d3e4
