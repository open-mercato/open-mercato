# Port Dependabot PRs #3695/#3696/#3699/#3708 to develop (single PR)

## Goal

Combine four Dependabot PRs that target `main` into a single PR against `develop`:

- **#3695** — `actions/cache` v5 → v6 (`.github/workflows/ci.yml`)
- **#3708** — `mermaid` 11.15 → 11.16 (subset of #3696)
- **#3696** — minor-and-patch group (47 updates)
- **#3699** — major group (9 updates): `ai` v6→v7, `@ai-sdk/openai/anthropic/google/cohere/mistral` v3→v4, `@ai-sdk/amazon-bedrock` v4→v5, `ai-sdk-ollama` 3→4, `@types/node` 25→26

## Scope / key facts

`develop` has diverged from `main` and already absorbed an equivalent minor/patch batch, so most of #3696 is a no-op. The **max(develop, target)** rule applies — never downgrade.

**Deliberate exclusions:**
- `eslint` — develop is on `^9.39.4` (v9); Dependabot's `^10.6.0` bump (baselined on main's v10) must NOT be applied — it would be an unwanted major upgrade develop intentionally avoided.
- `@types/node` — develop already at `^26.0.0`; only the trailing `.1` patch remains (the 25→26 major is already done on develop).

**Real work:** residual minor/patch bumps + mermaid + ci.yml + the **AI-SDK v6→v7 migration** (16 files import `ai`/`@ai-sdk/*`).

## Non-goals

- No feature/behaviour changes beyond what the SDK migration forces.
- No eslint major upgrade.
- No touching official-modules submodule or generated registries.

## Risks

- AI-SDK v7 / provider v4-v5 are major bumps with potential breaking API changes (`generateText`, `generateObject`, `embed`, `streamText`, `tool`, `UIMessage`, `dynamicTool`, `StopCondition`, `PrepareStepResult`, `ToolSet`, `EmbeddingModel`, provider factories). Typecheck/build drive the migration.
- Full `yarn install` from empty cache is required (no node_modules/cache present).
- Bundling a risky major migration with routine bumps in one PR (per explicit "single PR" request) — flagged for reviewer; `needs-qa` + `risk-high`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Plan

- [x] 1.1 Commit execution plan and push branch — 3b2ecbc36

### Phase 2: Apply dependency bumps (package.json + ci.yml)

- [x] 2.1 Apply residual minor/patch + mermaid bumps (max(develop,target), skip eslint)
- [x] 2.2 Apply AI-SDK major bumps + resolutions (ai, @ai-sdk/*, ai-sdk-ollama)
- [x] 2.3 Apply #3695 actions/cache v5→v6 in ci.yml

### Phase 3: Regenerate lockfile + migrate

- [x] 3.1 yarn install to regenerate yarn.lock
- [x] 3.2 build:packages + typecheck; migrate AI-SDK v7 breakage until green (4 type edits in 2 files)
- [x] 3.3 yarn test; fix fallout (ESM-only v7 → jest transformIgnorePatterns whitelist)

### Phase 4: Validation gate + PR

- [x] 4.1 Full gate (build:packages ✓, generate ✓, i18n checks ✓, typecheck 21/21 ✓, test 22/22 ✓, build:app ✓)
- [x] 4.2 Self code-review + BC review (adversarial review: no blockers)
- [x] 4.3 Open PR against develop, labels, om-auto-review-pr, summary comment

## Changelog

- 2026-07-05: Plan created.
- 2026-07-05: Full gate green; opened PR #3772 against develop (labels: review, dependencies, needs-qa, priority-medium, risk-high). Status: complete — manual QA pending.
