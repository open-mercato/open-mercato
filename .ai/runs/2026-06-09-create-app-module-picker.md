# Execution Plan — create-app per-module picker + official-modules selection

## Goal

Author a specification (`.ai/specs/2026-06-09-create-app-module-picker.md`) that extends
`create-mercato-app` so that, after choosing a starter preset (classic / empty / crm), the user can
select **individual modules** to enable, with their `requires` dependencies auto-included, and can
optionally pull in **official modules** from `open-mercato/official-modules` — reusing the existing
`yarn official-modules` CLI machinery, which the spec also ships into the scaffolded app template.

This run is **docs-only**: the deliverable is the spec file plus this plan. No product code changes.

## Scope

- New spec under `.ai/specs/` following the date+slug convention.
- The spec must cover: catalog model, per-module picker UX, dependency auto-resolution, official-modules
  integration shipped into the template, phasing, integration/test coverage, BC analysis.

## Non-goals

- Implementing the feature (no changes to `packages/create-app/**`).
- Changing the monorepo-root `official-modules` CLI behavior.
- Designing a backend/admin UI (this is a CLI scaffolder feature).

## Decisions (confirmed with maintainer 2026-06-09)

1. **Official-modules reach:** Ship the full `official-modules` tooling (CLI scripts + `official-modules.json`
   + postinstall worker) into the create-app template, so scaffolded apps can keep running
   `yarn official-modules add <x>` after creation. Scaffolder pre-seeds the activated set.
2. **Catalog source:** Live remote fetch of the module catalog at scaffold time (core + official),
   with a documented graceful offline fallback (preset-only + free-text entry).
3. **Dependency UX:** Auto-include transitive `requires` and print a one-line notice; rely on the
   existing generate-time validation (`module-registry.ts`) as the backstop.

## External References

- https://github.com/open-mercato/official-modules — the official-modules repo the scaffolder fetches
  the official catalog from and that the in-app `yarn official-modules` CLI clones as a submodule.
  Adopted: existing CLI + config + generated-registry contract. Rejected: nothing (no instructions to
  bypass project rules).

## Risks (brief)

- Live remote fetch introduces a network dependency in the scaffolder hot path — spec must define
  timeout, caching, and offline fallback so `create-mercato-app` never hard-fails without network.
- Reading `requires` at scaffold time (pre-install) requires the catalog to carry the dependency graph;
  the spec must define how that graph is produced and kept accurate.
- Template surface grows (new scripts + config); BC and template-sync rules in
  `packages/create-app/AGENTS.md` must be honored.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Plan & scaffold

- [x] 1.1 Commit execution plan on feature branch — (plan commit)

### Phase 2: Author the specification

- [x] 2.1 Write spec skeleton (TLDR, problem, decisions, architecture overview)
- [x] 2.2 Write catalog model + live-fetch/offline-fallback design
- [x] 2.3 Write per-module picker UX + dependency auto-resolution design
- [x] 2.4 Write official-modules-in-template design (tooling ship + activation seeding)
- [x] 2.5 Write phasing, integration/test coverage, BC analysis, changelog

### Phase 3: Validate & ship

- [x] 3.1 Docs gate: re-read diff, naming-convention check, link sanity
- [ ] 3.2 Open PR against develop with labels, run auto-review, post summary
