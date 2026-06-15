# Execution Plan — Collaborative Proposal Skills (Phase 1)

Source spec: .ai/specs/2026-06-15-collaborative-proposal-skills.md

## Goal

Ship a new group of agentic skills for **collaborative pre-spec ideation** — `om-proposal`
(async, file-based proposals in `.ai/proposals/`) and `om-brainstorm` (party mode / Socratic /
5-whys / yes-and) — plus an optional `om-spec-writing` intake hook, wired into both the monorepo
`.ai/skills/` and the standalone `create-mercato-app` generator.

## Scope

- New skills `om-proposal` + `om-brainstorm` (monorepo source + create-app mirror).
- Optional `om-spec-writing/references/proposal-intake.md` + guarded SKILL.md step (both copies).
- `generateShared()` copy-list extension + `shared.test.ts` coverage.
- `om-help` catalog/sequences (both locations) + root `AGENTS.md` Task Router row.

## Non-goals

- Phase 2 installer "skill package" selection (separate spec).
- Codex/Cursor parity for the new skills.
- Real-time multi-human collaboration.

## Risks

- Source-level wiring only; standalone delivery additionally needs `yarn build` in
  `packages/create-app` (esbuild + `build.mjs` copies `agentic/ → dist/agentic/`).
- Fork PR: per project fork workflow there are no upstream pipeline labels / review bots, so the
  label-normalization and `auto-review-pr` ceremony are reduced for this run.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Skills + contract + optional intake

- [x] 1.1 Proposal file contract (`om-proposal/references/proposal-template.md`) — cf672ccee
- [x] 1.2 `om-proposal` SKILL.md (scan → defer-aware question gate → method → append → ready/move) — cf672ccee
- [x] 1.3 `om-brainstorm` SKILL.md + `references/methods.md` (BMAD attribution) — cf672ccee
- [x] 1.4 `om-spec-writing` optional intake (`references/proposal-intake.md` + guarded step, both copies) — cf672ccee
- [x] 1.5 Monorepo wiring (`om-help` catalog + sequences §0; root `AGENTS.md` Task Router row) — cf672ccee
- [x] 1.6 Standalone wiring (mirror skills; `generateShared()` copies + intake; shipped `om-help` refs) — cf672ccee
- [x] 1.7 Tests (`shared.test.ts` asserts ship + wiring) — cf672ccee

## Changelog

- 2026-06-15 — Phase 1 implemented and verified (create-app `shared.test.ts` 6/6, typecheck clean, `node build.mjs` copies new skills into `dist/agentic`). PR opened on fork.
