# Clear the high-severity audit gate on `develop`

**Status:** complete
**Engine:** om-auto-create-pr (steps: 8, --loop: no)
**Base:** `develop` @ `a575bebce`
**Closes:** #4929

## Goal

Make `node scripts/audit-ci.mjs --severity high` exit 0 on `develop` again by bumping the six advisory-affected transitive dependencies, so the `audit` CI job stops skipping the whole downstream half of the pipeline for every dependency-touching PR.

## Context

Six high-severity advisories landed on `develop`'s dependency graph overnight. The scheduled audit run [`30804372054`](https://github.com/open-mercato/open-mercato/actions/runs/30804372054) reported `Audit develop` = success at **2026-08-03 10:08 UTC**; the PR-triggered `audit` on #4391 found all six at **2026-08-04 05:02 UTC**. They were published inside that window — this is a fresh batch, not accumulated drift.

| Package | Locked | Advisory range | Fixed in | Advisory |
|---|---|---|---|---|
| `brace-expansion` | 5.0.8 | `>=4.0.0 <5.0.9` | 5.0.9 | [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) |
| `fast-uri` | 3.1.4 | `>=3.0.0 <3.1.5` | 3.1.5 | [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7) |
| `ip-address` | 10.1.1 | `<=10.3.0` | 10.4.0 | [GHSA-mwp4-54f8-5fhr](https://github.com/advisories/GHSA-mwp4-54f8-5fhr) |
| `socket.io-parser` | 4.2.6 | `>=4.0.0 <4.2.7` | 4.2.7 | [GHSA-2m8v-j782-fhvr](https://github.com/advisories/GHSA-2m8v-j782-fhvr) |
| `undici` (`^7.12.0`, `^7.16.0`) | 7.28.0 | `>=7.0.0 <7.29.0` | 7.29.0 | [GHSA-4cwx-7wf7-3272](https://github.com/advisories/GHSA-4cwx-7wf7-3272) |
| `undici` (`^8.5.0`) | 8.8.0 | `>=8.0.0 <8.9.0` | 8.9.0 | [GHSA-4cwx-7wf7-3272](https://github.com/advisories/GHSA-4cwx-7wf7-3272) |

Two `undici` descriptor groups (`^7.19.1, ^7.28.0` at 7.29.0 and `^8.9.0` at 8.9.0) are already on fixed versions; the bump should dedupe them rather than add a third resolution.

**Revised during Phase 1.** The change is *not* lockfile-only. Root `package.json` carries a `resolutions` block that pins `brace-expansion`, `fast-uri`, `ip-address` and `socket.io-parser` to exactly the affected versions, so no range bump could reach a fix — the pins themselves are the fix surface. Three `undici` descriptors (`^7.12.0`, `^7.16.0`, `^8.5.0`) had no pin covering them and were resolving below the fixed versions, so they gained pins alongside the existing `undici` entries. No workspace manifest is touched.

## Scope

- `yarn.lock` — bump the five packages to the first fixed version their existing ranges allow.
- Workspace manifests — only if a range genuinely cannot reach a fixed version. Not expected; must be justified in the PR body if it happens.

## Non-goals

- **Not** touching `scripts/audit-ci.mjs` thresholds, adding advisory ignores/allowlists, or otherwise weakening the gate. The gate must go green because the graph is fixed.
- **Not** changing `.github/workflows/audit.yml`. It already runs a `develop` + `main` matrix; the only gap is timing (a PR can trip the gate between advisory publication and the next scheduled scan), which no workflow edit fixes.
- **Not** fixing the pre-existing failures listed under Risks — they are baseline on `develop` and out of scope here.
- **Not** upgrading anything beyond what the advisories require (e.g. `fast-uri` 4.x when 3.1.5 clears the advisory).

## Implementation Plan

### Phase 1: Reproduce and pin the fix set

- 1.1 Reproduce `audit-ci --severity high` failing on clean `develop`, capture the exact advisory set.
- 1.2 Confirm every fixed version is reachable inside the existing declared ranges (no manifest bump required).

### Phase 2: Bump the graph

- 2.1 Bump the five packages in `yarn.lock` to their first fixed version.
- 2.2 Verify `audit-ci --severity high` exits 0 and that the lockfile diff is resolution changes only — no manifest edits, no unrelated churn.

### Phase 3: Validate

- 3.1 Run the full `validation.commands` gate on the result.
- 3.2 Diff the gate outcome against the documented `develop` baseline so any genuine regression is separable from pre-existing noise.

### Phase 4: Ship

- 4.1 Write the PR body: advisory table, the `#4924` relationship, the baseline, and `Closes #4929`.
- 4.2 Report the requested label set (the account has no `triage` permission, so labels cannot be applied).

## Risks

- **A lockfile bump can move behaviour anywhere in the monorepo.** `undici` is the HTTP client under fetch-based code paths and `socket.io-parser` sits under the realtime transport, so the full gate — not a scoped subset — is the only meaningful check. Mitigated by Phase 3.
- **Overlap with Dependabot #4924** (`undici` 8.8.0 → 8.9.0). **Resolved:** #4924 is a no-op on the current base (`develop` already declares `undici: ^8.9.0` in `packages/shared`) and its diff leaves the `^8.5.0` descriptor group untouched, so it would not have cleared the advisory. Called out in the PR body with a suggestion to close it as superseded.
- **A newer advisory batch may land mid-run.** The gate is evaluated against the live advisory database, so a green local run can go red on CI minutes later. Re-check on CI rather than trusting the local result alone.
- **Known-baseline failures on clean `develop` @ `3f6d307d0`** (verified against upstream run [`30853472008`](https://github.com/open-mercato/open-mercato/actions/runs/30853472008) and a local run) — must NOT be treated as regressions from this change:
  - `yarn test` — 5 failures in `apps/mercato/src/__tests__/storage-s3-routes.test.ts` (`storage_s3 upload/download routes …`, `[Bootstrap] Modules not registered`).
  - `yarn i18n:check-usage` — 21 missing keys, all in `packages/core/src/modules/design_system/gallery/*` and `packages/ui/src/backend/schedule/*`. Advisory; CI `lint` passes.
  - `apps/docs` search-index test requires a docs production build artifact and fails locally without one.

## Progress

PR: #4930

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Reproduce and pin the fix set

- [x] 1.1 Reproduce the audit failure on clean `develop` and capture the advisory set — reproduced on `a575bebce`, 6 advisories
- [x] 1.2 Confirm every fix is reachable inside existing declared ranges — **revised finding:** four packages were pinned by root `resolutions` to exactly the affected version, so the pins had to move; a range-only bump could never have reached the fix

### Phase 2: Bump the graph

- [x] 2.1 Bump the five packages to their first fixed version — root `resolutions` + regenerated lock — e49d80898
- [x] 2.2 Verify `audit-ci --severity high` exits 0 and the diff is resolutions-only — 0 advisories; diff is root `package.json` resolutions + `yarn.lock` (+18/-32), no workspace manifest touched — e49d80898

### Phase 3: Validate

- [x] 3.1 Run the full validation gate — all 8 commands run; `build:packages`/`generate`/`typecheck`/`i18n:check-sync`/`build:app` green, no drift after `generate`
- [x] 3.2 Separate genuine regressions from the documented baseline — `yarn test` 5 failures and `i18n:check-usage` 21 missing keys are byte-identical to the baseline (key list diffed); zero new failures

### Phase 4: Ship

- [x] 4.1 Write the PR body with the advisory table, #4924 relationship and baseline — PR #4930
- [x] 4.2 Report the requested label set — all six label writes returned 403; requested set documented in the PR body
