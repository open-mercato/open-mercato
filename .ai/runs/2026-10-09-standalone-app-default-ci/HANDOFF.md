# Handoff — 2026-10-09-standalone-app-default-ci

**Last updated:** 2026-10-09
**Branch:** feat/standalone-app-default-ci (pushed to `fork` = adeptofvoltron/open-mercato), rebased onto develop
**PR:** https://github.com/open-mercato/open-mercato/pull/7138 (ready, Status: complete)
**Current phase/step:** all Tasks rows done; final gate recorded

## What just happened
- Steps 1.7 (Turbopack build cache off for the gate build; 5/5 cold `yarn ci` pass under 7 GB, 2/2 OOM with it on), 1.8 (workflow templates moved to `template/github/` because `yarn pack` drops `.github`), 2.1–2.3, 3.1–3.2 landed.
- Two review passes; both Medium findings and the actionable Lows fixed. Branch rebased onto develop; repo-wide-guards classification added for `ci-flag.test.ts`.

## Next concrete action
- None for this run. Manual follow-up (Q12): real-GitHub verification of `ci.yml`/`integration.yml` from a canary scaffold. First post-merge `snapshot.yml` run is the canary's evidence.

## Blockers / open questions
- Core-team sign-off on CI being on by default (create-app Ask First: scaffold modes).
- Follow-ups for the PR summary (not filed): `mercato agentic:init` github-copilot never copies Copilot files; monorepo CI may cache an empty `.yarn/cache`; env-gated app specs under `--app-only` can fail "No tests found" instead of exiting 0; `test-create-app-integration.ts` readiness deadline (240 s) is too short for slower hosts.

## Environment caveats
- colima + docker CLI were installed via Homebrew on the run host to measure under a 7 GB cgroup (`checkpoint-2-checks.md`).
- Same-version republish to Verdaccio is shadowed by Yarn/npx caches; clear `@open-mercato-*` cache zips and use a fresh npm cache.

## Worktree
- Path: cezar worktree db4bd11d (removed by cezar after the task)
