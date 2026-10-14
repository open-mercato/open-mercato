# Handoff — 2026-10-14-ecommerce-release-4-write-side

**Last updated:** 2026-10-14T17:35:00Z (checkpoint 2, closed)
**Branch:** feat/release-4-write-side
**PR:** https://github.com/adeptofvoltron/open-mercato/pull/15 (draft, base `develop` on the fork)
**Current phase/step:** Phase 1 Steps 1.1–1.6 done; resume at Step 1.7
**Last commit:** see `git log` on `feat/release-4-write-side` (`108fdf96da`, the auth i18n fix, is the most recent at checkpoint-2 close)

## What just happened
- Phase 0 (spec revision) complete — see the PR's checkpoint-1 comment.
- Phase 1 Steps 1.1–1.6 done, each its own commit, each executed by a dispatched sub-agent and then verified directly (file diffs read, not just agent self-reports trusted): 1.1 module scaffold; 1.2 entities/validators/migration (over-scoped into Code-related entities, see below); 1.3 promotion CRUD commands with undo; 1.4 rule-tree reconcile + tree PUT / order PATCH routes with per-item optimistic locking; 1.5 `makeCrudRoute`-based CRUD routes + OpenAPI factory; 1.6 i18n (5 locales) + the card-layout list page.
- Three corrections made along the way (all committed, all explained in NOTIFY.md): (a) `apps/mercato/src/modules.ts` registration happens per-module at its first migration-needing step, not Step 7.8 — a real `yarn db:generate` tooling constraint; (b) Step 6.1 (code entities) is already satisfied by Step 1.2's over-scope, marked done early; (c) **checkpoint-2's full `@open-mercato/core` test run caught a real regression** — Step 1.1's new ACL features had no `auth.acl.features.promotions.*` i18n catalog entries; fixed in `108fdf96da`.
- Checkpoint 2 is CLOSED: `yarn generate`/`yarn build:packages --force`/`yarn typecheck` (full monorepo)/`yarn i18n:check-sync` all clean; the full core test suite ran once (2341 suites) and its one finding is fixed and re-verified. Comment posted to PR #15.
- One tracked-but-unfixed gap from Step 1.6: the promotion list response has no rule-tree-non-empty flag, so delete-confirmation is unconditional rather than conditional per the spec's literal text. Low priority; revisit opportunistically.

## Next concrete action
- Step 1.7: promotion form pages (create + detail, 3 panels not 4 — the "promotional-price-visibility" toggle was dropped in rev 9) and the `RuleGroupNode` recursive tree builder component. Read `SPEC-055-2026-02-23-promotions-module.md`'s `## UI/UX` → `### Promotion Form` and `### Rule Group Tree Builder` sections fresh (the DS-token rev note there matters — no hardcoded colors, the depth indicator is a left-border/elevation token, not a `color-mix` ramp).
- Step 1.8 (benefit card) naturally follows 1.7 in the same UI area — reasonable to dispatch both before the next checkpoint, landing it at or before Step 1.9/1.10 (don't let the gap grow past ~5 steps without one).
- Steps 1.9–1.10 (API and UI integration tests) need a runnable dev environment and possibly a database — check `.ai/qa/AGENTS.md` and this repo's test-env descriptor before attempting them. This worktree has never started the dev server or touched a database this run.

## Blockers / open questions
- None blocking. The corrections above are resolved decisions, not open questions.

## Environment caveats
- Dependencies installed (`yarn install` ran this session — the worktree didn't have `node_modules` when the run resumed). Built once via the fresh-worktree order (`build:packages` → `generate` → `build:packages`), then re-verified clean at this checkpoint.
- Node 24 via `export PATH="/opt/homebrew/bin:$PATH"` worked in this environment (not the `/home/bernard/.nvm/...` path the original HANDOFF named — adjust per the actual shell this resumes in).
- Dev runtime (storefront/backend dev server) not yet started — not needed for Steps 1.1–1.5 (no UI yet). Will be needed from Step 1.7 onward.
- Database/migration state: clean; the one promotions migration is committed but never applied (`yarn db:migrate` never run, per root AGENTS.md).
- Fork repository: `adeptofvoltron/open-mercato`. Pass `-R adeptofvoltron/open-mercato` on every `gh` call.
- **Re-check `git fetch fork feat/release-4-write-side` before every push** — the branch owner synced `develop` into it once already during Step 0.1 (unrelated tax-providers roadmap pointer, merged cleanly).

## Worktree
- Path: this cezar run's own worktree (`.ai/cezar/worktrees/e12a1916-0f76-40d7-a20f-3395d9ab0856`), checked out at `feat/release-4-write-side`, tracking `fork/feat/release-4-write-side`.
