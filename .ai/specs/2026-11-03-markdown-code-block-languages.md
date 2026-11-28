# Configurable Markdown code-block languages

## TLDR

Module and app customizers need to add, hide, or rename language options in the shared Markdown editor. This proposes an optional language-map patch on `MarkdownField`, exposed through the existing UMES component props-transform mechanism. The existing list and stored Markdown remain unchanged when no customization is supplied.

## Overview and Problem Statement

[#8258](https://github.com/open-mercato/open-mercato/issues/8258) reports that teams using Rust or PHP must use source mode to tag new blocks. `MdxEditorImpl.tsx` owns a private language map. The dropdown shipped in #8274; the existing Markdown migration spec covers editing but not language customization. All consumers of `MarkdownField`, including catalog descriptions and CrudForm Markdown fields, should share the extension.

## Resolved assumptions (autonomous defaults)

| Question | Decision | Reason |
| --- | --- | --- |
| Extension mechanism? | Add an optional prop and expose MarkdownField through existing UMES component overrides. | Reuses `widgets/components.ts`, app overrides, ordering and feature filtering; avoids new registry/bootstrap conventions. |
| Removing a language with existing content? | Hide it for new selections; preserve the current block's tag and content. | Removing configuration must not destroy data. |
| Plain text? | Always retain the empty-tag option; allow its label to be renamed. | It is the editor's fallback for untagged and unknown blocks. |
| Syntax support? | Reuse MDXEditor's existing automatic loading. | The feature changes choices, not parsers or dependencies. |
| Include #8257 normalization? | No. | Independent issue; no value/onChange semantic change. |

## Proposed Solution

Add `codeBlockLanguages?: MarkdownCodeBlockLanguages` to `MarkdownFieldProps`. A patch maps the exact stored Markdown language tag to a string label, `{ label: string, labelKey?: string }`, or `null`. A string/object adds or renames a choice. `null` hides it. Unmentioned defaults retain their order; additions follow them. The empty key is always present and ignores null removal. Object labels resolve `labelKey` with `useT`, falling back to `label`.

Expose the stable handle `section:ui.inputs.MarkdownField` through `useRegisteredComponent` at the canonical MarkdownField entry point, with a `data-component-handle` host. Module authors use a `propsTransform` in `widgets/components.ts`; app authors can use `modules.ts` widget component overrides. Overrides compose through the existing priority/feature system; transforms should merge the incoming patch to preserve earlier contributions. Direct custom screens can pass the prop.

A small pure helper under `packages/ui/src/backend/markdown/` owns default merging and translation. It does not import MDXEditor or read browser/global state. No mutable global language registry is introduced. Unknown tags remain visible on their existing blocks through MDXEditor's existing select fallback.

### Research and alternatives

Existing `DetailFieldsSection` hosts use `useRegisteredComponent(handle, fallback)`, and `packages/core/AGENTS.md` recommends props transforms for component customization. Existing registries such as `registerAdditionalIcons` demonstrate configuration precedent but would require separate ordering and lifecycle semantics here. A new module override domain or injection widget family is unnecessary.

[MDXEditor codeMirrorPlugin](https://mdxeditor.dev/editor/api/functions/codeMirrorPlugin) accepts a key-to-label language map. The installed 4.0.4 implementation updates that map and appends an unknown current tag to that block's dropdown without modifying its Markdown. Reusing this behavior avoids another Markdown parser.

## Architecture and Frontend Contract

| Surface | Boundary / owner | Change |
| --- | --- | --- |
| Catalog, CrudForm, notes/messages callers | Existing page/form boundaries | No caller changes; canonical MarkdownField hosts overrides. |
| `MarkdownField.tsx` | Existing client island | Adds stable UMES host; retains `next/dynamic(..., { ssr: false })`. |
| `MdxEditorImpl.tsx` | Existing client island; Lexical requires DOM | Resolves language patch for CodeMirror; keeps controlled-value behavior. |
| Language helper | Pure TypeScript | Local merge/translation only, no side effects. |

No new page root, global provider, bootstrap domain, network request, or heavy dependency. Existing `ComponentOverrideProvider` supplies overrides. Both client files stay below 300 LOC; MDXEditor stays lazily loaded. Static import review plus focused component tests verify isolation; package build and browser hydration provide runtime evidence where the environment permits.

## Data Models and API Contracts

No database, HTTP API, command, event, permissions, or persisted settings change. Stored descriptions remain Markdown strings and existing mutation guards/optimistic locking stay at their existing forms. Only the optional component prop, exported language type/helper and component handle are new public contracts. Labels render as text, not HTML. Configuration comes from trusted application/module code.

## UI/UX and Acceptance Criteria

1. Without a patch, Plain text and the current 13 languages keep their names and order.
2. A module props transform can add Rust/PHP, rename JavaScript, and hide SQL across existing MarkdownField consumers without replacing the editor.
3. An app override or direct prop can apply the same patch.
4. Existing unknown/hidden tags and content remain editable, including blocks with metadata; selecting a new language updates the tag through the editor's existing behavior.
5. Plain text remains available; a configured translation key follows the active locale.
6. Prop changes update choices without remounting the editor or resetting unsaved content. Keyboard and dialog behavior remain delegated to existing components.
7. No new visual component, status token, dialog, or layout styling is introduced.

## Migration & Backward Compatibility

This is additive under BACKWARD_COMPATIBILITY.md categories 2–5. Existing MarkdownField imports and `value`/`onChange` props remain valid; the default export remains canonical. Existing language keys, labels, insertion order and Markdown behavior remain the baseline. `section:ui.inputs.MarkdownField` is a new stable handle, not a rename. No migrations, UPGRADE_NOTES deprecation, or production dependencies are needed. Rollback removes configuration; existing custom tags remain ordinary Markdown.

## Edge Cases and Risks & Impact Review

| Scenario | Severity / impact | Mitigation | Residual risk |
| --- | --- | --- | --- |
| A removed language is already used | High, potential data loss | Do not rewrite content; MDXEditor retains current tag and fallback editor. | Covered by real-editor integration test. |
| Override arrives after typing | High, unsaved state loss | Stable host/fallback; update plugin parameters without a key/remount. | Integration and component lifecycle tests. |
| Competing module patches | Medium, unexpected label | Existing override priority; document merge of incoming prop. | App author controls precedence. |
| Empty option removed | Medium, untagged blocks | Ignore null removal of empty key. | Intentional documented restriction. |
| Unsupported syntax highlighter | Low, no coloring | MDXEditor fallback stays editable; no custom loaders. | Language selection does not promise highlighting. |
| Two tags share a label | Low, MDXEditor aliases labels | Document upstream alias behavior; recommend distinct labels for distinct stored tags. | Existing upstream behavior retained. |

## Testing and Integration Coverage

- Unit helper tests: exact defaults, add/rename/hide, plain-text invariant, translations, no input mutation, inherited keys ignored.
- Component tests: real MarkdownField host + existing component registry/provider apply module-style props transforms; patch updates preserve mounted editor state; MdxEditorImpl passes resolved options and leaves value/change handling intact.
- New unique catalog test `TC-CAT-8258-markdown-language-options.spec.ts`: self-contained product API fixture; real product Markdown editor renders default options, preserves unknown tags (including metadata), changes a tag and saves/reloads it; cleanup in `finally`. No changed API paths, so existing POST/GET/PUT/DELETE product routes are fixture/persistence checks only.
- The catalog test installs a props transform into the existing UMES browser registry while the product is in plain-text mode, then mounts MarkdownField using the existing Use Markdown toggle. It verifies add/rename/hide and persistence through the real editor. This tests runtime configuration, not generator discovery, and adds no production test hook.
- Run configured validation.commands in order with recorded runner, plus targeted editor suites. If Docker/app prerequisites prevent integration/UI execution, disclose exact blocker and leave PR draft with needs-qa; never claim screenshots or passing coverage that did not run.

## Phasing and Implementation Plan

### Phase 1: Add the customization surface

1.1 Add the pure language patch helper/type and tests; keep defaults exact.
1.2 Wire the optional prop and stable UMES MarkdownField host; add component and lifecycle coverage.

### Phase 2: Prove and document behavior

2.1 Add the unique catalog integration test and developer usage documentation.
2.2 Run focused/full validation, independent code review and UI evidence; publish reviewed implementation PR referencing this design PR and #8258.

## Final Compliance Report — 2026-11-03

| Rule source | Result |
| --- | --- |
| Root, UI, UI backend, core component-replacement guidance | Existing canonical MarkdownField and UMES mechanisms; additive public surface only. |
| BACKWARD_COMPATIBILITY.md | Defaults/imports/value semantics preserved; migration section included. |
| .ai/qa/AGENTS.md | New module-local integration filename, self-created fixture and cleanup. |
| Design system and frontend contract | Existing UI retained; no new tokens/dependencies/global providers; lazy boundary retained. |
| Tenant isolation, ORM, encryption, commands/cache | No data access or persistence changes; not applicable. |

Security: configuration-only text labels; no new sensitive data or permissions. Performance: bounded small option-map merge, no network or new heavy import. Cache/commands: not applicable. Implementation verification remains pending; design does not assert runtime success.

## Changelog

- 2026-11-03: Drafted autonomous defaults for #8258 and defined additive UMES language customization with unchanged defaults.

### Review — 2026-11-03
- Reviewer: independent fresh-context agent.
- Scope cohesion: approved; one independently deployable capability.
- Security/performance/risks: no architectural or testability blockers identified from the spec text.
- Cache/commands: not applicable.
- Verdict: approved for implementation; runtime verification remains required.
