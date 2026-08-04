# Structured Agent Lessons

Source doc: `.ai/specs/2026-07-24-standalone-ai-development-harness.md`

## Goal

Replace the oversized monolithic lessons document with a context-efficient catalog of individually loadable lessons, tagged by module, standalone-harness area, and important concepts, while keeping monorepo and generated standalone harness behavior aligned.

## Scope

- Preserve every existing monorepo lesson as an individually linked Markdown record under `.ai/lessons/`.
- Keep `.ai/lessons.md` as the compact entry point and searchable catalog.
- Align lesson `areas` with the standalone harness router vocabulary and use module IDs where a lesson targets a module.
- Teach monorepo and standalone agents to read only matching lessons and to add/update one focused lesson file.
- Extend create-app and CLI harness ownership rules so the lesson index and lesson records remain user-editable on harness refresh.
- Add regression coverage for catalog integrity, metadata, instruction routing, recursive emission, and ownership parity.

## Non-goals

- Rewording or changing the technical meaning of existing lessons.
- Adding new runtime behavior, database schema, public APIs, or product UI.
- Reclassifying the standalone evaluation catalog or running the full live multi-runner harness release suite for this documentation/generator-ownership change.
- Rewriting historical specification references that cite `.ai/lessons.md`; the catalog remains the stable compatibility entry point.

## Implementation Plan

### Phase 1: Catalog and migration

1. Split every existing lesson into a stable slugged file with module, area, and concept tags; replace `.ai/lessons.md` with a linked catalog and authoring contract.
2. Add deterministic repository checks that reject missing metadata, invalid harness areas, broken links, duplicate slugs, or orphan lesson records.

### Phase 2: Harness integration

1. Update monorepo and standalone agent instructions plus the two harness-evolution skills to route through the tagged catalog and write one focused lesson record.
2. Update standalone lesson templates and both harness ownership-manifest producers so nested lesson files are emitted and preserved as user-editable, with parity tests.
3. Update the standalone harness design documentation and run the scoped and configured validation gates.

## Risks

- Existing prose links and line-number citations could become stale. Mitigation: preserve `.ai/lessons.md` as the stable entry point, keep every original title in its catalog link, and avoid rewriting historical specs.
- Automatic classification could make a lesson hard to find. Mitigation: use the router's exact area vocabulary, explicit module IDs, concept tags, and a validation test that keeps metadata present and searchable.
- Harness refresh could overwrite app-authored lessons. Mitigation: mark both `.ai/lessons.md` and every `.ai/lessons/*.md` record as user-editable in create-app and CLI manifests, with recursive-emission assertions.

## Progress

PR: #4884

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Catalog and migration

- [x] 1.1 Split every existing lesson into a stable slugged file with module, area, and concept tags; replace `.ai/lessons.md` with a linked catalog and authoring contract. — 95a2d115d
- [x] 1.2 Add deterministic repository checks that reject missing metadata, invalid harness areas, broken links, duplicate slugs, or orphan lesson records. — 95a2d115d

### Phase 2: Harness integration

- [x] 2.1 Update monorepo and standalone agent instructions plus the two harness-evolution skills to route through the tagged catalog and write one focused lesson record. — f969b82eb
- [x] 2.2 Update standalone lesson templates and both harness ownership-manifest producers so nested lesson files are emitted and preserved as user-editable, with parity tests. — f969b82eb
- [x] 2.3 Update the standalone harness design documentation and run the scoped and configured validation gates. — f969b82eb, 3200169c5, 6b0534ac4
