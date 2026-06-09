# Execution plan: bump dompurify 3.3.3/3.4.2 → 3.4.8 (migrate #2864 to develop)

## Goal

Migrate Dependabot PR #2864 (`build(deps): bump dompurify from 3.3.3 to 3.4.8`,
opened against `main`) onto `develop`, and close the original PR. The change is a
lockfile-only transitive dependency bump; `develop` carries the identical
pre-bump state, so the bump applies cleanly.

## Scope

- `yarn.lock` only: consolidate the two `dompurify` ranges (`^3.2.5` → 3.3.3 and
  `^3.3.1` → 3.4.2, both pulled transitively by `mermaid`) into a single
  `^3.2.5, ^3.3.1` → 3.4.8 entry, matching #2864.
- Close Dependabot PR #2864 with a comment pointing at the develop-targeted PR.

### Non-goals

- No `package.json` changes (dompurify is transitive only, via `mermaid`; the
  `^3.2.5` / `^3.3.1` constraints already permit 3.4.8).
- No application code changes. dompurify is a docs/mermaid transitive dep.
- No bump of any other dependency.

## Risks

- DOMPurify is an HTML sanitizer; a major-version behavior change could affect
  rendered output. This is a patch/minor bump (3.x → 3.4.8) used only
  transitively by `mermaid` in docs rendering; risk is minimal.
- Lockfile drift: mitigated by running Yarn to regenerate/validate the lockfile
  rather than hand-merging hunks blindly.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Apply the bump

- [x] 1.1 Update `yarn.lock` so dompurify resolves to 3.4.8 (single consolidated entry) — 1ef49d88c
- [x] 1.2 Validate lockfile consistency with Yarn — 1ef49d88c (yarn install --mode=update-lockfile: resolution clean, no dompurify drift)

### Phase 2: Ship

- [ ] 2.1 Open PR against `develop` with normalized labels
- [ ] 2.2 Close original Dependabot PR #2864 with a migration note
