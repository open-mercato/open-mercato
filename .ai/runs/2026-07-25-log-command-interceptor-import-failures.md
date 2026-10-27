# Log command-interceptor registry import failures (#4491)

## Goal

Make the CLI/worker bootstrap loader (`packages/shared/src/lib/bootstrap/dynamicLoader.ts`) emit a
clear error when an optional generated registry — above all
`command-interceptors.generated.ts` — exists but fails to compile or import, instead of silently
degrading to an empty entry list. The compatibility fallback for a genuinely absent file must stay
silent, so a fresh app without the generated file keeps booting exactly as it does today.

## Scope

- `packages/shared/src/lib/bootstrap/dynamicLoader.ts` — distinguish "generated file absent" from
  "generated file present but broken", log the latter through the shared logging facade, keep the
  empty-array fallback in both cases.
- `packages/shared/src/lib/bootstrap/__tests__/dynamicLoader.commandInterceptors.test.ts` —
  regression coverage that separates the expected-missing case from the unexpected-failure case.

### Non-goals

- No change to the failure mode itself: a broken registry still falls back to an empty list rather
  than aborting bootstrap. Turning this into a hard failure is a behavior change the issue does not
  ask for and would risk breaking existing deployments.
- No changes to `factory.ts`, the command interceptor registry, or the Next.js runtime loader.
- No changes to the required generated files (`modules.cli`, `entities`, `di`, `entities.ids`) —
  those already throw.

## Implementation Plan

### Phase 1: Distinguish and log registry load failures

Introduce a `GeneratedFileNotFoundError` thrown by `compileAndImport` when the `.ts` source is
absent, plus a `loadOptionalGeneratedModule` helper that returns the fallback for that error and
logs `logger.error` with the file path and the underlying error for anything else. Route the four
optional registries (`search`, `command-loaders`, `command-interceptors`, `workflows`) through it so
the same blindness cannot recur for any of them.

### Phase 2: Regression coverage

Extend the existing bootstrap test so it asserts three distinct behaviors: entries load when the
registry is valid; an absent file falls back quietly; a present-but-unimportable file falls back
*and* logs an error naming the file.

### Phase 3: Validation gate

Run the configured `validation.commands` gate and fix anything it surfaces.

## Risks

- Low. The change is additive diagnostics inside one loader; the returned `BootstrapData` shape and
  the fallback values are unchanged.
- The logger is imported at bootstrap-loader scope; it is already used elsewhere in
  `packages/shared/src/lib` (for example `encryption/entityIds.ts`, which this same file imports),
  so no new dependency direction is introduced.

## Progress

PR: #4505

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Distinguish and log registry load failures

- [x] 1.1 Add `GeneratedFileNotFoundError` and the `loadOptionalGeneratedModule` helper — 914963321
- [x] 1.2 Route the optional generated registries through the helper — 914963321

### Phase 2: Regression coverage

- [x] 2.1 Cover missing-file fallback vs. logged compile/import failure — 914963321

### Phase 3: Validation gate

- [x] 3.1 Run the full validation gate and resolve findings

Runner: local. `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`,
`yarn i18n:check-usage`, `yarn typecheck`, `yarn test` (23/23 workspaces, core alone 7850 tests) and
`yarn build:app` all pass. The first `yarn test` run hit a flake in
`@open-mercato/scheduler` (one suite aborted mid-run under parallel load, 321/327 tests reported);
it passes standalone (16 suites / 327 tests) and on the immediate re-run of the full gate, and no
scheduler code is touched by this change.

### Phase 4: Review findings

- [x] 4.1 Keep `GeneratedFileNotFoundError` internal — drop the `export` so the diagnostics fix adds
  no shared public type (review finding r3650721984, Medium) — 1add4fc8b

### Phase 5: CI

- [x] 5.1 Clear the `ephemeral-integration (3/15)` red check on head `30c9d5215`

The failure was a docker-registry image pull timing out
(`(HTTP code 500) server error - Get "https://registry-1.docker.io/v2/": net/http: request canceled`),
not a test assertion, so it needs a fresh run rather than a code change. `gh run rerun --failed` is
unavailable to this account (`Must have admin rights to Repository`), which leaves a push as the only
lever.

An earlier pass deferred that push, reasoning that merging current `develop` first would inherit the
red `i18n:check-usage` that #4147 introduced (fixed by #4608). That reasoning was wrong on the point
that mattered: `.github/workflows/ci.yml:468-469` runs `yarn i18n:check-usage` with
`continue-on-error: true`, so a base-inherited i18n regression never fails the GitHub job — it only
fails the local `validation.commands` gate, where every non-zero exit counts. This resume therefore
pushes **without** merging the base: the tree stays free of the unrelated i18n regression, the local
gate result recorded in Phase 3 still describes the pushed bytes, and CI re-runs clean of the flake.

### Phase 6: Base merge

- [x] 6.1 Merge `upstream/develop` and re-run the full gate

The Phase 5 push did clear the docker-registry flake, but the next run went red on
`ephemeral-integration (11/15)`: `TC-PLAN-005-ruleset-prefill` timed out at 20s on both attempts and
`TC-RESO-009` failed once then passed on retry. Neither touches this change. The branch was 162
commits behind by then, and the contemporaneous `develop` run (`4efa7961c`, WMS #4566) was green on
all 15 shards — so the failure lived in the stale base, not in the diff, and skipping the base merge
had stopped being the cheaper option.

The merge also had to happen for a second reason: #4540 landed the follow-up below in `develop` and
edits the same function. The merge is clean and the two changes compose as intended —
`compileAndImport` now `return await import(fileUrl)`, so a broken optional registry first goes
through `recoverMikroOrmV7GeneratedCacheFromImportError`, and only a non-applicable recovery
re-throws into `loadOptionalGeneratedModule`, which still logs it and falls back.
`GeneratedFileNotFoundError` survives the merge unexported, so the Phase 4 review fix still holds.

Gate on the merge result, runner: local. `yarn build:packages` (×2), `yarn generate` (no tracked-file
churn), `yarn i18n:check-sync`, `yarn typecheck`, `yarn build:app` — pass. Two non-blocking results:

- `yarn i18n:check-usage` reports the same 2 keys from #4147 (`ui.customFields.phone.defaultCountry`,
  `…defaultCountryAuto`) that this branch does not touch — base-inherited, tracked as #4607/#4608,
  and `continue-on-error: true` in CI.
- `yarn test` lost one `@open-mercato/enterprise` suite to
  `a jest worker process was terminated … signal=SIGSEGV` under parallel load — the same class of
  flake the Phase 3 run hit in `@open-mercato/scheduler`. Standalone the workspace is 57/57 suites
  and 462/462 tests green, and `packages/shared/src/lib/bootstrap/__tests__/` is 4/4 suites and 19/19
  tests green, which is where both this change and #4540's regression coverage live.

## Follow-up observed while working — tracked as #4526, fixed on `develop` by #4540

`compileAndImport` did `return import(fileUrl)` inside its `try`, so the promise was not awaited and
the `catch` that calls `recoverMikroOrmV7GeneratedCacheFromImportError` never saw an import-time
rejection — exactly the `does not provide an export named 'Entity'` case that recovery exists for.
Adding the missing `await` re-arms a recovery path that deletes stale generated cache files, so it
was a behavior change that belonged in its own issue rather than inside this diagnostics fix. #4540
shipped it; Phase 6 merged it in.
