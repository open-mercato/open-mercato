# Module Fact-Sheet Sectioned Reading Execution Plan

Source doc: .ai/specs/2026-08-13-module-fact-sheet-sectioned-reading.md

## Goal

Make generated module fact-sheets mechanically readable under agent read caps, then migrate the generated standalone knowledge layout from flat module files to per-module directories with an index and section files. Both phases are required for this run, overriding Phase 2's conditional trigger in the source spec.

## Scope

- Update the module-facts Markdown renderer and reference projection to emit deterministic contents metadata, truncation markers, compressed source labels, and bounded natural subsections.
- Change both package build pipelines and both standalone setup mirrors to generate, select, copy, own, and clean the directory-based module fact-sheet layout.
- Migrate harness contexts, evaluators, tests, guides, and compatibility documentation to the new layout.
- Add regression and integration coverage for deterministic rendering, directory emission, stale flat-file cleanup, and generated-app consumption.
- Run the configured validation gate and the required standalone harness checks.

## Non-goals

- Change the JSON fact sidecar contracts or fact extraction semantics.
- Change runtime module activation, discovery conventions, or application APIs.
- Modify unrelated local work, including `.ai/cezar/` in the primary worktree.
- Publish packages or apply database migrations.

## Implementation Plan

### Phase 1: In-file sectioned reading affordances

- Add a deterministic two-pass section model to the renderer so contents line anchors and approximate sizes are stable.
- Emit a terminal end-of-facts marker for package and local-reference projections.
- Compress source-link labels relative to each sheet's declared source root while preserving exact href targets.
- Split oversized natural groups into `###` subsections and surface their anchors in contents.
- Update renderer/build regression tests, byte expectations, and architecture guidance.
- Validate Phase 1 against focused CLI and create-app tests before continuing.

### Phase 2: Directory-based module fact sheets

- Add a reusable directory artifact model with `<id>/index.md` plus per-section Markdown files.
- Update the create-app and CLI build scripts to emit directory trees for installed and reference modules.
- Update setup selection, copying, ownership manifests, injected routing text, and stale flat-file cleanup in both mirrors.
- Rewrite harness paths and update evaluator, validator, guides, skills, tests, and upgrade documentation for the new generated-file contract.
- Run the standalone harness knowledge-change workflow, the complete configured validation gate, and the authoritative review/autofix pass.

## Risks

- The Phase 2 path change is a generated-file contract migration. The implementation must update every pinned consumer atomically and document cleanup in `UPGRADE_NOTES.md`.
- Relative source hrefs gain one directory level in section files; tests must verify that every rendered source link still resolves to the exact source target.
- Stale flat files can shadow current facts unless both setup mirrors delete owned legacy paths during updates.
- Harness path rewriting is broad and mechanical; focused tests and repository-wide searches must prove that no live flat-path consumer remains.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: In-file sectioned reading affordances

- [x] 1.1 Add the deterministic section model and Contents index — 506f7a69d
- [x] 1.2 Add the terminal marker and source-label compression — 506f7a69d
- [x] 1.3 Add natural sub-anchors for oversized sections — 506f7a69d
- [x] 1.4 Update renderer and build regression coverage — 506f7a69d
- [x] 1.5 Update sectioned-reading guidance — 506f7a69d
- [x] 1.6 Run focused Phase 1 validation — 506f7a69d

### Phase 2: Directory-based module fact sheets

- [x] 2.1 Add directory artifact generation for installed and reference modules — 3f80ae4d8
- [x] 2.2 Migrate both build pipelines to the split layout — 3f80ae4d8
- [x] 2.3 Migrate setup selection, copying, ownership, routing, and stale cleanup — 3f80ae4d8
- [x] 2.4 Rewrite harness consumers and update tests, guides, and upgrade notes — 3f80ae4d8
- [ ] 2.5 Complete harness refresh, full validation, and review readiness
