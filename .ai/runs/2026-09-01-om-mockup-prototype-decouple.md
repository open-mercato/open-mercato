# Run: om-mockup-prototype-decouple

Source doc: `.ai/specs/2026-08-26-interactive-prototype-skill.md` in open-mercato/skills (merged via open-mercato/skills#91); this run executes its **Phase 1 — Decouple upstream** (steps 1–7). Tracking issue for the downstream import: open-mercato/skills#104.

## Goal

Decouple `.ai/skills/om-mockup-prototype` from this repository's design-system internals so the skill can later be imported into the shared skills collection: token values come from the committed snapshot `.ai/ds/ds-tokens.json` instead of parsing `apps/mercato/src/app/globals.css`, the repository root is resolved through git, the bundled stylesheets carry neutral fallbacks, branding sits behind a `theme.css` seam, fidelity claims are removed, and assets move under `references/assets/`.

## Scope

- `.ai/skills/om-mockup-prototype/**` (scripts, assets, SKILL.md, references)
- `scripts/__tests__/om-mockup-prototype.test.mjs` (existing test, updated + extended)

Non-goals: no changes to `.ai/ds/**`, `globals.css`, or any design-system governance file (CODEOWNERS-restricted); no changes to `references/screen-patterns.md` beyond what step 5 requires (it stays this repo's legitimate anatomy reference); no Phase 2/3 work (skills-collection import, composer routing).

## Implementation Plan

### Phase 1: Token pipeline (spec steps 1–2)

1.1 Rewrite `scripts/sync-tokens.mjs` to build `tokens.css` from the token snapshot: drop the block reader, declaration parser, group assertions, ≥40-tokens-in-dark threshold, and required-name checks. Snapshot resolution order: `<repo>/.ai/ds/ds-tokens.json`, else the copy bundled with the skill; the generated header states which source was used.
1.2 Resolve the repository root through `git rev-parse --show-toplevel` from the working directory, with a stated fallback to the working directory itself; share the resolver between `sync-tokens.mjs` and `init-mockup.mjs`.
1.3 Prove equivalence and update tests: the snapshot-generated declarations match the globals-parsed output of the old script (per-block name→value equality); `--check` on an existing prototype reports no drift (declaration-level, order-insensitive comparison).

### Phase 2: Styling seams (spec steps 3–5)

2.1 Add neutral fallbacks to every bundled `var()` reference without one (~64 names across `components.css`, `screens.css`, `prototype.css`) so a repository without those tokens still renders; the resolution check stays silent because fallbacks are exempt.
2.2 Scaffold `theme.css` (eight identity tokens: primary + hover + foreground, two brand accents, radius, two font stacks; semantic contract stated in the header) and wire it into the load order after `tokens.css`.
2.3 Replace fidelity claims in the stylesheet headers, the generated page, and the generated README: no comment asserts correspondence to a named component file; update SKILL.md's token-source wording.

### Phase 3: Layout and portability (spec steps 6–7)

3.1 Move `assets/` under `references/assets/` and update the path constant; a fresh run produces an identical prototype apart from the deliberately changed files.
3.2 Prove portability: in a temporary git checkout without this application, initialization produces a prototype that renders in both themes and states its token source (bundled snapshot fallback).

## Risks

- The snapshot canonicalizes ordering (sorted keys), so regenerated `tokens.css` reorders declarations relative to the old authoring-order output; mitigated by an order-insensitive `--check` and a declaration-level equivalence test against the old parser's output.
- The neutral fallback values are a second place design defaults live and can drift from the snapshot; they are deliberately neutral so drift is invisible when a real token source is present (accepted in the spec).
- The full validation gate builds the whole monorepo for a `.ai/skills`-scoped change; long but unavoidable per config.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Token pipeline

- [x] 1.1 Snapshot-based sync-tokens.mjs with source fallback — 6e317e1e3
- [x] 1.2 Git-based repository root resolution with stated fallback — 6e317e1e3
- [x] 1.3 Equivalence proof and test updates — 6e317e1e3

### Phase 2: Styling seams

- [x] 2.1 Neutral fallbacks for bundled CSS variables — 300b94582
- [x] 2.2 theme.css scaffold wired into the load order — 300b94582
- [x] 2.3 Fidelity claims replaced — 300b94582

### Phase 3: Layout and portability

- [x] 3.1 Assets moved under references/assets/ — 6a433a967
- [x] 3.2 Portability proof in a bare checkout — see PR evidence comment
