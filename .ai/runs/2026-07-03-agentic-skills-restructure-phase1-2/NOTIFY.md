# Notify — 2026-07-03-agentic-skills-restructure-phase1-2

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-07-03T18:25:00Z — run started
- Brief: Implement Phases 1+2 of spec `2026-06-27-create-app-agentic-skills-restructure.md` — plumbing (config, `--pr-base`, recursive skill-dir copy, build clean) + restructure the 7 STANDALONE-owning skills (thin SKILL.md + workflow/ + subagents/, absorb STANDALONE rules natively, delete STANDALONE.md, wire `pr.baseBranch`).
- Scope decision (user, via AskUserQuestion): Phases 1+2 only; Phases 3+4 deferred to a follow-up PR after review of the pattern.
- External skill URLs: none

## 2026-07-03T19:05:00Z — checkpoint 1 (Phase 1 complete)
- Steps 1.1–1.6 landed (2248aa015 … bd97e7ce0): config type + base-branch question, `--pr-base` flag, `.ai/agentic.config.json` generator, recursive skill-dir copy, `build.mjs` clean step, doc de-STANDALONE.
- Validation: tsc clean; 78/78 unit tests; build.mjs OK. No UI → no Playwright.
- Decision: overlays test adapted (not yet inverted) to keep CI green while STANDALONE files still ship; full no-STANDALONE guard lands in Step 2.8 after the 7 deletions.
- Next: Phase 2 Step 2.1 (om-auto-create-pr) as the canonical thin-SKILL pattern.
