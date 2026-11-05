# HANDOFF — Organization-Scope Fail-Open Authorization Hardening (PR #2300)

## Current state — COMPLETE (all Tasks rows `done`)
- Phases 1–2 + Step 3.1: code + 25 unit tests (landed previously).
- **Step 3.2 (this resume): DONE** — `TC-CRM-072` validated under the coherent ephemeral app+DB harness: `1 passed (56.9s)`.
- **Step 3.3 (this resume): DONE** — full validation gate green under **Node 24.13.0** (build:packages, generate, i18n sync/usage, typecheck, `yarn test` 20/20 workspaces ~6.4k tests, build:app).
- Branch: `fix/org-scope-fail-open-authorization-hardening` (fork `adeptofvoltron`, cross-repo PR → `open-mercato/open-mercato:develop`).

## Verification artifacts
- `final-gate-checks.md` — full gate + integration + standalone + ds + review records.
- `final-gate-artifacts/playwright-report-summary.log` — TC-CRM-072 pass summary.

## Finalization applied — 2026-06-01 (gh healthy)
GitHub annotations the prior session deferred are now applied from the author account (`adeptofvoltron`):

1. ✅ **PR-body update applied** — body now reads `Status: complete`, correct `Tracking plan:` path, `Closes #2239/#2245` (`gh pr edit ... --body-file pending-pr-body.md`).
2. ✅ **Summary comment posted** — `pending-summary-comment.md` → issue comment `#issuecomment-4590492872`.
3. ✅ **Completion note** — folded into the summary comment; no `in-progress` label was ever set (read-only upstream), so there is no lock to release.

> gh note: `gh` is a snap build that cannot read `/tmp` (snap confinement). `--body-file` MUST point at a path under `$HOME` (e.g. `/home/bernard/...`); `/tmp` paths fail with "no such file or directory". The earlier "gh down" symptom was partly this.

## Still blocked — require WRITE access to `open-mercato/open-mercato` (this account is `READ`)
Confirmed: `viewerPermission: READ`; `AddLabelsToLabelable` denied for `adeptofvoltron`. A maintainer/write-access account must:

4. **Apply labels**: `review` (pipeline) + `security` + `bug` (category) + `needs-qa` (authorization behavior change touching customer-facing CRM read/write). Then comment explaining the label rationale (AGENTS PR-workflow rule).
5. **Mark ready for review** (drop draft) once labels are on — keeps the "ready non-draft ⇒ `review`" invariant.
6. **`om-auto-review-pr` autofix pass**: needs review-verdict rights (and a non-author reviewer — the author cannot approve their own PR). Self code-review + BC self-review found no actionable findings.

## Documented skip (environment, not code)
7. **`yarn test:create-app:integration`**: blocked by a pre-existing `mercato-verdaccio` container-name conflict on this host; justified skip (the only added shared export is the additive internal predicate `isOrganizationAccessAllowed`, not used by the create-app template).

## Node version (load-bearing)
Open Mercato requires **Node 24.x**. The default shell here is Node 22 — `yarn generate` / `build:app` / the ephemeral harness fail the runtime gate under Node 22. Activate Node 24 (`nvm use 24`) + `yarn install` before any gate/integration command.

## Worktree
`.ai/tmp/auto-continue-pr/pr-2300-20260529-204658` (isolated from `fork/fix/org-scope-fail-open-authorization-hardening`). Main worktree untouched.
