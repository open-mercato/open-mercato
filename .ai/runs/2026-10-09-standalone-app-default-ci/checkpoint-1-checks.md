# Checkpoint 1 — Steps 0.1..1.6

**Result:** ❌ FAILED — cold `yarn ci` `build` is still OOM-killed intermittently on a 7 GB runner shape. Fix-forward Step 1.7 appended (todo). Phase 2 is blocked on it.
**Recorded:** 2026-10-09T14:38:31Z
**Commits:** 37dbf48c67 (0.1) .. e76b371720 (1.6)
**Touched areas:** `packages/create-app` (template `scripts/ci.mjs`, `.github/workflows/ci.yml.template`, `package.json.template`, `next.config.ts`, `src/index.ts` `--ci` flag), `packages/cli` (test only), `apps/docs` (standalone-app page), spec.
**Runner:** local mode (no compose `app` container); Node 24.16.0 host, `node:24.20.0-trixie` for capped runs.

## Checks

| Check | Result | Notes |
|---|---|---|
| `packages/create-app` `yarn test` (after 1.3) | ⚠️ 836 pass / 80 fail of 923 | All 80 failures in bubblewrap-sandboxed suites (`agent-harness-evaluator` 65, `agent-harness-release` 13, `business-writable-oracles` 1, `writable-ast-oracles` 1): `bwrap: setting up uid map: Permission denied` on this host. Pre-existing baseline was 81. None in files this run touched. |
| create-app `tsc --noEmit` | ✅ | after 1.3 and after 1.6 |
| Targeted create-app tests after 1.6 (`template-ci-script`, `template-build-memory`, `template-script-targets`, `ci-flag`) | ✅ 39/39 | |
| Step 1.4 suites (cli ownership/init 35/35, create-app wizard/shared/ownership 21/21) | ✅ | reported by executor |
| Budget test `agent-instruction-budget.test.ts` (+5 AGENTS-template tests) | ✅ 159/159 | AGENTS files 11,047 / 11,051 bytes |
| Verdaccio scaffold E2E: `ci.yml` rendered, `ci` script, CI summary block, Copilot `.github/*` coexists with `workflows/` | ✅ | `--agents all --preset classic` |
| `node scripts/ci.mjs --check-lockfile` before / after `yarn install` | ✅ exit 1 / exit 0 | |
| `--prepare-env` on a fresh app | ✅ | "created .env from .env.example" |
| Cold `yarn ci` in 7 GB / 2 vCPU container (after 1.6, 4 GB build heap) | ❌ 1 pass / 1 OOM | run 1 passed in 5m13s; run 2 `oom_kill=1` during "Generating static pages (2/6)" |
| Cold `yarn ci` with `turbopackFileSystemCacheForBuild: false` | ⏸ not finished | stopped by user request mid-run 1 (at `lint`) |

## Memory findings (feed Step 1.7)

- Cold build at the template's 8 GB heap ceiling: OOM 2 of 4. At 4 GB: 4 of 4 isolated cold builds passed, but 1 of 2 cold builds inside a full `yarn ci` OOMed. The V8 cap is not the whole story.
- Next 16.3.6 runs Turbopack's compile in a build worker and only awaits its `shutdownPromise` at the very end of `next build` (`node_modules/next/dist/build/index.js`), while `turbopackFileSystemCacheForBuild` (default `true`) keeps writing the build cache ("Finished writing to filesystem cache in 32s"). Native compiler memory therefore overlaps page-data collection and static generation.
- Candidates for 1.7, in order: (1) `experimental.turbopackFileSystemCacheForBuild: false` when `OM_SKIP_NEXT_BUILD_TYPECHECK=1` (CI cannot reuse the cache anyway); (2) `NEXT_TURBOPACK_USE_WORKER=0` for the build step; (3) lower build heap (3072). Accept a fix only after ≥3 fully cold `yarn ci` runs (delete `.mercato/next` and `tsconfig.tsbuildinfo`) with `oom_kill=0`.
- Measurement method: `checkpoint-1-artifacts/measure-step.sh`. Docker cannot hide host cores from `os.cpus()`; a real 2-vCPU runner gets 1 Next worker, so patch the scratch app's `next.config.ts` with `experimental.cpus: 1` behind an env flag when measuring on a big host.

## UI verification

Skipped — the change ships no UI (template scripts, workflow files, CLI flag, docs).
