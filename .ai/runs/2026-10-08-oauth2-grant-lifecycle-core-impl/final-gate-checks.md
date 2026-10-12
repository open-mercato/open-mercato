# Final gate — Steps 1.1..6.1

- **Scope:** the whole plan (P1a–P6), the review fixes and the public-surface trim, as one commit on `develop` @ `28ca93ed9`
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
| `yarn test` | ✅ every test that ran passed (core 22,486, shared 2,769, cli 2,042, ui 2,599, enterprise 2,005); see notes |
| `yarn build:app` | ✅ pass |

Notes on `yarn test`:
- `create-mercato-app` `compatibility-context-budget`: the new `BACKWARD_COMPATIBILITY.md` section pushed the five harness cases that include it over `maxTotalContextBytes`; `packages/create-app/agentic/shared/ai/harness/cases.json` raises them to the next 4 KiB step (OMH-007, OMH-030, OMH-064 → 122880; OMH-022 → 110592; OMH-057 → 114688), as upstream does for BC growth; the suite passes after the change.
- `open-mercato-docs#test` ran out of heap under the root script's `--max-old-space-size=1024`. `develop` @ `28ca93ed9` without this change does the same when run alone at that limit; with the default heap, as the CI `turbo run test` step runs it, the suite passes (23/23).
- `staff/commands/__tests__/timesheets-reports.test.ts` hit a local jest-worker crash (SIGSEGV); it passes when run alone (29/29) and this change does not touch it.

## Additional checks

| Check | Result |
|---|---|
| `yarn workspace @open-mercato/shared test:pg-integration` | ✅ 8 passed |
| `yarn workspace @open-mercato/core test:pg-integration` | ✅ 6 suites, 178 passed |
| `node scripts/check-oauth-publish-shape.mjs` | ✅ all 13 published import paths resolve to built files |
| `eslint` on the changed files | ✅ pass |
| `yarn agents:check-budget` | ✅ pass |
| Integration suite: `TC-INT-OAUTH-001/002` on a fresh ephemeral app | ✅ 6 passed |
| Full Playwright suite | ⏭️ not run locally; the integration job runs it once the fork's workflow runs are approved |
| Style-compliance pass (`om-ds-guardian`) | ✅ compliant; its minor finding (focus ring on the banner link) is fixed in Step 5.1-ds-fix |
| Local `om-code-review` (two independent passes) | ✅ no blocker or major; the minors are fixed in this commit, the rest listed below |

Open nits (non-blocking): a follower of a concurrent `client_misconfigured` refresh sees `reason: null`; a test-route injection can outlive a `refresh` that made no token call; a provider whose `expires_in` is below `refreshSkewMs` refreshes on every call; the publish-shape script has no self-test.
