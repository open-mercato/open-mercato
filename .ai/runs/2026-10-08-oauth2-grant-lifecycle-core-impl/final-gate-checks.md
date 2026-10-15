# Final gate — Steps 1.1..6.1

- **Scope:** the whole plan (P1a–P6), the review fixes and the public-surface trim, rebased onto `develop` @ `e2712c8b0`, plus the follow-up commit that records the maintainer decisions
- **Runner:** local (no compose `app` container); fork CI waits for a maintainer to approve the workflow runs

## Validation gate (`validation.commands`)

| Check | Result |
|---|---|
| `yarn build:packages` | ✅ pass |
| `yarn generate` | ✅ pass, no tracked file changed |
| `yarn build:packages` | ✅ pass |
| `yarn i18n:check-sync` | ✅ pass |
| `yarn i18n:check-usage` | ✅ pass (advisory unused keys only) |
| `yarn typecheck` | ✅ pass |
| `yarn test` | ✅ every test that ran passed (core 22,732, shared 2,794, cli 2,070, ui 2,650, enterprise 2,005); see notes |
| `yarn build:app` | ✅ pass |

Notes on `yarn test`:
- `create-mercato-app` `compatibility-context-budget`: the new `BACKWARD_COMPATIBILITY.md` section pushed the five harness cases that include it over `maxTotalContextBytes`; `packages/create-app/agentic/shared/ai/harness/cases.json` raises them to the next 4 KiB step (OMH-007, OMH-030, OMH-064 → 122880; OMH-022 → 110592; OMH-057 → 114688), as upstream does for BC growth; the suite passes after the change.
- `open-mercato-docs#test` runs out of heap under the root script's `--max-old-space-size=1024`; `develop` without this change does the same when run alone at that limit, and with the default heap, as the CI `turbo run test` step runs it, the suite passes.
- `channel-resend` `lib/__tests__/health.test.ts` and `cli` `generators/__tests__/module-facts.customers.fixture.test.ts` hit local jest-worker crashes (SIGSEGV); each passes when run alone (2/2, 5/5) and this change touches neither.

## Additional checks

| Check | Result |
|---|---|
| `yarn workspace @open-mercato/shared test:pg-integration` | ✅ 8 passed |
| `yarn workspace @open-mercato/core test:pg-integration` | ✅ 6 suites, 178 passed |
| `node scripts/check-oauth-publish-shape.mjs` | ✅ all 13 published import paths resolve to built files |
| `eslint` on the changed files | ✅ pass |
| `yarn agents:check-budget` | ✅ pass |
| `yarn template:sync` | ✅ in sync |
| Integration suite: `TC-INT-OAUTH-001/002` on a fresh ephemeral app | ✅ 6 passed |
| Consumer gate (App Spec Q7): #7337 stacked on this commit | ✅ each of its 17 commits passes `sync-xero`'s tests (359 at the head); its validation list and TC-XERO-001..005 with TC-INT-OAUTH (12) pass; Verdaccio smoke: this branch's packages published to a local registry, a scaffolded app with `sync_xero` enabled installs, generates, typechecks and builds, and the 12 Playwright tests pass against it; with the template's default `modules.ts` no TC-XERO spec is discovered |
| Full Playwright suite | ⏭️ not run locally; the integration job runs it once the fork's workflow runs are approved |
| Style-compliance pass (`om-ds-guardian`) | ✅ compliant; its minor finding (focus ring on the banner link) is fixed in Step 5.1-ds-fix |
| Local `om-code-review` (two independent passes) | ✅ no blocker or major; the minors are fixed in this commit, the rest listed below |
| Maintainer decisions | ✅ App Spec Q3 and Q7 decided on 2026-10-15 (surface and CI steps approved as proposed; Option B with the consumer gate) |

Open nits (non-blocking): a follower of a concurrent `client_misconfigured` refresh sees `reason: null`; a test-route injection can outlive a `refresh` that made no token call; a provider whose `expires_in` is below `refreshSkewMs` refreshes on every call; the publish-shape script has no self-test.
