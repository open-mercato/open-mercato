# Execution Plan: Clarify location of `official-modules.generated.ts`

**Date:** 2026-05-19
**Slug:** `official-modules-generated-location`
**Branch:** `feat/official-modules-generated-location`
**Trigger:** User brief referencing PR #1965 (carry-forward of #1945) — "this generated file should be placed in `generated` folder as all the other generated files… or use the main modules file instead. Check what risks vs benefits are there and if it makes sense make a PR with the change and update the spec."

## Goal

Document — in code, docs, and a new ADR-style spec — the rationale for keeping `apps/mercato/src/official-modules.generated.ts` in `src/` rather than moving it into a `generated/` folder or inlining it into `apps/mercato/src/modules.ts`. No file moves. No runtime behaviour changes.

## Scope

Docs-and-banner only:

- Root `AGENTS.md` — Generated Files convention callout (concise).
- `apps/docs/docs/framework/modules/official-modules-development.mdx` — clarifying note in the layout/file-roles section.
- New decision spec at `.ai/specs/2026-05-19-official-modules-generated-location-decision.md` recording the analysis, the options considered, and the decision to keep the current placement.
- `scripts/lib/official-modules.mjs` — extend the generated-file banner to point at the spec/docs, so the next developer who opens the file sees "why am I here, not in `.mercato/generated/`?" immediately.
- Re-run the generator so the committed `apps/mercato/src/official-modules.generated.ts` banner picks up the new wording.

## Non-goals

- Moving the file. Established convention + gitignore + `clean-generated.sh` make every "generated folder" target either gitignored or wiped.
- Inlining into `modules.ts`. AST surgery on a user-curated file (env gates, enterprise toggles, hand-curated comments) introduces conflict and parsing risk.
- Any change to `official-modules.json`, the activation set, or how `yarn official-modules` writes the file.

## Decision (with risk/benefit)

| Option | Verdict | Why |
|---|---|---|
| A. Keep current placement (`src/official-modules.generated.ts`) | **Chosen** | Aligns with existing `*.generated.ts`-in-`src` pattern (`packages/core/src/generated-shims/entities.ids.generated.ts`, `packages/ui/src/backend/fields/registry.generated.ts`, `packages/ui/src/backend/icons/lucideRegistry.generated.tsx`). Versioned. Survives `yarn clean-generated`. Already wired into `modules.ts` and template-sync. |
| B. Move into `apps/mercato/.mercato/generated/` | **Rejected** | `.mercato` is gitignored AND wiped by `scripts/clean-generated.sh`. Activation state would be lost across clones / on every `yarn clean-generated`. Destroys the single source of truth. |
| C. Move into `apps/mercato/src/generated/` | **Rejected** | `.gitignore` line 62 (`/src/generated/`) makes the file untracked. Same source-of-truth loss as B. |
| D. Inline contents into `apps/mercato/src/modules.ts` | **Rejected** | `modules.ts` is hand-curated (env gates, enterprise toggles, comments). `yarn official-modules add/remove` would have to do AST edits on user-curated code — fragile, conflict-prone, and weakens diff review (auto-gen interleaved with hand-curated logic). |

The user explicitly framed this as "if it makes sense" — analysis concludes the move does not make sense; what does make sense is leaving an explicit, durable explanation so the question doesn't get re-raised every six months.

## External References

None. No `--skill-url` flags supplied.

## Implementation Plan

### Phase 1 — Document the convention

- 1.1 Add a concise "Generated files: versioned vs gitignored" callout to root `AGENTS.md` (under Critical Rules or Module Development Quick Reference) explaining the `*.generated.ts`-in-`src` vs `generated/`-folder split.
- 1.2 Add a "Why is this in `src/` and not `generated/`?" callout to `apps/docs/docs/framework/modules/official-modules-development.mdx` in the Layout / File Roles section.
- 1.3 Write the new decision spec `.ai/specs/2026-05-19-official-modules-generated-location-decision.md` per `.ai/specs/AGENTS.md` (TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models = N/A, API Contracts = N/A, Risks & Impact Review, Final Compliance Report, Changelog).

### Phase 2 — Reinforce at the point of confusion

- 2.1 Extend the auto-generated banner in `scripts/lib/official-modules.mjs#renderGenerated` to point at the new spec + docs note.
- 2.2 Re-run the generator (manually invoke `writeGenerated` via `yarn official-modules` no-op path, or run the postinstall) so the committed `apps/mercato/src/official-modules.generated.ts` banner picks up the new wording. Commit the regenerated file alongside the script change.

### Phase 3 — Validation gate

- 3.1 Run the docs-relevant subset: `yarn lint` (if it covers MDX/Markdown), `yarn test scripts/__tests__/official-modules.test.mjs` to make sure the banner change does not break the `renderGenerated` empty-array assertion.
- 3.2 Run the full gate per `auto-create-pr` step 7 — `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`. If `yarn install` is impractical in this environment, document the blocker and ship docs-only.

### Phase 4 — Ship

- 4.1 Open PR against `develop` with the standard body.
- 4.2 Apply `review`, `skip-qa`, `documentation` labels with one-line explanation comments each.
- 4.3 Run `auto-review-pr` against the PR in autofix mode; address actionable findings as new commits.
- 4.4 Post the comprehensive summary comment.
- 4.5 Mark the plan `Status: complete` and push.

## Risks

- **Banner change breaks `scripts/__tests__/official-modules.test.mjs`.** The existing test asserts a precise empty-array banner with `assert.match(renderGenerated([]), /export const officialModuleEntries: ModuleEntry\[\] = \[\n\]\n$/)`. The proposed change extends the banner header only, not the export shape, so the regex still matches — but I must re-run the test to confirm.
- **Local `yarn install` may fail in this constrained worktree environment.** Mitigation: if the full gate cannot run, ship docs-only and document the limitation in the PR body's `Status:` and the summary comment.
- **Documentation drift if the file is ever genuinely moved later.** Mitigation: the new spec is dated and listed in `.ai/specs/`; any future move PR will hit it during the AGENTS.md pre-check and be forced to either supersede or rebut it.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Document the convention

- [x] 1.1 Add generated-files convention callout to root AGENTS.md — f088a07b7
- [x] 1.2 Add clarifying note to official-modules-development.mdx — db3cbc218
- [x] 1.3 Write decision spec at .ai/specs/2026-05-19-official-modules-generated-location-decision.md — caaead715

### Phase 2: Reinforce at the point of confusion

- [x] 2.1 Extend renderGenerated banner in scripts/lib/official-modules.mjs — captured in autosave 04b60fee4
- [x] 2.2 Re-run generator and commit refreshed apps/mercato/src/official-modules.generated.ts — captured in autosave 04b60fee4

### Phase 3: Validation gate

- [x] 3.1 Targeted: scripts/__tests__/official-modules.test.mjs — passes (5/5); banner regex anchor preserved
- [x] 3.2 Full gate: yarn build:packages ✓, generate ✓, i18n:check-sync ✓, i18n:check-usage ✓ (advisory only), apps/docs build ✓. Baseline-failing on develop and not caused by this PR: yarn typecheck (S3 helper drift in core integration tests), yarn lint (rules-of-hooks in OrganizationSwitcher.tsx + example-module warnings), yarn test (storage-s3 + flaky ready-apps.test.ts), yarn template:sync (modules.ts gap PR #1965 fixes). All documented in PR body.

### Phase 4: Ship

- [x] 4.1 Open PR against develop — https://github.com/open-mercato/open-mercato/pull/1983
- [x] 4.2 Apply review, skip-qa, documentation labels with comments
- [x] 4.3 auto-review-pr autofix pass to clean verdict — APPROVED (no findings); review submitted as COMMENTED (self-approval blocked); pipeline label flipped review→merge-queue — c56c1cba4
- [x] 4.4 Post comprehensive summary comment — PR #1983 comment-4485325965
- [x] 4.5 Flip plan Status to complete, push — Status flipped to `complete` in PR body and plan
