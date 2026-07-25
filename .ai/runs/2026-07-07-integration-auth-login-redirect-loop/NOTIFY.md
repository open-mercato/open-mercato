# Notify — 2026-07-07-integration-auth-login-redirect-loop

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-07-07T12:06:13Z — run started
- Brief: implement `.worktrees/integration-auth-redirect-loop-spec/.ai/specs/2026-07-07-integration-auth-login-redirect-loop.md`.
- External skill URLs: none.
- Classification: spec-implementation run.

## 2026-07-07T12:39:28Z — checkpoint 1 complete
- Brief: auth helper regression/diagnostics and CLI backend-cookie readiness probe implemented.
- Validation: core full suite passed; CLI full suite passed outside sandbox; focused `TC-AUTH-053` ephemeral integration passed.
- Notes: sandbox-only CLI failures were `listen EPERM ::` and `EMFILE: too many open files, watch`; see `checkpoint-1-checks.md`.

## 2026-07-07T13:34:21Z — final gate complete
- Brief: final validation and self-review completed; ready to open PR.
- Validation: `build:packages`, `generate`, second `build:packages`, i18n checks, typecheck, root test, app build, and focused ephemeral integration passed.
- Notes: root test/app build/i18n usage required unsandboxed reruns because local listener/IPC operations are blocked in the sandbox.

## 2026-07-07T13:45:30Z — PR opened
- Brief: opened PR #3963.
- URL: https://github.com/open-mercato/open-mercato/pull/3963
- Labels: intended `review`, `bug`, `skip-qa`, `priority-high`, `risk-high`; label mutation failed due upstream permission, so the intent was posted as a PR comment.

## 2026-07-07T15:09:18Z — PR CI merge-ref unblock
- Brief: rebased the PR branch onto current `origin/develop` after GitHub `prepare` failed on a TypeScript error inherited from the merge ref.
- Fix: removed the stray `ded` token before `onPointerDownOutside` in `packages/ui/src/backend/filters/AdvancedFilterPanel.tsx`.
- Validation: `yarn workspace @open-mercato/ui build` and `yarn build:app` both exited 0 after the fix.
