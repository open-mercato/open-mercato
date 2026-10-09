# Handoff — 2026-10-09-standalone-app-default-ci

**Last updated:** 2026-10-09T14:38:31Z
**Branch:** feat/standalone-app-default-ci (pushed to `fork` = adeptofvoltron/open-mercato)
**PR:** https://github.com/open-mercato/open-mercato/pull/7138 (draft, Status: in-progress)
**Current phase/step:** Phase 1 Step 1.7 (todo) — checkpoint 1 failed, fix forward
**Last commit:** e76b371720 — fix(create-app): cap the cold next build heap inside yarn ci for 7 GB runners

## What just happened
- Steps 0.1–1.6 landed. Checkpoint 1 found that a cold `yarn ci` build is still intermittently OOM-killed on a 7 GB / 2 vCPU runner shape (see `checkpoint-1-checks.md` → Memory findings).
- Run paused at the user's request to continue on another machine.

## Next concrete action
- Step 1.7: make the cold `yarn ci` build fit 7 GB reliably. Try `experimental.turbopackFileSystemCacheForBuild: false` gated on `OM_SKIP_NEXT_BUILD_TYPECHECK=1` in `packages/create-app/template/next.config.ts` first; prove it with ≥3 fully cold `yarn ci` runs (`oom_kill=0`), then update the spec Phase 0 table + Architecture → Memory and the docs Memory paragraph. Then re-run checkpoint 1 and continue with Phase 2 (2.1).

## Blockers / open questions
- Gate verdict: if no candidate fits 7 GB reliably, the spec's Phase 0 gate says escalate the default (`--ci` → `none`) to the core team instead of shipping a red-by-default CI.
- Follow-ups to report in the PR (do NOT file issues without asking the user): `mercato agentic:init` with github-copilot never copies Copilot files into the app (`finalizeHarnessManifest` in `packages/cli/src/lib/agentic-setup.ts` ~465 omits `.github/*` and `.vscode/mcp.json.example`); the monorepo's own CI may cache an empty `.yarn/cache` (Yarn 4 global cache).

## Environment caveats
- Dev runtime runnable: not needed (no UI).
- Browser / UI checks: skipped — change ships no UI.
- Database/migration state: clean (no migrations).
- Verdaccio for E2E: a separate instance is required if another worktree owns :4873. Publish with `MERCATO_STACK=<x> VERDACCIO_PORT=4874 VERDACCIO_URL=http://localhost:4874 yarn registry:publish`, then recreate the container with `-e VERDACCIO_PUBLIC_URL=http://localhost:4874` (compose hard-codes :4873 tarball URLs), and install the scaffold with an isolated `YARN_GLOBAL_FOLDER` + `YARN_CACHE_FOLDER`. Check `grep -c 'localhost%3A4873' yarn.lock` is 0.
- Host noise: create-app `yarn test` has ~80 bubblewrap failures on hosts without user namespaces; judge changes by their own test files.

## Worktree
- Path: (removed after this handoff; recreate from `fork/feat/standalone-app-default-ci`)
- Created this run: yes
