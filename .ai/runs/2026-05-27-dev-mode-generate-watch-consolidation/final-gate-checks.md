# Final gate — 2026-05-27 dev-mode-generate-watch-consolidation

**Branch:** `fix/dev-mode-generate-watch-consolidation`
**Step range:** 1.1 → 4.1 (six commits + final gate)
**Run folder:** `.ai/runs/2026-05-27-dev-mode-generate-watch-consolidation/`

## Validation checks run in this sandbox

| Check | Status | Notes |
|---|---|---|
| `yarn install --mode=skip-build` | ✅ | Completed in ~14 s after the soft reset. |
| `yarn workspace @open-mercato/cli build` | ✅ | 73 entry points. |
| `yarn workspace @open-mercato/cli typecheck` | ✅ | Clean (exit 0, no output). |
| `yarn workspace @open-mercato/cli test` | ✅ | 41 suites, **889 tests passed**. |
| `yarn build:packages` | ✅ | 19 successful, full turbo cache hit. |
| `node scripts/profile-generate-watch-rss.mjs --warmup-ms=8000` | ✅ | Reported **180.1 MB** standalone watcher RSS — captured at `profile-output.txt`. |
| Smoke test: `mercato generate watch --skip-initial --quiet` standalone CLI | ✅ | Started, idled for 4 s, responded to SIGINT cleanly (exit 0). |

## Checks deferred to CI / a local dev workstation

The janitor sandbox cannot reliably boot `next dev --turbopack` end-to-end against the full app (Node-24 JSON import-attribute friction on the test path). These gates are deferred to the project CI:

| Check | Reason |
|---|---|
| `yarn typecheck` (full monorepo) | Same JSON-import friction blocks the test path. CI runs the canonical monorepo typecheck. |
| `yarn test` (full monorepo) | `@open-mercato/content` and `@open-mercato/ui` fail with `React.act is not a function` in this sandbox — a test-environment React/Testing-Library version mismatch that exists on `develop` too, unrelated to this PR. CI runs against the canonical environment. |
| `yarn build:app` | Requires the full Next.js dev/build pipeline. CI verifies. |
| `yarn test:integration` | Requires the ephemeral Docker stack. CI runs Playwright. |
| `yarn test:create-app:integration` | Requires Verdaccio + a clean scaffold. CI runs the standalone parity flow. |

## Backward-compatibility self-review

- `BACKWARD_COMPATIBILITY.md` surfaces NOT touched:
  - No auto-discovery paths changed.
  - No type, signature, or import path changes (the new helper exports a NEW surface; nothing previously exported was renamed or removed).
  - No event IDs, widget spot IDs, ACL features, notification IDs, CLI commands, DI keys, or generated-file shapes touched.
  - `mercato generate watch` CLI command still works (refactored internally to use the helper; behavior 1:1 with the legacy infinite loop).
  - No DB schema changes.
- Opt-out path documented: `OM_DEV_GENERATE_WATCH_MODE=legacy` restores the prior out-of-process sidecar behavior in `apps/mercato/scripts/dev.mjs`, `packages/create-app/template/scripts/dev-runtime.mjs`, and `mercato server dev`.

## ds-guardian

No UI files were touched in this PR (it is a dev-runtime / CLI consolidation). No design-system migrations applicable.

## Residual risk

- A single-process dev server is technically more sensitive to a generator-suite stall than two cooperating processes. Mitigated by (a) keeping generator errors logged + recoverable (not fatal), (b) `setTimeout.unref()` on the polling timer, (c) `OM_DEV_GENERATE_WATCH_MODE=legacy` escape hatch.
- The measured ~190 MB savings is below the user-requested "1-2 GB" floor. PR body explains this honestly and lists the follow-up candidates (`serverExternalPackages`, per-queue worker consolidation, ClientBootstrap registry slimming) needed to close that gap.
