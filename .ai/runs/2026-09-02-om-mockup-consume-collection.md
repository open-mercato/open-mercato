# Run: om-mockup-consume-collection

Source doc: `.ai/specs/2026-08-26-interactive-prototype-skill.md` in the shared skills collection (its #91); this run executes **Phase 3 — Consume from here** (spec step 15). Stacked on `feat/om-mockup-prototype-decouple` (Phase 1, PR #5832): do not merge before it; retarget to the base branch once it lands. The collection import PR (skills#106) ships the version consumed here.

## Goal

Replace this repository's local copy of `om-mockup-prototype` with the collection version, keeping the product-specific screen anatomy as the in-place repo-local override and restating the surface-based routing rule verbatim in a marked repo-local section, so a prototype generated through the installed skill and override is equivalent to one generated before the change.

## Scope

- `.ai/skills/om-mockup-prototype/**` only.

Non-goals: no changes to scripts/__tests__ semantics (the suite must pass unchanged); no changes to `.ai/ds/**`; no changes in the collection repo.

## Implementation Plan

### Phase 1: Replace the local copy

1.1 Overwrite the skill directory with the collection version (skills#106 branch), except `references/screen-patterns.md`, which keeps this repository's product-specific anatomy — in the monorepo the skill's own path IS the repo-local override path, so the file in place is the override and the scaffolding never fires.

### Phase 2: Repo-local routing and equivalence

2.1 Append a marked repo-local section to SKILL.md restating the surface rule verbatim: this skill covers backend/backoffice journeys; ordinary DS-composition requests route to `om-ds-mockup`; portal, storefront, and public frontend work routes to its surface-specific guidance.
2.2 Prove equivalence: a prototype generated after the change is byte-identical to the pre-change baseline; `scripts/__tests__/om-mockup-prototype.test.mjs` passes unchanged.

## Risks

- Stacked base: any review change on #5832 rebases this branch; any change on skills#106 re-imports here. Both recorded with source SHAs.
- The collection SKILL.md frontmatter description is the question-based one; the surface rule lives in the repo-local section, not the description. If in-repo routing relies on the description alone, the router sees the generic wording — flagged in the PR for the design-system track owner.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Replace the local copy

- [ ] 1.1 Skill directory replaced with the collection version, anatomy kept

### Phase 2: Repo-local routing and equivalence

- [ ] 2.1 Repo-local surface-routing section
- [ ] 2.2 Equivalence proof and test suite
