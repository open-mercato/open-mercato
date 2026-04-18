# Step 1.4 checks — flatten verification layout

**Step:** 1.4 Flatten verification layout: replace `proofs/<step>/` with `step-<X.Y>-checks.md` + optional `step-<X.Y>-artifacts/` next to PLAN.md.
**Scope:** docs-only.
**Commit:** _filled in at commit time_.

## What changed

- Removed the nested `proofs/<step-id>/` layout. Verification now lives in flat files next to `PLAN.md`:
  - `step-<X.Y>-checks.md` — required per Step with a commit; records typecheck / unit tests / i18n / Playwright / diff-re-read outcomes (or explicit N/A with reason).
  - `step-<X.Y>-artifacts/` — optional per Step; created only when the Step actually produced artifacts worth keeping (Playwright transcript, screenshots, captured command output). Never empty.
- Full-gate output moves from `proofs/_final-gate/` to `final-gate-checks.md` (+ optional `final-gate-artifacts/`).
- Review-fix follow-ups (`X.Y-review-fix` Step ids) use `step-<X.Y-review-fix>-checks.md` + optional `step-<X.Y-review-fix>-artifacts/`.

## Files touched

- `.ai/runs/README.md` — folder-layout section rewritten with the flat layout and the full `step-<X.Y>-checks.md` / `step-<X.Y>-artifacts/` contract.
- `.ai/skills/auto-create-pr/SKILL.md` — description, run-folder layout section, header variables, step 3 (targeted validation), step 4 (UI verification), step 6 loop (added a Step-checks.md write), step 7 (full gate), step 11 (review-fix), step 12 summary, Rules section.
- `.ai/skills/auto-continue-pr/SKILL.md` — mirrors auto-create-pr: description, header variables, step 4 (targeted validation + UI), step 5 (full gate), step 7 (review-fix), step 8 summary, Rules section.
- `.ai/skills/auto-sec-report/SKILL.md` — claim-step pointer updated to reference the new layout.
- `.ai/skills/auto-qa-scenarios/SKILL.md` — no changes needed; it follows auto-create-pr step 0 by reference and does not hard-code the old layout.
- `.ai/runs/2026-04-18-ai-framework-unification/proofs/` — removed.
- `.ai/runs/2026-04-18-ai-framework-unification/step-1.1-checks.md`, `step-1.2-checks.md`, `step-1.3-checks.md` — migrated from the old `proofs/<id>/notes.md` files (1.2 is newly written; 1.1/1.3 carry the old content with filenames normalized).
- `.ai/runs/2026-04-18-ai-framework-unification/step-1.4-checks.md` — this file.
- `.ai/runs/2026-04-18-ai-framework-unification/PLAN.md` — added Step 1.4.

## Verification

- **Typecheck / unit tests / Playwright / i18n:** N/A — docs-only.
- **Diff re-read:** confirmed no remaining reference to `proofs/<id>/` in any SKILL.md, except the `README.md` / skill files explicitly contrasting the old and new layouts.
- **Cross-skill consistency:** `auto-create-pr` and `auto-continue-pr` agree on `step-<X.Y>-checks.md` + optional `step-<X.Y>-artifacts/`. Sibling skills point to `auto-create-pr` step 0 and inherit the new layout.
- **Backward compatibility:** no external consumers. PR #1593 is the first run to use this layout; its Step 1.1/1.2/1.3 checks have been migrated in-place.

## Artifacts

- None. Docs-only change.
