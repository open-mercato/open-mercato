# Checkpoint 2 — Steps 1.7..3.2 (re-runs checkpoint 1)

**Result:** ✅ PASSED
**Recorded:** 2026-10-09
**Runner:** local mode (no compose `app` container). Host macOS 24 GB / 8 cores, Node 24.19.0. Capped runs in a colima VM (4 vCPU, 12 GB, vz + virtiofs) with `checkpoint-1-artifacts/measure-step.sh` plus `--network host` (Verdaccio on the VM's localhost) and `node:24.20.0-trixie`. Dependencies installed inside the container (the host's darwin native binaries do not run in Linux).

## Step 1.7 — cold `yarn ci` under 7 GB / 2 vCPU

Each run deletes `.mercato/next` and `tsconfig.tsbuildinfo` first. Next build workers pinned to 1, as on a 2-vCPU runner (`experimental.cpus: 1` behind an env flag in the scratch app, or `CIRCLE_NODE_TOTAL=2`).

| Run | Turbopack build cache | Result | Wall | cgroup peak | oom_kill |
|---|---|---|---|---|---|
| fix-1 | off (template fix) | pass | 222 s | 7,168 MiB | 0 |
| fix-2 | off | pass | 226 s | 7,020 MiB | 0 |
| fix-3 | off | pass | 217 s | 6,897 MiB | 0 |
| fix-4 (`CIRCLE_NODE_TOTAL=2`, no config patch) | off | pass | 233 s | 7,168 MiB | 0 |
| e2e (published scaffold, `CIRCLE_NODE_TOTAL=2`) | off | pass | 215 s | 7,014 MiB | 0 |
| baseline-1 | on (Next default) | OOM-killed | 270 s | 7,168 MiB | 2 |
| baseline-2 | on | OOM-killed | 208 s | 7,168 MiB | 2 |

Peak includes reclaimable page cache; `oom_kill` is the failure signal. Fixed runs log no "writing to filesystem cache" line.

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn pack --dry-run` in `packages/create-app` | ✅ | Found at resume: `template/.github` was silently dropped by `yarn pack`, so the published package shipped no workflows. Step 1.8 moved them to `template/github/`; the tarball now lists both. |
| Published scaffold (`npx create-mercato-app@0.8.0` from Verdaccio, clean npm cache, `--agents all`) | ✅ | `.github/workflows/{ci,integration}.yml` next to Copilot's `.github/*`; no stray `github/`; summary line names both |
| `node scripts/ci.mjs --check-lockfile` before / after `yarn install` | ✅ exit 1 / exit 0 | `grep -c 'localhost%3A4873' yarn.lock` = 0 |
| `yarn test:integration:ephemeral --app-only`, fresh app | ✅ exit 0 in 2 s | prints `No app-owned integration specs found`, no Docker needed |
| same, with one spec in `src/modules/<module>/__integration__/` | ✅ | `running 1 app-owned spec file(s)`, then needs Docker (none in the container). Full run is the Q12 manual follow-up |
| create-app tests: `ci-flag`, `template-ci-workflows`, `workflows-ownership`, `template-build-memory`, `template-ci-script` | ✅ 36/36 | |
| cli `src/lib/testing/__tests__/` | ✅ 71/71 | |
| `scripts/__tests__/preview-workflows.test.mjs` | ✅ 7/7 | needs a short `TMPDIR` (tsx IPC pipe path length) |

## Pitfall

A same-version republish (`0.8.0`) is shadowed by Yarn's global cache and npx's cache. Clear `@open-mercato-*` zips from the Yarn cache and use a fresh `npm --cache`, or the scaffold silently runs the previous build.

## UI verification

Skipped — the change ships no UI.
