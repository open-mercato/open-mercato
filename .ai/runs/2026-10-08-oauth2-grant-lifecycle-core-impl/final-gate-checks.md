# Final gate — Steps 1.1..6.1

- **Scope:** the whole plan (P1a–P6), the review fixes and the public-surface trim, merged with `develop` @ `4acf199f7`, plus the fixes from the maintainer review of 2026-10-20 (gated at `b9644390b`)
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
| `yarn test` | ✅ every test this change touches passed (core 23,085, shared 2,817, cli 2,075, ui 2,662, enterprise 2,005); see notes |
| `yarn build:app` | ✅ pass |

Notes on `yarn test`:
- `create-mercato-app`: 908 passed, 0 failed. The new `BACKWARD_COMPATIBILITY.md` section pushed the five harness cases that include it over `maxTotalContextBytes`; `packages/create-app/agentic/shared/ai/harness/cases.json` raises each to the smallest 4 KiB step that fits (OMH-007, OMH-064 → 122880; OMH-030 → 126976; OMH-022 → 110592; OMH-057 → 114688).
- `open-mercato-docs#test` runs out of heap under the root script's `--max-old-space-size=1024`; `develop` without this change does the same when run alone at that limit, and with the default heap, as the CI `turbo run test` step runs it, the suite passes.
- `web-research-browser` `src/__tests__/egressProxy.test.ts` ("tears down live tunnels on close", from `develop`) fails locally on a socket-teardown race in 3 of 4 runs alone; this change does not touch the package.

## Additional checks

| Check | Result |
|---|---|
| `yarn workspace @open-mercato/shared test:pg-integration` | ✅ 8 passed |
| `yarn workspace @open-mercato/core test:pg-integration` | ✅ 6 suites, 185 passed |
| `node scripts/check-oauth-publish-shape.mjs` | ✅ all 13 published import paths resolve to built files with a source in `src` |
| `yarn test:scripts` (includes the publish-shape self-test) | ✅ pass |
| `eslint` on the changed files | ✅ pass |
| `yarn agents:check-budget` | ✅ pass |
| `yarn template:sync` | ✅ in sync |
| Integration suite: `TC-INT-OAUTH-001/002` on a fresh ephemeral app | ✅ 6 passed |
| Consumer gate (App Spec Q7): #7337 on this branch before the 2026-10-20 review fixes (`112ed7934`) | ✅ each of its 17 commits passes `sync-xero`'s tests (359 at the head); its validation list and TC-XERO-001..005 with TC-INT-OAUTH (12) pass; Verdaccio smoke: this branch's packages published to a local registry, a scaffolded app with `sync_xero` enabled installs, generates, typechecks and builds, and the 12 Playwright tests pass against it; with the template's default `modules.ts` no TC-XERO spec is discovered |
| Full Playwright suite (CI on `74a17c95d`) | ⚠️ every shard passed except `ephemeral-integration (9/15)`: `TC-FORMS-UI-001/002` (`forms`, untouched), tracked in #7551 |
| Style-compliance pass (`om-ds-guardian`) | ✅ compliant; its minor finding (focus ring on the banner link) is fixed in Step 5.1-ds-fix |
| Local `om-code-review` (two independent passes) | ✅ no blocker or major; the minors are fixed |
| Maintainer review (2026-10-20) | ✅ every finding fixed: the refresh commit with an unknown outcome, the refresh margin for short-lived tokens, the follower's `client_misconfigured` reason, the nullable `oauthGrant` wording, the two-tenant test, the publish-shape self-test and the unconsumed fake-server injection |
| Maintainer decisions | ✅ App Spec Q3 and Q7 decided on 2026-10-15 (surface and CI steps approved as proposed; Option B with the consumer gate) |

