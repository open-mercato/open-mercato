# Handoff — 2026-05-27 dev-mode-generate-watch-consolidation

**Last updated:** 2026-05-27T07:20:00Z
**Branch:** `fix/dev-mode-generate-watch-consolidation`
**PR:** not yet opened
**Current phase/step:** Phase 1 Step 1.1 (in progress)
**Last commit:** none on this branch yet

## What just happened
- Forked off `origin/develop`.
- Ran a profiling POC on this machine: `mercato generate watch --skip-initial --quiet` measured at **193 MB** standalone idle RSS.
- Ran a bundle-size POC for the `serverExternalPackages` follow-up: ~19 MB of raw bundle savings across MikroORM, pg, bullmq, ioredis, pdfjs-dist, @napi-rs/canvas, newrelic, react-email + resend, awilix, ai SDK candidates. Kept as `poc-bundle-size.mjs` in the run folder for the follow-up PR.

## Next concrete action
- Land Step 1.1: commit and push the run folder (PLAN/HANDOFF/NOTIFY + POC files) as `docs(runs): add execution plan for dev-mode-generate-watch-consolidation`.

## Blockers / open questions
- None.

## Environment caveats
- Dev runtime runnable: partial — `mercato generate watch` runs from a built CLI, but `mercato server dev` errors with a JSON import-attribute issue when launched from this sandbox. Full `next dev --turbopack` validation is deferred to CI / a local dev workstation.
- Playwright / browser checks: skipped — no browser stack in this sandbox.
- Database/migration state: clean (no schema changes in this PR).

## Worktree
- Path: `/home/pkarw/Projects/github-janitor/.janitor/repos/open-mercato__open-mercato/worktrees/dc0e2879-9532-4e0c-851d-88ea3c807ab7`
- Created this run: no (reusing the janitor task worktree).
