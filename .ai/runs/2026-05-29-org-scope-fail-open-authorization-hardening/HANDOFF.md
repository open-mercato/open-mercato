# HANDOFF — Organization-Scope Fail-Open Authorization Hardening (PR #2300)

## Current state
- **Phase/step:** resuming at **Step 3.2** (first `todo` row in PLAN.md Tasks table).
- **Phases 1–2 + Step 3.1 are done** (code + 25 unit tests landed, `@open-mercato/shared` + `@open-mercato/core` build + typecheck clean).
- **Last commit:** `5077cc1dd docs(runs): link draft PR #2300 in plan changelog` (then a migration commit on this resume converting the flat plan to this run folder).
- **Branch:** `fix/org-scope-fail-open-authorization-hardening` (fork `adeptofvoltron`, cross-repo PR against `open-mercato/open-mercato:develop`).

## Next concrete action
- **Step 3.2:** Validate `packages/core/src/modules/customers/__integration__/TC-CRM-072.spec.ts` under a coherent app+DB harness (`yarn test:integration:ephemeral`). The spec mixes API fixtures with raw-`pg` DB fixtures, so the app server and fixtures MUST share one database — it cannot be validated against an arbitrary running dev server whose `DATABASE_URL` differs from `apps/mercato/.env`.
- **Step 3.3:** Run the full validation gate (`yarn build:packages`, `yarn generate`, `yarn typecheck`, `yarn test`, `yarn build:app`) + i18n checks.

## Open blockers / caveats
- Fork PR: only **read** access to `open-mercato/open-mercato`, so the `in-progress` label + assignee signals are unavailable. The lock is a **claim comment** only. Push lands on the fork branch, which updates the PR.
- The original author noted the integration spec could not be validated in-session because the dev server's `DATABASE_URL` differed from the fixtures' DB. Use the ephemeral harness, or record a skip with reason if the harness is not runnable here (UI/integration checks MUST NOT block development).

## Worktree
- `.ai/tmp/auto-continue-pr/pr-2300-<ts>` (isolated; created from `fork/fix/org-scope-fail-open-authorization-hardening`). Main worktree untouched.
