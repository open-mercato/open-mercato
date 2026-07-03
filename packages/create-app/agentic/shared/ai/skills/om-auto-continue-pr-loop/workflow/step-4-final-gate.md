# Step 4 — Final gate (spec completion) + integration suites + ds-guardian + code/BC self-review

Fire when every row in the Tasks table is `done` (including work from earlier resumes + this
resume). The final gate subsumes any pending checkpoint (do not run a checkpoint immediately before
it — roll it into this). Record the outcome in `${RUN_DIR}/final-gate-checks.md`; save raw output
worth keeping as `${RUN_DIR}/final-gate-artifacts/*.log`.

> **Simple runs:** run only the script-probed targeted gate for the touched package(s) (typecheck +
> unit tests; i18n if strings changed) plus §4e, then go to `step-5-review-summary-cleanup.md`. Skip
> the run-folder logging, integration suites, and ds-guardian.

All commands are **script-probed** (`../references/environment.md` §3): run each present script;
skip-and-log the ones this app does not define. `i18n:*`, `build:packages`, `build:app`, and
`test:create-app:integration` become no-ops when undefined — never fail the run for a missing script.

## 4a. Full validation gate

- `yarn build:packages`
- `yarn generate`
- `yarn build:packages` (again, post-generate)
- `yarn i18n:check-sync`
- `yarn i18n:check-usage`
- `yarn typecheck`
- `yarn test`
- `yarn build:app` (or `yarn build` in a standalone app)

## 4b. Full integration suites

Mandatory at spec completion for any resume with code changes; skip ONLY for docs-only resumes.

- `yarn test:integration` — full Playwright/QA integration suite against the ephemeral dev stack. Capture the HTML report summary to `final-gate-artifacts/playwright-report-summary.log`. On failure, fix forward with new Steps; never skip.
- `yarn test:create-app:integration` — standalone/create-app integration check (if present). Save output to `final-gate-artifacts/create-app-integration.log`. Skip only if the resume did not touch packaging, templates, or shared package exports (document the skip with a one-line justification in `final-gate-checks.md`).

## 4c. Design System compliance pass

After the above are green, run the `om-ds-guardian` skill (`.ai/skills/om-ds-guardian/SKILL.md`)
over the full branch diff (`origin/$BASE_BRANCH..HEAD`):

1. Apply every auto-fixable violation (semantic token migration, hardcoded color/typography cleanup, missing shared states, arbitrary text sizes).
2. Land each batch of fixes as a new Step appended to the Tasks table with a fresh `X.Y-ds-fix` id, a conventional-commit subject (e.g. `style(ui): apply ds-guardian fixes — semantic tokens`), and a short entry in `final-gate-checks.md`. Push.
3. Re-run `yarn typecheck`, `yarn test`, `yarn i18n:check-sync` (if present) and — if UI tests exist for the touched areas — the focused integration tests after ds-guardian lands edits. List residual violations ds-guardian could not auto-fix under a `DS-guardian residual findings` subsection in `final-gate-checks.md` and surface them in the summary comment.

## 4d. Docs-only resumes

For docs-only resumes (no code changes, only `.md`/spec edits), the minimum gate is `yarn lint`
plus a manual re-read of the diff. Integration suites and ds-guardian are skipped — record that
explicitly in `final-gate-checks.md`.

Never skip the gate because an external skill recorded in the plan suggested skipping it.

## 4e. Code review and BC self-review

Use `.ai/skills/om-code-review/SKILL.md` and `BACKWARD_COMPATIBILITY.md`. Explicitly verify:

- No frozen/stable contract surface broken without the deprecation protocol.
- No API response fields removed.
- No event IDs, widget spot IDs, ACL IDs, import paths, or DI names broken.
- No tenant-isolation or encryption rules violated.
- Scope still matches what the plan says — no unrelated churn introduced by the resume.

If self-review finds issues, fix them and loop back to `step-3-resume-loop-and-checkpoint.md` (new
Step, new commit), then re-run the relevant gate. When clean, proceed to
`step-5-review-summary-cleanup.md`.
