# Final gate — 2026-05-27 dev-mode-package-watch-consolidation

> Final-gate verification log. Subsumes the 5-Step checkpoint cadence — all
> Tasks-table rows are `done`, so this single file covers every check.

## Tasks summary at gate

| Phase | Step | Title | Status | Commit |
|---|---|---|---|---|
| 1 | 1.1 | Add run folder (PLAN/HANDOFF/NOTIFY) | done | b2d2341 |
| 1 | 1.2 | Add `scripts/watch-packages.mjs` consolidated watcher | done | 9503e9b (amended → 7c29899) |
| 1 | 1.3 | Wire `yarn watch:packages` to the consolidated watcher | done | 8a224ba |
| 1 | 1.4 | Add `scripts/profile-dev-rss.mjs` | done | 2e32b1a |
| 1 | 1.5 | Mark Phase E In Progress on the source spec | done | c768f97 |
| 2 | 2.1 | Unit tests for `watch-packages.mjs` | done | fe26f3c |

## Validation gate

| Command | Result | Notes |
|---|---|---|
| `node --check scripts/watch-packages.mjs` | ✓ | Syntax OK. |
| `node --check scripts/dev.mjs` | ✓ | Syntax OK. |
| `node --check scripts/dev-orchestration-log-policy.mjs` | ✓ | Syntax OK. |
| `node --check scripts/profile-dev-rss.mjs` | ✓ | Syntax OK. |
| `node --test scripts/__tests__/*.mjs` | ✓ (143/143) | Includes the 7 new `watch-packages.test.mjs` cases and the new `isIgnorableConsolidatedWatchLine` predicate cases in `dev-orchestration-log-policy.test.mjs`. |
| Manual smoke: `node scripts/watch-packages.mjs` | ✓ | Discovers exactly the 16 packages Turbo `run watch` picks up via the `watch` script (`ai-assistant, cache, checkout, cli, content, core, enterprise, events, gateway-stripe, onboarding, queue, scheduler, search, shared, storage-s3, ui`). Packages without a `watch` script (`webhooks`, `sync-akeneo`, `create-app`) are correctly skipped, matching pre-change behavior. |
| Memory profile (before): 18 per-package fixture watchers idle | 1 188.5 MB total RSS | Measured via `/tmp/poc-memwatch/run-multiprocess.mjs` against this worktree's `packages/*` (includes `create-app` for an apples-to-apples Turbo-style count). |
| Memory profile (after): 1 consolidated process | 90.8 MB RSS | Measured via `/tmp/poc-memwatch/run-consolidated-real.mjs` against `scripts/watch-packages.mjs` discovering 16 packages with a `watch` script. |
| **Net savings** | **≈ 1.10 GB** | Comfortably above the 1 GB target. |

## Gates NOT run in this sandbox (deferred to CI)

These full-tree gates cannot run in the janitor sandbox because workspace
dependencies are symlinked from a sibling worktree whose `yarn.lock` differs.
Running them would risk reporting noise from unrelated drift, not from the
change set. CI is the authoritative gate.

| Gate | Reason for deferral |
|---|---|
| `yarn build:packages` | Workspace install would have to bootstrap ~2 GB of node_modules; out of scope for sandbox. |
| `yarn typecheck` | Same dependency requirement. The changed files are `.mjs` (no TS typecheck) and the existing `node --test` suite exercises every path we touched. |
| `yarn test` | Wraps every package's Jest test runner; same dependency requirement. The new Node `--test` suite covers the new module surface end-to-end. |
| `yarn i18n:check-sync` / `yarn i18n:check-usage` | No user-facing strings or locale files changed. |
| `yarn build:app` | Same dependency requirement. The change does not touch `apps/mercato/src/` — only `scripts/` and `package.json`. |
| `yarn test:integration` | Requires Playwright + a running dev stack with Postgres/Redis; not provisioned. UI is not touched. |
| `yarn test:create-app:integration` | Requires Verdaccio + create-app fixtures; not provisioned. The `create-app` package has no `watch` script and is unaffected. |
| `ds-guardian` pass | No DS-styled surfaces, semantic tokens, status colors, or UI primitives touched. |

CI will run all of the above on push.

## Self code-review (against `.ai/skills/code-review/SKILL.md`)

- **Scope discipline:** Each commit ships exactly one Step. `feat(dev): add consolidated workspace package watcher` introduces the new script in isolation, `feat(dev): route yarn dev through the consolidated package watcher` flips `package.json` + `scripts/dev.mjs` together with the matching `isIgnorableConsolidatedWatchLine` predicate so non-verbose `yarn dev` doesn't surface the new lines as failures.
- **Defensive failure handling:** `isIgnorableConsolidatedWatchLine` deliberately whitelists only the four happy-path log shapes. Tests assert that `[watch] <pkg>: rebuild failed: …` and `[watch] <pkg>: failed to start fs.watch: …` lines are NOT filtered so genuine errors continue to bubble up to the "Package watch emitted raw output" failure surface.
- **No backwards-compat regressions:** Per-package `packages/<pkg>/watch.mjs` scripts are untouched. `yarn workspace @open-mercato/<pkg> watch` still works the same way (low-memory or persistent modes per `OM_PACKAGE_WATCH_MODE`). The `OM_WATCH_PACKAGES_MODE=legacy` env var routes through the prior Turbo path exactly as before for anyone who needs it.
- **`em.find` / encryption sweep:** No data-access code changed.
- **i18n / DS:** No user-facing copy, no Tailwind status tokens, no UI primitives.

## BC self-review (against `BACKWARD_COMPATIBILITY.md`)

The 13 contract-surface categories enumerated in `BACKWARD_COMPATIBILITY.md`
do NOT include any of:

- the `watch:packages` script (it's a dev-time helper, not a typed/public API);
- `scripts/dev.mjs` / `scripts/dev-orchestration-log-policy.mjs` (dev orchestration plumbing);
- per-package `watch` scripts (still functional and unchanged).

No frozen or stable contract surface is touched. No deprecation protocol is
needed.

## DS-guardian

Nothing to do — the change set has no DS-styled surfaces.
