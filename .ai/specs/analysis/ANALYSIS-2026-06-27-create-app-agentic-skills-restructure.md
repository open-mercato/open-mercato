# Pre-Implementation Analysis: Standalone Agentic Skills Restructure

> Target spec: `.ai/specs/2026-06-27-create-app-agentic-skills-restructure.md`
> Analysis date: 2026-06-27 · Read-only audit (no code or spec modified by this skill)

## Executive Summary

The spec is architecturally sound (clean three-concern split: router `SKILL.md` / procedure instruction files / `.ai/agentic.config.json` environment) and most BC surfaces are N/A because it touches no modules/entities/events/API/DB. **However it is not yet implementation-ready:** it missed an existing test (`agentic-skills-standalone-overlays.test.ts`) that enforces the *opposite* invariant (the 7 skills MUST ship `STANDALONE.md`), it has a factual error in its BC section, and it leaves two real mechanics undefined (placeholder substitution under recursive copy; stale `dist/agentic/` pruning). **Recommendation: needs spec updates first — small, not a major revision.**

## Backward Compatibility

### Violations / Warnings Found
| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | **#13 CLI Commands** | Wizard gains an install question (base branch). The non-interactive `--agents` / `--tool` headless path must not start requiring interactive input. | Warning | Add an **optional additive flag** (e.g. `--pr-base <branch|auto>`) with default `auto`; headless scaffolds write `pr.baseBranch: "auto"`. Renaming/removing nothing → BC-safe. |
| 2 | **#14 Generated-file / scaffold output** | Existing standalone apps that re-run `yarn mercato agentic:init` will get the new structure; removed `STANDALONE.md` + relocated bodies change the shipped tree. New `.ai/agentic.config.json` is additive (allowed). | Warning | Treat scaffold output as a soft contract: `agentic:init` should overwrite/regenerate the skill dirs cleanly (not merge), so no orphan `STANDALONE.md` lingers in a user's `.ai/skills/`. Document in `RELEASE_NOTES.md`. |
| 3 | **Stale `dist/` (lessons.md: "build scripts that only overwrite leave removed files behind")** | `create-app/build.mjs` does `cpSync('agentic','dist/agentic',{recursive:true})` **without** cleaning `dist/agentic` first. Deleting 7 `STANDALONE.md` from source will NOT remove them from `dist/agentic/`, so Verdaccio/npm installs keep shipping them. | **Critical** | Add a clean step (`rm -rf dist/agentic` before copy, or prune) in `build.mjs`; add a build assertion that `dist/agentic/**` contains no `STANDALONE.md`. Mirrors the documented stale-`dist/` lesson. |

### BC Section Status
The spec **has** a "Backward compatibility" section (§5) but it is **inaccurate** (see Spec Completeness below). It does not need a new heading; it needs corrected facts.

## Spec Completeness

### Incomplete / Incorrect Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| §5 Backward compatibility | Claims `create-app/AGENTS.md` references `STANDALONE.md` — **it does not** (grep is empty). Omits the **actual** references: `wizard.ts` (`printSummary`), `shared.ts` (conditional copies), and the test `packages/create-app/src/lib/agentic-skills-standalone-overlays.test.ts`. | Correct the reference list; explicitly call out the test as a file that MUST be rewritten/removed. |
| §6 Test coverage | Proposes a "no-STANDALONE guard" but does not acknowledge that `agentic-skills-standalone-overlays.test.ts` currently **asserts the opposite** and will fail the moment a `STANDALONE.md` is deleted. | State that this test is inverted/replaced in Phase 1 (it becomes the no-STANDALONE + config-wired guard). |
| §3 Generator changes | "`{{PROJECT_NAME}}` substitution is unchanged" — but today `shared.ts` substitutes only for `writeTemplate` files (e.g. `om-spec-writing/SKILL.md` contains `{{PROJECT_NAME}}`) and raw-copies the rest. Recursive dir-copy must define how substitution is preserved. | Specify: recursive copy runs `resolvePlaceholders` on every copied **text** file (or migrate `projectName` into `agentic.config.json` and drop `{{PROJECT_NAME}}` from skill bodies). |
| Implementation Plan | Spec has **Phasing** (4 phases) but no **step-level** task breakdown (the spec-writing convention wants Phases → Steps). | Add per-phase numbered steps so `om-implement-spec` has testable units. |
| Final Compliance Report | No explicit section (self-review lives only in the chat). | Add a short Final Compliance Report section (which canonical checks apply / are N/A and why). |

### Missing Sections (genuinely N/A — no action)
Data Models (only the config schema, present), API Contracts, UI/UX, Encryption, Events, Commands — all N/A for an agentic-tooling change. Noted so reviewers don't flag their absence.

## AGENTS.md Compliance

| Rule | Location | Fix |
|------|----------|-----|
| `create-app/AGENTS.md` Always #8 — "keep standalone agent guidance aligned with generator behavior; update `template/AGENTS.md` and `agentic/shared/AGENTS.md.template` when generate behavior changes" | Spec changes the generator (recursive copy) + ships a new config file | Add a step to update `agentic/shared/AGENTS.md.template` (and `template/AGENTS.md` if it documents skill structure) to describe thin-`SKILL.md` + instruction files + `agentic.config.json`. |
| `create-app/AGENTS.md` Always #1 — "MUST test both environments (monorepo AND standalone via Verdaccio)" | §6 | Already satisfied (`test:create-app`); keep the standalone smoke assertion for the new tree + config. |
| Canonical mechanisms / DS / encryption / tenant scoping | — | **N/A** — no runtime module surface. Correctly out of scope. |

## Risk Assessment

### High
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Existing `agentic-skills-standalone-overlays.test.ts` enforces the inverse invariant | CI red the instant a `STANDALONE.md` is removed | Phase 1 rewrites it into the no-STANDALONE + `pr.baseBranch`-wired guard; sequence the test change with the first deletion. |
| Over-thinning a `SKILL.md` `description` (frontmatter triggers are load-bearing for auto-invocation) | Skill silently stops triggering | Spec R1 already covers; conformance guard asserts non-empty `description`. Confirmed: current SKILL.md **do** carry rich frontmatter `description` (verified on `om-auto-create-pr`, `om-help`, `om-spec-writing`). |

### Medium
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Placeholder substitution lost under recursive copy | `{{PROJECT_NAME}}` ships literally into a scaffolded app | Define substitution behavior (above). |
| Stale `dist/agentic/` ships removed files | Users still receive `STANDALONE.md` after it's "deleted" | Clean `dist/agentic` in `build.mjs` (BC #3). |

### Low
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Conformance line-budget (≤60) too rigid | False CI failures on legitimately rich routers (e.g. `om-help`, 107 lines, 9 reflinks) | Make it a soft warning or raise/justify the budget per-skill. |
| Continued divergence from monorepo `.ai/skills/` (already different today) | Maintainers update two structures | Acknowledged in Non-Goals; not a regression (they already differ). |

## Gap Analysis

### Critical (block implementation)
- **Invert/replace** `agentic-skills-standalone-overlays.test.ts` — currently mandates the 7 `STANDALONE.md` that the spec deletes.
- **Clean `dist/agentic/`** in `build.mjs` so deleted source files stop shipping (stale-`dist/` lesson).
- **Define recursive-copy placeholder substitution.**

### Important (should address)
- Correct §5 BC facts (AGENTS.md does not reference STANDALONE; list the real refs incl. the test).
- Add step-level Implementation Plan.
- Add the `AGENTS.md.template` / `template/AGENTS.md` update step.

### Nice-to-have
- Soften the line-budget guard; add a Final Compliance Report section.

## Remediation Plan

### Before Implementation (Must Do — fold into the spec)
1. Fix §5 BC: real reference list + call out the existing overlays test.
2. Add BC item: clean `dist/agentic` in `build.mjs` + a no-`STANDALONE.md`-in-dist assertion.
3. Specify placeholder substitution under recursive copy.
4. Add the `--pr-base`/headless-default note (keep `--agents` BC-safe).
5. Add a step to update `agentic/shared/AGENTS.md.template` (+ `template/AGENTS.md`).

### During Implementation (Add to Spec)
1. Per-phase step breakdown with testable units.
2. Phase 1 explicitly rewrites the overlays test before the first `STANDALONE.md` deletion.

### Post-Implementation (Follow Up)
1. `RELEASE_NOTES.md` entry describing the new agentic structure + config.
2. Consider porting the thin-SKILL pattern back to the monorepo `.ai/skills/` (separate spec).

## Recommendation

**Needs spec updates first.** The architecture and decisions (D1–D4) are sound and require no rework; the fixes are 5 small accuracy/gap edits (BC facts, dist cleaning, substitution, headless flag, AGENTS.template). After folding those in, the spec is ready for `om-implement-spec`.
