# Forms → core: integration-test landscape + suite design

**Status:** investigation / design document. No tests authored here.
**Worktree:** `cez/6845f2cc` (fork of `cez/c82a4a14`)
**Subject:** `packages/core/src/modules/forms/` — vendored from `open-mercato/official-modules`
(`packages/forms/src/modules/forms`, source commit `d694a75`). Ships ~65 jest unit tests and
**zero** integration tests.

Two parts:

- **Part 1** maps this repo's integration-test harness, its CI shard selection, and the complete
  reusable fixture/helper surface, with evidence from a real run in this worktree.
- **Part 2** designs the forms integration suite as a P0/P1/P2 test-case table.

Everything here was read out of this worktree at the commit above. Route paths in Part 2 come
from the **generated registry** (`apps/mercato/.mercato/generated/api-route-metadata.generated.ts`),
not from the route files' own docstrings — see §2.1, where those two disagree.

## Headline

- **The harness works.** Proven in this worktree: `TC-DICT-001` passes end to end through
  `yarn test:integration:ephemeral` (§1.7). It took three attempts; two prerequisites are
  undocumented — build packages first, and export a real `JWT_SECRET`.
- **The forms PR's integration shard is currently green on nothing** (F-11). With
  `OM_INTEGRATION_MODULES=forms` the config discovers zero specs and falls back to a sentinel that
  asserts `expect(true).toBe(true)`. ~300 files and ~50 API routes land behind a placeholder pass.
- **93 test cases designed** across ten areas — 42 P0, 41 P1, 10 P2 (§2.4, §2.5) — plus two more
  explicitly ruled out as browser-QA-only, and a proposed shared fixture module (§2.3).
- **The requested optimistic-locking 409 cases cannot be written.** The module implements no
  optimistic locking at all (§2.2, F-6). The closest testable analogue — `base_revision_id` →
  `STALE_BASE` 409 on submission autosave — is in the plan as a P0 case.
- **Eleven findings** surfaced while mapping (§2.7). Four are worth acting on before merge:
  a doubled `/api/forms/forms/subjects/…` route prefix (F-1), an unauthenticated **and unscoped**
  `GET /api/forms/[id]/run/context` (F-2), route-layer Zod errors leaking as **500** against each
  route's own OpenAPI contract (F-9), and the missing optimistic locking (F-6).

---

# Part 1 — The harness

## 1.1 Where integration tests live

Executable Playwright specs live in **module-local `__integration__/` folders**, never under
`.ai/qa/tests` (that directory holds the shared Playwright config only — `.ai/qa/AGENTS.md`
§ Never).

```
packages/<package>/src/modules/<module>/__integration__/TC-<CATEGORY>-<NNN>[-slug].spec.ts
apps/mercato/src/modules/<module>/__integration__/…
packages/enterprise/src/modules/<module>/__integration__/…          (overlay tests)
packages/create-app/template/src/modules/<module>/__integration__/… (excluded from this runner)
```

69 such directories exist today. `packages/core/src/modules/` alone carries 40:

```
$ find packages apps -type d -name "__integration__" -not -path "*/node_modules/*" | sort
apps/mercato/src/modules/example/__integration__
apps/mercato/src/modules/ratelimit_probe/__integration__
packages/ai-assistant/src/modules/ai_assistant/__integration__
packages/channel-apns/src/modules/channel_apns/__integration__
packages/channel-discord/src/modules/channel_discord/__integration__
packages/channel-expo/src/modules/channel_expo/__integration__
packages/channel-fcm/src/modules/channel_fcm/__integration__
packages/channel-gmail/src/modules/channel_gmail/__integration__
packages/channel-imap/src/modules/channel_imap/__integration__
packages/checkout/src/modules/checkout/__integration__
packages/cli/src/lib/deploy/railway/__integration__
packages/cli/src/lib/__integration__
packages/core/src/modules/api_keys/__integration__
packages/core/src/modules/attachments/__integration__
packages/core/src/modules/audit_logs/__integration__
packages/core/src/modules/auth/__integration__
packages/core/src/modules/business_rules/__integration__
packages/core/src/modules/catalog/__integration__
packages/core/src/modules/communication_channels/__integration__
packages/core/src/modules/communication_channels/workers/__integration__
packages/core/src/modules/configs/__integration__
packages/core/src/modules/core/__integration__
packages/core/src/modules/currencies/__integration__
packages/core/src/modules/customer_accounts/__integration__
packages/core/src/modules/customers/__integration__
packages/core/src/modules/dashboards/__integration__
packages/core/src/modules/data_sync/__integration__
packages/core/src/modules/design_system/__integration__
packages/core/src/modules/devices/__integration__
packages/core/src/modules/dictionaries/__integration__
packages/core/src/modules/directory/__integration__
packages/core/src/modules/entities/__integration__
packages/core/src/modules/eudr/__integration__
packages/core/src/modules/feature_toggles/__integration__
packages/core/src/modules/inbox_ops/__integration__
packages/core/src/modules/integrations/__integration__
packages/core/src/modules/messages/__integration__
packages/core/src/modules/notifications/__integration__
packages/core/src/modules/payment_gateways/__integration__
packages/core/src/modules/perspectives/__integration__
packages/core/src/modules/phone_calls/__integration__
packages/core/src/modules/planner/__integration__
packages/core/src/modules/portal/__integration__
packages/core/src/modules/progress/__integration__
packages/core/src/modules/push_notifications/__integration__
packages/core/src/modules/query_index/__integration__
packages/core/src/modules/resources/__integration__
packages/core/src/modules/sales/__integration__
packages/core/src/modules/shipping_carriers/__integration__
packages/core/src/modules/staff/__integration__
packages/core/src/modules/sync_excel/__integration__
packages/core/src/modules/translations/__integration__
packages/core/src/modules/warranty_claims/__integration__
packages/core/src/modules/wms/__integration__
packages/core/src/modules/workflows/__integration__
packages/create-app/template/src/modules/example/__integration__
packages/create-app/template/src/modules/ratelimit_probe/__integration__
packages/documents/src/modules/documents/__integration__
packages/enterprise/src/modules/agent_orchestrator/__integration__
packages/enterprise/src/modules/record_locks/__integration__
packages/enterprise/src/modules/security/__integration__
packages/enterprise/src/modules/sso/__integration__
packages/onboarding/src/modules/onboarding/__integration__
packages/scheduler/src/modules/scheduler/__integration__
packages/search/src/modules/search/__integration__
packages/telemetry/src/modules/telemetry/__integration__
packages/tillio/src/modules/tillio/__integration__
packages/ui/__integration__
packages/webhooks/src/modules/webhooks/__integration__
```

**`packages/core/src/modules/forms/__integration__` does not exist** — this is the gap.

**Naming.** `TC-{CATEGORY}-{NNN}.spec.ts`, one test case per file, optional kebab suffix
(`TC-CUR-014-command-scope.spec.ts`). Nested subfolders inside `__integration__` are supported.
Category codes are listed in `.ai/qa/AGENTS.md` § Category Codes; there is **no `FORMS` code yet** —
add one (`FORMS`, "Forms & Submissions") when the suite lands.

**Discovery** is not a glob over `testDir`. `.ai/qa/tests/playwright.config.ts` calls
`discoverIntegrationSpecFiles(projectRoot, …)` from
`packages/cli/src/lib/testing/integration-discovery.ts`, which:

- walks every `__integration__/` directory,
- derives `moduleName` from the path segment before `__integration__`,
- collects `requiredModules` from folder-level `meta.ts` / `index.ts` and per-spec
  `TC-*.meta.ts` (keys `dependsOnModules` / `requiredModules` / `requiresModules`), inherited
  root → nested,
- resolves the set of **enabled** module ids by reading the `enabledModules` array out of
  `apps/mercato/src/modules.ts` (or `$OM_TEST_APP_ROOT/src/modules.ts` in the standalone lane),
- drops any spec whose `moduleName` or `requiredModules` are not in that set.

`forms` is already registered — `apps/mercato/src/modules.ts:160`:
`{ id: 'forms', from: '@open-mercato/core' }` — so a new `forms/__integration__/` folder is picked
up with no extra wiring.

Env gating also exists: `requiredEnvVars` / `requiresEnvVars` (all must be non-blank) and
`requiredAnyEnvVars` / `requiresAnyEnvVars` (at least one). `.ai/qa/AGENTS.md` restricts these to
tests that genuinely need external services.

`testIgnore` in the config statically excludes `.claude/**`, `.codex/**`, `.ai/tmp/**`,
**`.ai/cezar/**`**, and `packages/create-app/template/**`. That last-but-one entry matters here:
specs inside a cezar worktree are never discovered by a run launched from the main worktree.

## 1.2 Commands

From the root `package.json`:

| Script | Command | What it does |
|---|---|---|
| `yarn test:integration` | `cross-env ENABLE_CRUD_API_CACHE=true npx playwright test --config .ai/qa/tests/playwright.config.ts` | Runs the suite against an **already-running** app at `BASE_URL` (default `http://localhost:3000`). You provide the server and DB. |
| `yarn test:integration:ephemeral` | `cross-env ENABLE_CRUD_API_CACHE=true yarn mercato test:integration` | Full self-contained run: testcontainers Postgres → `mercato init` → build → boot app → Playwright → teardown. **Docker required.** |
| `yarn test:integration:ephemeral:interactive` | `… yarn mercato test:integration:interactive` | Same env, kept alive, menu-driven (run all / run one / refresh list / open report / quit). |
| `yarn test:integration:ephemeral:start` | `… yarn mercato test:ephemeral` | Boots the ephemeral app only, for Playwright-MCP exploration. Writes `.ai/qa/ephemeral-env.json`. |
| `yarn test:integration:coverage` | `yarn mercato test:integration:coverage` | The CI form — same run plus V8 code coverage. |
| `yarn test:integration:spec-coverage` | `yarn mercato test:integration:spec-coverage` | Scenario/spec-coverage report (`--json`, `--strict`). |
| `yarn test:integration:report` | `npx playwright show-report .ai/qa/test-results/html` | Opens the HTML report. |

Positional filter and flags pass through: `yarn test:integration:ephemeral TC-DICT-001`,
`--workers <n>`, `--retries <n>`, `--shard i/n`, `--verbose`, `--screenshots` / `--no-screenshots`.
Direct Playwright also works: `npx playwright test --config .ai/qa/tests/playwright.config.ts forms`.

**Prerequisite that is not documented anywhere and cost a full cycle here:** the ephemeral runner
is `packages/cli/dist/bin.js`. In a fresh worktree that file does not exist and the command dies
with `MODULE_NOT_FOUND` — **and still exits 0 through a pipe**. Run `yarn build:packages` first.

### Playwright config facts a new suite must respect

`.ai/qa/tests/playwright.config.ts`:

- `timeout: 20_000`, `expect.timeout: 20_000` — 20s per test *and* per assertion. A PDF-generation
  or queue-drain case must either stay under that or call `test.setTimeout()`.
- `retries: 1` — every spec must be idempotent across a retry. A fixture keyed on a
  module-scope `Date.now()` is re-evaluated on retry (new module instance), but a spec that
  creates a uniquely-keyed row and does not clean up will collide with its own retry.
- `workers: 1` — specs run serially. Cross-suite interference is still possible through shared
  global state (rate-limit buckets, the auth token cache, the seeded admin's ACL).
- `use.baseURL: process.env.BASE_URL || 'http://localhost:3000'`; `headless: true`;
  `trace: 'on-first-retry'`.
- Reporters: `list` + `json` (`.ai/qa/test-results/results.json`) + `html`
  (`.ai/qa/test-results/html`), plus `github` in Actions.

## 1.3 How the ephemeral environment is provisioned

Driver: `packages/cli/src/lib/testing/integration.ts` (~3.5k lines). Observed order from the real
run in §1.6:

1. **Reuse probe** — reads `.ai/qa/ephemeral-env.json` and `.ai/qa/ephemeral-build-cache.json`.
   Reuses a live environment when the source fingerprint, environment fingerprint, screenshot
   setting and TTL all match; otherwise rebuilds. A runtime lock file guards concurrent runs and
   is cleared when its owner PID is dead.
2. **Database** — `new GenericContainer(resolveEphemeralPostgresImage())` via **testcontainers**
   on a random host port (`localhost:33143` in the run below). Docker is a hard requirement for
   this lane.
3. **`mercato init`** — migrations + tenant setup + default roles/users. ~59s here.
4. **`build:packages` → `generate` → `build:packages` → `build:app`.** Note the double
   `build:packages` around `generate` — the same load-bearing ordering as the manual gate.
5. **Boot** the Next.js app under `NODE_ENV=production` on port **5001**, or a free fallback port
   if 5001 is taken; the chosen `base_url` is written to `.ai/qa/ephemeral-env.json`. Readiness is
   polled (`OM_INTEGRATION_APP_READY_TIMEOUT_SECONDS`, 180 in CI) with a stabilisation window.
6. **Playwright** with `BASE_URL` pointed at that port.
7. **Teardown** — container down, `.ai/qa/ephemeral-env.json` cleared.

Because 5001 is the default, **two concurrent worktrees running the ephemeral lane will fight over
it**; the second silently lands on a fallback port, which is fine, but a stale
`.ai/qa/ephemeral-env.json` from a sibling can point MCP exploration at the wrong app.

Default credentials created by `mercato init` (`.ai/qa/AGENTS.md`):

| Role | Email | Password |
|---|---|---|
| Superadmin | `superadmin@acme.com` | `secret` |
| Admin | `admin@acme.com` | `secret` |
| Employee | `employee@acme.com` | `secret` |

## 1.4 CI: `ephemeral-integration` and affected-only shard selection

All of this is in `.github/workflows/ci.yml`.

The **`prepare`** job computes integration scope (`steps.integration-scope`) and exports three
outputs consumed by the shard job: `skip_integration`, `affected_modules`, `shard_matrix`.

```yaml
FULL_SHARDS='["1/15","2/15",…,"15/15"]'
SINGLE_SHARD='["none"]'

if [ "${{ github.event_name }}" != "pull_request" ]; then
  skip=false; modules=; shard_matrix=$FULL_SHARDS          # push to main/develop → full 15 shards
fi

CHANGED=$(git diff origin/${{ github.base_ref }} --name-only)

FULL_SUITE_PATTERN='^packages/shared/|^packages/ui/|^packages/events/|^packages/queue/|^packages/cache/|^packages/search/|^packages/onboarding/|^packages/webhooks/|^packages/core/src/lib/|^packages/enterprise/src/lib/|^packages/cli/src/lib/testing/|^apps/mercato/src/(app|lib|components|layout\.|page\.)'
if echo "$CHANGED" | grep -qE "$FULL_SUITE_PATTERN"; then
  skip=false; modules=; shard_matrix=$FULL_SHARDS          # cross-cutting change → full 15 shards
fi

MODULES=$(echo "$CHANGED" | grep -oP '(?:packages/[^/]+|apps/[^/]+)/src/modules/\K[^/]+' | sort -u | paste -sd,)

if [ -z "$MODULES" ]; then
  skip=true;  modules=; shard_matrix=$SINGLE_SHARD         # CI/docs/scripts only → skip entirely
else
  skip=false; modules=$MODULES; shard_matrix=$SINGLE_SHARD # module change → ONE runner, filtered
fi
```

The **`ephemeral-integration`** job then runs
`strategy.matrix.shard: fromJson(needs.prepare.outputs.shard_matrix)` with
`OM_INTEGRATION_MODULES: ${{ needs.prepare.outputs.affected_modules }}` and

```bash
SHARD_FLAG=…   # "" when matrix.shard == 'none', else "--shard i/15"
yarn test:integration:coverage $SHARD_FLAG
```

The config turns `OM_INTEGRATION_MODULES` into a spec filter: a spec is kept when its
`moduleName` is `null`, or its `moduleName` is in the set, or **any of its `requiredModules` is**.

**What this means for the forms PR.** The migration diff is
`packages/core/src/modules/forms/**` plus `apps/mercato/src/modules.ts` and package manifests. The
`grep -oP` extracts `forms` (and any other touched module), so the PR runs
`ephemeral-integration (none)` — **one** runner with `OM_INTEGRATION_MODULES=forms`. That shard
name reads like a skip but is not: `none` is the affected-only shard, and it is where a forms
suite will actually be exercised. Only a push to `develop`/`main` (or a diff touching
`packages/shared|ui|events|queue|cache|search|onboarding|webhooks`, `packages/core/src/lib/`,
`packages/enterprise/src/lib/`, `packages/cli/src/lib/testing/`, or `apps/mercato/src/{app,lib,components}`)
promotes it to the 15-shard full suite.

Corollary worth acting on: because selection is by *changed module folder*, a forms spec that
depends on another module's fixtures (`customer_accounts`, `attachments`) will **not** re-run when
that other module changes unless the spec declares `dependsOnModules`. Declare them (§2.10).

Job env that the forms suite inherits from CI and should not contradict:
`OM_OPTIMISTIC_LOCK` and `OM_OPTIMISTIC_LOCK_DEBUG` (workflow level), `JWT_SECRET`
(`ci-ephemeral-test-jwt-secret-32-chars-min`), `OM_ENABLE_TEST_CHANNEL_SEEDING=true`,
`SYSTEM_EMAIL_PROVIDER=__test_seed__`, `OM_DISABLE_EMAIL_DELIVERY=0`,
`OM_WEBHOOKS_ALLOW_PRIVATE_URLS=1`, `OM_INTEGRATION_APP_READY_TIMEOUT_SECONDS=180`.
`JWT_SECRET` being set is load-bearing for forms: `getSecret()` in
`services/distribution-token.ts` falls back to `JWT_SECRET` when
`FORMS_DISTRIBUTION_TOKEN_SECRET` is unset, and **throws** when neither exists.
`SYSTEM_EMAIL_PROVIDER=__test_seed__` is what makes invitation-email assertions possible
(§1.5, `communicationChannelsFixtures`).

## 1.5 Reusable fixture and helper surface — full inventory

Canonical import root: **`@open-mercato/core/helpers/integration/*`**
(source `packages/core/src/helpers/integration/`). The legacy root
`@open-mercato/core/modules/core/__integration__/helpers/*` still resolves via thin re-export
files (`packages/core/src/modules/core/__integration__/helpers/*.ts`, each a one-line
`export * from …`) but is **not published to npm** — new code must use the canonical path.
A convenience barrel exists at `@open-mercato/core/testing/integration` re-exporting the common
subset (`api`, `auth`, `authUi`, `authFixtures`, `generalFixtures`, `crmFixtures`,
`dictionariesFixtures`).

Note: three helpers exist only under the canonical root and have no legacy re-export
(`appRoot`, `crudFormFields`, `crudFormPersistence`, `pushFake`, `queue`, `queue-runner`,
`standaloneEnv`, `timesheetFixtures`, `undoHarness`, `workflowsUi`), and one legacy re-export
(`s3Fixtures.ts`) points at a canonical file that no longer exists — do not import it.

### Core plumbing

| Helper | Exports | Usage note |
|---|---|---|
| `api` | `getAuthToken(request, roleOrEmail='admin', password?)`, `apiRequest(request, method, path, {token, data?, timeout?, retryTransport?, headers?})`, `postForm(request, path, data, {headers?})`, `withCredentialIsolatedRequest(use)`, `clearAuthTokenCache()` | **The house pattern for every API call.** `getAuthToken` caches per credential for 45 min per worker and retries 429 with capped backoff (1s/2s/4s), dodging the 5-attempts/60s login limit. `apiRequest` sets `Authorization: Bearer` + JSON content type and retries transport errors once. |
| `auth` | `login(page, role='admin')`, `DEFAULT_CREDENTIALS`, type `Role = 'superadmin' \| 'admin' \| 'employee'` | UI login for `page`-driven specs. |
| `generalFixtures` | `readJsonSafe(response)`, `getTokenContext(token) → {organizationId, tenantId}`, `getTokenScope(token)`, `expectId(value, message)`, `deleteEntityByPathIfExists(request, token, path)`, `deleteGeneralEntityIfExists(...)` | `getTokenContext` decodes the JWT — **this is how a spec learns its own tenant/org ids** without an extra round trip. `expectId` narrows `unknown → string` with a message. |
| `dbFixtures` | `resolveIntegrationDatabaseUrl()`, `withClient(run)`, type `IntegrationDbClient`, `clearUserHomeOrganization(userId)`, `setUserAclInDb(input)`, `deleteUserAclInDb(userId)`, `createOrganizationInDb({name, tenantId})`, `deleteOrganizationInDb(orgId)`, `deleteIntegrationCredentialsInDb(orgId)` | Direct SQL escape hatch. `createOrganizationInDb` + `setUserAclInDb` are the only practical way to build a **second organization** for cross-tenant denial tests. |
| `appRoot` | `resolveAppRoot(input?)` | Resolves the app root (monorepo vs `OM_TEST_APP_ROOT`). |
| `standaloneEnv` | `readStandaloneEnv()`, `readIntegrationEnv(name)`, `isStandaloneIntegration()`, `readIntegrationEnvFlag(name, default=false)` | Standalone-lane env access; use instead of bare `process.env` for anything the standalone run must also see. |
| `ui` | `fillControlledInput(...)`, `waitForApiMutation(...)` | Controlled-input typing and "wait for the write to land" for UI specs. |
| `sseEventCollector` | `installOmEventCollector(page)`, `getCapturedOmEvents(page)`, type `CapturedEvent` | Captures DOM-bridge/SSE events in the page for assertions. |
| `queue` | `drainIntegrationQueue(queueName, options?)` | Drains a local queue job **in the target app's context**. Required for standalone parity — never import a worker handler or `createRequestContainer` from a spec. |
| `queue-runner` | `drainQueueFromAppRoot(...)`, `runQueueDrainFromEnv()`, type `QueueDrainRunnerOptions` | The subprocess side of `drainIntegrationQueue`; specs use `queue`, not this. |

### Identity / ACL fixtures

| Helper | Exports | Usage note |
|---|---|---|
| `authFixtures` | re-exports `getAuthToken`; `apiRequestWithSelectedOrg(...)`, `createRoleFixture(...)`, `deleteRoleIfExists(...)`, `createUserFixture(...)`, `deleteUserIfExists(...)`, `createOrganizationFixture(...)`, `deleteOrganizationIfExists(...)`, `setRoleAclFeatures(...)`, `setUserAclVisibility(...)` | **The ACL-denial toolkit.** `createRoleFixture` + `setRoleAclFeatures` + `createUserFixture` builds a user holding exactly one feature — the only honest way to prove `forms.design` is required and `forms.view` is not enough. `apiRequestWithSelectedOrg` sends the active-organization selector header. |
| `authUi` | `createUserViaUi(page, {email, password, role?})` | UI user-creation smoke. |
| `customerAccountsFixtures` | `uniqueSuffix()`, `customerTestPassword()`, `createCustomerRoleFixture(...)`, `setCustomerRoleAcl(...)`, `createCustomerCompanyFixture(...)`, `deleteCustomerCompanyFixture(...)`, `createCustomerUserFixture(...)`, `portalLogin(request, {email, password, tenantId}) → PortalSession`, `portalCookieHeaders(session, extra?)`, `deleteCustomerUserFixture(...)`, `deleteCustomerRoleFixture(...)`; types `CustomerRoleFixture`, `CustomerUserFixture`, `CreateCustomerRoleInput`, `CreateCustomerUserInput`, `PortalSession` | **Everything the forms portal + customer-runtime tests need.** `portalLogin` POSTs `/api/customer_accounts/login` and returns `{authToken, sessionToken, cookieHeader}`; pass `portalCookieHeaders(session)` as `headers` to `apiRequest`. |
| `apiKeysFixtures` | `createApiKeyFixture(...)` | API-key auth path. |
| `staffFixtures` | `createStaffTeamFixture`, `createStaffTeamMemberFixture`, `createStaffTeamRoleFixture`, `deleteStaffEntityIfExists` | |

### Domain fixtures

| Helper | Exports | Usage note |
|---|---|---|
| `crmFixtures` | re-exports `readJsonSafe`; `createCompanyFixture`, `createPersonFixture`, `createDealFixture`, `createPipelineFixture`, `createPipelineStageFixture`, `deleteEntityByBody`, `deleteEntityIfExists` | A `customers.person` is the natural `subject_type='person'` for forms submission-subject cases. |
| `catalogFixtures` | `createProductFixture`, `createVariantFixture`, `createCategoryFixture`, `deleteCatalogCategoryIfExists`, `deleteCatalogProductIfExists` | |
| `salesFixtures` | `createSalesQuoteFixture`, `createSalesOrderFixture`, `createOrderLineFixture`, `createShipmentFixture`, `canManageSalesOrders`, `deleteSalesEntityIfExists` | |
| `salesUi` | `createSalesDocument`, `addCustomLine`, `updateLineQuantity`, `deleteLine`, `addAdjustment`, `addPayment`, `addShipment`, `readGrandTotalGross` | 57 KB of page-driving helpers; the reference for how big a UI helper may get. |
| `workflowsFixtures` | `createWorkflowDefinitionFixture`, `deleteWorkflowDefinitionIfExists`, `startWorkflowInstanceFixture`, `cancelWorkflowInstanceIfExists`, `getWorkflowInstanceSnapshot`, `pollWorkflowInstance`, `getUserTaskDetail`, `listWorkInbox`, `pollWorkInbox`, `listWorkflowInstanceTasks`, `findInstanceUserTask`, `registerTaskBindingEntityType`, `deleteTaskBindingEntityTypeIfExists`, `listWorkflowInstanceEvents`, `listWorkflowInstanceSteps`, `getWorkflowFailureQueue`, plus ~12 `build*DefinitionPayload(...)` builders and snapshot types | **The structural model for a forms fixture module**: payload builders + create/delete + poll helpers, all in one file. |
| `workflowsUi` | `visualEditorHref`, `workflowStepNodes`, and ~10 label/testid constants | |
| `currenciesFixtures` | `createCurrencyFixture`, `generateUniqueCurrencyCode`, `createRandomCurrencyFixture`, `createFetchConfigFixture`, `deleteCurrenciesEntityIfExists` | |
| `dictionariesFixtures` | `createDictionaryFixture` | |
| `businessRulesFixtures` | `createRuleSetFixture`, `deleteRuleSetIfExists`, `createBusinessRuleFixture`, `deleteBusinessRuleIfExists` | |
| `featureTogglesFixtures` | `createFeatureToggleFixture`, `deleteFeatureToggleIfExists` | |
| `plannerFixtures` | `createAvailabilityRuleSetFixture`, `deleteAvailabilityRuleSetIfExists`, `createAvailabilityRuleFixture`, `deleteAvailabilityRuleIfExists` | |
| `timesheetFixtures` | `createTimeProjectFixture`, `assignEmployeeToProjectFixture`, `createTimeEntryFixture`, re-exports `deleteStaffEntityIfExists` | |
| `attachmentsFixtures` | `uploadAttachmentFixture(...)`, `deleteAttachmentIfExists(...)`, `deleteAttachmentPartitionIfExists(...)` | **Directly relevant** — forms attachments ride the core attachments storage; `deleteAttachmentPartitionIfExists` is what cleans up the `formLogos` public partition. |
| `notificationsFixtures` | `createNotificationFixture`, `listNotifications`, `dismissNotificationIfExists`, `dismissNotificationsByType` | |
| `inboxFixtures` | `submitTextExtraction`, `waitForEmailProcessed`, `deleteInboxEmail`, `listInboxEmails`, `listInboxProposals`, `fetchProposalDetail`, `findPendingAction`; types `InboxProposalDetail`, `InboxProposalActionDetail` | |
| `communicationChannelsFixtures` | `isChannelSeedingAvailable`, `seedConnectedChannel`, `seedSystemEmailChannel`, `clearCapturedSystemEmails`, `listCapturedSystemEmails`, `waitForCapturedSystemEmail`, `seedInboundMessage`, `ingestInboundChatMessage`, `deleteChannelIfExists`; types `SeedAddressField`, `CapturedTestSeedEmail` | **The only way to assert an outbound email.** Forms invitation-send goes through the system email channel; `waitForCapturedSystemEmail` + `clearCapturedSystemEmails` make that assertable under `SYSTEM_EMAIL_PROVIDER=__test_seed__`. |
| `pushFake` | `makeFakePushToken`, `makeFakePushTokenFor`, `FAKE_PUSH_CREDENTIALS`, `connectFakePushChannel`, `registerFakePushDevice`, `deleteFakePushDevice`, `deleteDeliveriesForDevice`, `readLatestDelivery`, `isDeviceSoftDeleted`, `readNativeMessage`, `expectNativeMessage`, constants `TENANT_CONNECT_PATH`/`DEVICES_PATH`/`NOTIFICATIONS_PATH`; type `PushDeliveryRow` | |

### Cross-cutting harnesses

| Helper | Exports | Usage note |
|---|---|---|
| `optimisticLockUi` | `resolveApiUrl(path)`, `readUpdatedAt(...)`, `bumpRecordViaApi(...)`, `putWithLock(...)`, `expectConflictBody(response)`, `expectConflictBanner(page, …)`, `expectNoConflictBanner(page)`, `clickConflictRefresh(page)`, `dismissConflictBanner(page)`; constants `CONFLICT_BANNER_TESTID='record-conflict-banner'`, `CONFLICT_DIALOG_TESTID='record-lock-conflict-dialog'` | The 409 harness. **Cannot be used against forms today** — see §2.2. |
| `crudFormPersistence` | `skipIfCrudFormExtensionTestsDisabled()`, `runCrudFormRoundTrip(config)`, `assertScalarFieldsPersisted(...)`, `assertCustomFieldsPersisted(...)`, re-exports from `crudFormFields` | The #2466 field-persistence sweep. Built for `makeCrudRoute` collection routes; forms' hand-written routes do not fit `runCrudFormRoundTrip` without a `readById` shim. |
| `crudFormFields` | `crudFormExtensionTestsDisabled(env)`, `getCustomFieldValue(record, name)`, type `CrudRecord`, const `CRUDFORM_EXTENSION_TESTS_DISABLED_ENV` | |
| `undoHarness` | `undoTestsDisabled(env)`, `skipIfUndoTestsDisabled()`, `extractOperation(response)`, `expectOperation(response, ctx)`, `undoByToken`, `redoByLogId`, `undoOk`, `redoOk`, `expectTokenConsumed`, `listUndoable`, `assertFieldsEqual`, `runCrudUndoRoundTrip`; types `Operation`, `CrudUndoEntityConfig`; const `UNDO_TESTS_DISABLED_ENV` | Forms routes **do** attach operation metadata (`attachOperationMetadata` in `api/helpers.ts`), so `extractOperation` / `undoOk` are usable for forms mutations. |

## 1.6 Rules a new suite must obey

Sourced from `.ai/qa/AGENTS.md`, the root `AGENTS.md` § Documentation and Specifications, and the
config.

1. **Self-contained.** Never rely on seeded or demo data. Create every fixture the test needs.
   The only records you may assume are the three `mercato init` accounts in the table above.
2. **Create in setup, clean up in `finally`/teardown.** Prefer API fixtures over UI setup. The
   house idiom is `let id: string | null = null; try { … } finally { await deleteXIfExists(request, token, id) }`.
3. **One test case per `.spec.ts`.** Each test handles its own login.
4. **Deterministic across retries and run order** (`retries: 1`). Unique keys per run —
   `` `qa_forms_${Date.now()}` `` is the house convention (see `TC-DICT-001`).
5. **Auth is obtained through `getAuthToken`, never by hand-rolling a login POST.** It caches and
   handles 429. For portal/customer identities use `portalLogin` + `portalCookieHeaders`.
6. **API calls go through `apiRequest(request, …)`**, never a bare `request.get/post`, except
   where you *deliberately* want no auth header.
7. **The `page.request` / bare-`request` trap is real and documented in the helper itself.**
   `packages/core/src/helpers/integration/api.ts:145-159`: the `request` fixture keeps a cookie
   jar, and `/api/auth/login` sets `auth_token` on it — so a later call that sends no
   `Authorization` header **still carries the last logged-in session**. A spec asserting "no
   credentials ⇒ 401" must issue from `withCredentialIsolatedRequest(...)`, which builds a fresh
   context that never saw a login. Two documents specs (`TC-DOCUMENTS-009`, `-018`) passed in the
   ephemeral lane and failed in the standalone lane before being routed through it. **Every
   "public endpoint needs no auth" and every "unauthenticated is rejected" forms case must use it.**
8. **Page size ≤ 100** (root `AGENTS.md` § UI & HTTP). Forms already enforces it:
   `formListQuerySchema.pageSize.max(100)` and `Math.min(parsed.pageSize ?? 20, 100)` on
   `GET /api/forms`; `GET /api/forms/:id/submissions` uses `.max(100).default(25)`.
9. **Cross-suite interference.** `workers: 1` removes parallelism but not shared state:
   - the module-scope **auth token cache** in `api.ts` — a spec that invalidates sessions for a
     shared account must call `clearAuthTokenCache()` afterwards;
   - **rate-limit buckets** — forms' public limiter keys on `x-forwarded-for`
     (`api/public/rate-limit.ts:25-27`, falling back to the literal `'unknown'`), so give every
     rate-limit test its own synthetic IP or it will poison the next spec — see §2.4 (g);
   - **role ACLs** — mutating the seeded `admin` role's features leaks into every later spec;
     create a throwaway role instead (`createRoleFixture` + `setRoleAclFeatures`).
10. **Queue-backed assertions** go through `drainIntegrationQueue('<queue>')`. Forms owns two
    queues: `forms-pdf-snapshot` and `forms-retention-purge`.
11. **Never leave a broken test** — fix it or `test.skip()` with a stated reason.
12. **Declare dependencies** with folder `meta.ts` (`dependsOnModules`) so CI's affected-only
    selection re-runs the suite when a depended-on module changes.
13. Locators: `getByRole` / `getByLabel` / `getByText` / `getByPlaceholder`, not CSS.
14. The root `AGENTS.md` contract: *"For every new feature, the spec MUST list integration
    coverage for all affected API paths and key UI paths, and those integration tests MUST ship in
    the same change."* The forms migration PR is in scope for this rule.

## 1.7 Proof the harness runs in this worktree

**Verdict: the harness works.** It took three attempts; the two failures are both worth knowing
about before the forms suite is authored.

### Attempt 1 — `packages/cli/dist/bin.js` missing, and the failure exits 0

```
$ yarn install                     # completes, exit 0, but with two YN0009 native-build failures
➤ YN0009: │ cpu-features@npm:0.0.10 couldn't be built successfully (exit code 1, …/build.log)
➤ YN0009: │ better-sqlite3@npm:13.0.3 couldn't be built successfully (exit code 1, …/build.log)
➤ YN0000: · Done with warnings in 41s 292ms

$ OM_INTEGRATION_MODULES=dictionaries yarn test:integration:ephemeral TC-DICT-001
node:internal/modules/cjs/loader:1479
  throw err;
  ^
Error: Cannot find module '/…/worktrees/6845f2cc-…/packages/cli/dist/bin.js'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1476:15)
  code: 'MODULE_NOT_FOUND',
  requireStack: []
Node.js v24.15.0

[exited with code 0]
```

Fix: `yarn build:packages` first. Note the **exit code 0** — piping this command hides the failure
entirely (a `| tail` makes it look like a clean run). Always capture the raw exit status.

Neither `better-sqlite3` nor `cpu-features` failing to build blocked anything downstream
(finding F-8), but a suite that depends on the SQLite cache strategy should not assume it.

### Attempt 2 — the app refuses to boot on the repo's placeholder `JWT_SECRET`

After `yarn build:packages && yarn generate && yarn build:packages` (all exit 0), the ephemeral
environment provisioned correctly and then the app process died:

```
[integration] Ephemeral database ready at localhost:33143
[integration] Initializing application data (includes migrations)...
[integration] Initializing application data completed in 59s.
[integration] Build artifacts missing, stale, or out of date; rebuilding artifacts.
[integration] Building packages... completed in 9s.
[integration] Regenerating module artifacts... completed in 21s.
[integration] Rebuilding packages after generation... completed in 1s.
[integration] Building application... completed in 153s.
[integration] Starting application on http://127.0.0.1:5001...
💥 Failed: Application process exited before readiness check (exit 1)
Captured output:
  - CACHE_STRATEGY=sqlite (multi-instance-safe: redis)
  - QUEUE_STRATEGY=local (multi-instance-safe: async)
  - RATE_LIMIT_STRATEGY=memory (multi-instance-safe: redis)
[auth.jwt] Refusing to run in production with an unsafe signing secret: JWT_SECRET is set to a
placeholder value published in this repository's examples, so anyone can forge tokens for this
deployment. Generate a real one with `openssl rand -hex 32`.
💥 Failed: [server] Next.js production server exited unexpectedly with exit code 1.
--- stdout ---
[server] Starting Open Mercato in production mode...
[lazy-supervisor] Watching 60 queue(s): …, forms-pdf-snapshot, forms-retention-purge, …
▲ Next.js 16.3.3
- Local:         http://localhost:5001
✓ Ready in 106ms
[server] Shutting down...
INT_EXIT=1
```

`apps/mercato/.env:17` ships `JWT_SECRET=change-me-dev-secret`, the ephemeral harness spawns the
app under `NODE_ENV=production`, and `packages/shared/src/lib/auth/jwt.ts` fails closed on a
published placeholder. CI never hits this because `ephemeral-integration` sets a job-level
`JWT_SECRET: 'ci-ephemeral-test-jwt-secret-32-chars-min'`. **This is finding F-10 and it is a
prerequisite for anyone running the lane locally.** Incidentally the log also confirms both forms
queues register with the lazy worker supervisor.

### Attempt 3 — green

```
$ export JWT_SECRET="$(openssl rand -hex 32)"
$ OM_INTEGRATION_MODULES=dictionaries yarn test:integration:ephemeral TC-DICT-001

🚀 Running test:integration TC-DICT-001
[integration] Running Playwright suite...
[integration] Checking whether an existing ephemeral environment can be reused...
[integration] Build cache disabled: source files changed since last build.
[integration] Ephemeral database ready at localhost:33145
[integration] Initializing application data (includes migrations)...
[integration] Initializing application data completed in 51s.
[integration] Build artifacts missing, stale, or out of date; rebuilding artifacts.
[integration] Building packages...
[integration] Building packages completed in 1s.
[integration] Regenerating module artifacts...
[integration] Regenerating module artifacts completed in 20s.
[integration] Rebuilding packages after generation...
[integration] Rebuilding packages after generation completed in 1s.
[integration] Building application...
[integration] Reset Next build output directory at /…/apps/mercato/.mercato/next.
[integration] Building application completed in 144s.
[integration] Starting application on http://127.0.0.1:5001...
[integration] Waiting for application readiness completed in 8s.
[integration] Application is ready at http://127.0.0.1:5001
[integration] Ensuring Playwright Chromium is installed...

Running 1 test using 1 worker

  ✓  1 packages/core/src/modules/dictionaries/__integration__/TC-DICT-001.spec.ts:10:3 › TC-DICT-001: Dictionary CRUD via API › should create, read, update, and delete a dictionary (249ms)

  1 passed (5.3s)
[integration] Screenshot capture is enabled (override with --screenshots / --no-screenshots)
⏱️ Done in 238596ms
INT2_EXIT=0
```

Cold-run cost: **~4 minutes** of provisioning for **5.3 seconds** of test. Budget accordingly, and
use `yarn test:integration:ephemeral:interactive` (or `:start` + plain `yarn test:integration`)
when iterating on the forms suite.

### The forms gap, demonstrated

```
$ OM_INTEGRATION_MODULES=forms npx playwright test --config .ai/qa/tests/playwright.config.ts --list
Listing tests:
  .ai/qa/tests/__no_tests__/affected-modules-empty.spec.ts:16:5 › integration shard runs even when affected modules ship no specs
Total: 1 test in 1 file

$ OM_INTEGRATION_MODULES=dictionaries npx playwright test --config .ai/qa/tests/playwright.config.ts --list
…
Total: 24 tests in 20 files
```

> **Finding F-11 — the most important operational consequence in this document.**
> Discovery for `forms` matches **zero** real specs, so the config's fallback
> (`testMatch: filteredSpecPaths.length > 0 ? filteredSpecPaths : ['.ai/qa/tests/__no_tests__/*.spec.ts']`)
> kicks in and Playwright runs a sentinel that asserts `expect(true).toBe(true)`. That sentinel
> exists deliberately, so that a module with only unit tests does not fail the shard —
> `.ai/qa/tests/__no_tests__/affected-modules-empty.spec.ts` says so in its own comment.
>
> The effect on the forms migration PR is that **`ephemeral-integration (none)` will report green
> having exercised nothing**: ~300 files and ~50 API routes land behind a single trivially-passing
> placeholder. Nobody reading the checks page can tell that apart from a real pass. Shipping at
> minimum the P0 set in §2.5 is what turns that signal back on.

---

# Part 2 — The forms integration suite

## 2.1 Route inventory (ground truth)

Generated from `apps/mercato/.mercato/generated/api-route-metadata.generated.ts` after
`yarn build:packages && yarn generate && yarn build:packages` in this worktree. All paths below are
served under `/api`. `metadata.requireAuth` is **staff** auth; the runtime routes marked
`requireAuth: false` enforce **portal customer** auth internally via
`getCustomerAuthFromRequest`, and the `public/*` routes enforce a submission access token or a
portal session via `resolveRuntimePrincipal`.

### Admin / authoring (staff session + feature)

| Route | Methods | Required feature |
|---|---|---|
| `/api/forms` | GET / POST | `forms.view` / `forms.design` |
| `/api/forms/[id]` | GET / PATCH / DELETE | `forms.view` / `forms.design` / `forms.design` |
| `/api/forms/[id]/versions/fork` | POST | `forms.design` |
| `/api/forms/[id]/versions/[versionId]` | GET / PATCH | `forms.view` / `forms.design` |
| `/api/forms/[id]/versions/[versionId]/publish` | POST | `forms.design` |
| `/api/forms/[id]/versions/[versionId]/diff` | GET | `forms.view` |
| `/api/forms/[id]/submissions` | GET | `forms.view` |
| `/api/forms/[id]/analytics` | GET | `forms.view` |
| `/api/forms/[id]/theme-logo` | POST | `forms.design` |
| `/api/forms/[id]/distributions` | GET / POST | `forms.distribute` |
| `/api/forms/distributions/[distributionId]` | GET / PATCH | `forms.distribute` |
| `/api/forms/distributions/[distributionId]/invitations` | GET / POST | `forms.distribute` |
| `/api/forms/distributions/[distributionId]/invitations/[invitationId]` | DELETE | `forms.distribute` |
| `/api/forms/distributions/[distributionId]/invitations/[invitationId]/send` | POST | `forms.distribute` |
| `/api/forms/submissions/[submissionId]` | GET | `forms.view` |
| `/api/forms/submissions/[submissionId]/revisions` | GET | `forms.view` |
| `/api/forms/submissions/[submissionId]/access-audit` | GET | `forms.view` |
| `/api/forms/submissions/[submissionId]/pdf` | GET | `forms.view` |
| `/api/forms/submissions/[submissionId]/attachments/[attachmentId]` | GET | `forms.view` |
| `/api/forms/submissions/[submissionId]/actors` | POST | `forms.submissions.manage` |
| `/api/forms/submissions/[submissionId]/actors/[actorId]` | DELETE | `forms.submissions.manage` |
| `/api/forms/submissions/[submissionId]/reopen` | POST | `forms.submissions.manage` |
| `/api/forms/submissions/[submissionId]/export` | GET | `forms.submissions.export` |
| `/api/forms/submissions/[submissionId]/anonymize` | POST | `forms.submissions.anonymize` |
| **`/api/forms/forms/subjects/[subjectType]/[subjectId]/consents`** | GET | `forms.view` |
| **`/api/forms/forms/subjects/[subjectType]/[subjectId]/export`** | GET | `forms.submissions.export` |

> **Finding F-1 (defect, not a test item).** The last two rows are mounted at a **doubled**
> `forms/forms/` prefix: the files live at `api/forms/subjects/…`, and the generator prepends the
> module id (`packages/cli/src/lib/generators/module-registry.ts:2394`,
> `routePath = '/' + [modId, ...segs].join('/')`). Their own docstrings and OpenAPI descriptions
> claim `/api/forms/subjects/…`, which **404s**. Verified against the generated registry, quoted
> in §2.1's source. Either move the folder to `api/subjects/…` or accept the doubled path and fix
> the docs. A spec written from the docstring will fail; write it from the generated path and add
> a guard case (FORMS-GDPR-001) pinning whichever path is chosen.

### Customer-runtime (portal session; `requireAuth: false` at the platform layer)

| Route | Methods |
|---|---|
| `/api/forms/by-key/[key]/active` | GET |
| `/api/forms/form-submissions` | POST |
| `/api/forms/form-submissions/[id]` | GET / PATCH |
| `/api/forms/form-submissions/[id]/submit` | POST |
| `/api/forms/form-submissions/[id]/resume-token` | GET |
| `/api/forms/form-submissions/[id]/attachments` | POST |
| `/api/forms/form-submissions/by-subject/[subject_type]/[subject_id]` | GET |

### Public / anonymous

| Route | Methods | Auth |
|---|---|---|
| `/api/forms/public/start` | POST | none (slug or invitation token in body) |
| `/api/forms/public/distributions/[slug]` | GET | none |
| `/api/forms/public/distributions/[slug]/embed-policy` | GET | none |
| `/api/forms/public/invitations/[token]` | GET | raw invitation token |
| `/api/forms/public/embed-loader` | GET | none (serves an ES5 IIFE) |
| `/api/forms/public/submissions/[id]` | GET / PATCH | access token **or** portal session |
| `/api/forms/public/submissions/[id]/submit` | POST | access token **or** portal session |
| `/api/forms/public/submissions/[id]/attachments` | POST | access token **or** portal session |
| `/api/forms/public/submissions/[id]/attachments/[attachmentId]` | GET | access token **or** portal session |
| `/api/forms/public/submissions/[id]/pdf` | GET | access token **or** portal session |
| `/api/forms/[id]/run/context` | GET | **none, unscoped** |
| `/api/forms/[id]/run/submissions` | POST | none — **`@deprecated`**, validation-only, persists nothing |

> **Finding F-2 (security posture, worth a decision before the PR merges).**
> `GET /api/forms/[id]/run/context` resolves the form with
> `em.findOne(Form, { id: formId, deletedAt: null })` — **no `organizationId` / `tenantId`
> filter and no distribution gate**. Any unauthenticated caller holding a form UUID gets that
> form's published JSON Schema, ui schema, roles and field index, from any tenant, whether or not
> a distribution exists, is paused, is closed, or requires customer auth. The `/api/forms/public/*`
> flow that superseded it gates all of that. Its POST sibling is already marked `@deprecated`; the
> GET is not. Test case FORMS-PUB-020 pins whichever behaviour is chosen.

### Page routes

Backend (`requireAuth: true`):
`/backend/forms` (`forms.view`), `/backend/forms/create` , `/backend/forms/[id]` (the Studio,
`forms.design`), `/backend/forms/[id]/submissions`, `/backend/forms/[id]/distributions`,
`/backend/forms/[id]/analytics`, `/backend/forms/[id]/history`.
The `studio/{canvas,logic,palette,preview,style,validation}` folders are components, not routes.

Frontend (from `frontend-routes.generated.ts`):

| Pattern | Metadata |
|---|---|
| `/f/[slug]` | `requireAuth: false` |
| `/embed/[slug]` | `requireAuth: false` |
| `/i/[token]` | `requireAuth: false` |
| `/[orgSlug]/portal/forms/[key]` | `requireCustomerAuth: true` |
| `/[orgSlug]/portal/submissions/[id]/continue` | `requireCustomerAuth: true` |
| `/forms/[id]/run` | **`undefined`** — no `page.meta.ts` |

> **Finding F-3.** `frontend/forms/[id]/run/page.tsx` ships no `page.meta.ts`, so it enters the
> manifest with `undefined` metadata and is publicly reachable at `/forms/{id}/run`. It drives the
> deprecated `/api/forms/{id}/run/submissions` endpoint (the only caller of it — verified by
> grepping `runner/FormRunner.tsx`). Decide whether it ships at all.
>
> **Finding F-4.** Neither portal page declares `requireCustomerFeatures`, and `setup.ts` declares
> **no `defaultCustomerRoleFeatures` at all** — so every authenticated portal customer of the
> tenant can reach `/[orgSlug]/portal/forms/{key}`. Compare `workflows`, whose portal pages gate on
> `portal.tasks.view`.
>
> **Finding F-5.** `setup.ts` grants the six forms features to **`admin` only** — no `employee`
> row, no `superadmin` row. That is a legitimate choice, but it means an `employee`-role spec must
> build its own role via `createRoleFixture` + `setRoleAclFeatures`, and it means existing tenants
> need `yarn mercato auth sync-role-acls` after upgrade.

### Error-code → HTTP-status contract

Extracted from every `new SubmissionServiceError(...)` / `new DistributionServiceError(...)`
construction in the module. Assert on the `error` string, not just the status.

| `error` | status |
|---|---|
| `VALIDATION_FAILED` | 400 **and** 422 (both occur) |
| `NOT_FOUND` | 404 |
| `NO_ACTOR` | 403 |
| `STALE_BASE` | **409** |
| `GONE` | 410 |
| `FORM_INACTIVE` | 422 |
| `FORM_VERSION_NOT_PUBLISHED` | 422 |
| `INVALID_ROLE` | 422 |
| `INVALID_STATUS` | 422 |
| `RATE_LIMITED` | 429 |

Route-level codes outside the service errors: `CUSTOMER_AUTH_REQUIRED` 409,
`CAPTCHA_REQUIRED` / `CAPTCHA_FAILED` 422, `RATE_LIMITED` 429 (public limiter),
`forms.errors.organization_required` 400, `forms.errors.invalid_id` 400,
`forms.errors.confirmation_required` 422.

> **Finding F-9 (affects several expected assertions below).** The **admin/authoring** routes call
> `schema.parse(...)` (throwing form) and funnel every exception through
> `handleRouteError` (`api/helpers.ts:62`), which only special-cases `CrudHttpError` and otherwise
> logs and returns **500 `{error:'forms.errors.internal'}`**. Nothing in the module or in the
> app's route dispatch maps `ZodError` — `grep -rn ZodError packages/core/src/modules/forms`
> returns zero hits, and the only `ZodError` handling in `packages/shared/src/lib/` lives in
> `crud/factory.ts`, i.e. the `makeCrudRoute` path forms does not use. So a malformed body or
> query on `POST /api/forms`, `PATCH /api/forms/:id`, the version routes, or the distribution
> routes returns **500**, while each route's own `openApi.errors` promises 400/422.
>
> The **public/runtime** routes are unaffected — they use `safeParse` and return an explicit
> `422 VALIDATION_FAILED`.
>
> **Domain** errors are unaffected: every command raises a `CrudHttpError` with a deliberate
> status, and `handleRouteError` passes those through verbatim. The full set, all assertable:
>
> | Status | `error` code |
> |---|---|
> | 400 | `forms.errors.invalid_id`, `forms.errors.organization_required`, `forms.errors.fork_source_invalid`, `forms.errors.version_form_mismatch` |
> | 401 | `forms.errors.unauthorized` |
> | 404 | `forms.errors.form_not_found`, `forms.errors.version_not_found`, `forms.errors.distribution_not_found`, `forms.errors.invitation_not_found` |
> | 409 | `forms.errors.version_is_frozen`, `forms.errors.invitation_revoked`, `forms.errors.invitation_submitted` |
> | 422 | `forms.errors.form_key_taken`, `forms.errors.schema_invalid`, `forms.errors.draft_already_exists`, `forms.errors.no_op_publish`, `forms.errors.invitation_no_email`, `forms.errors.confirmation_required` |
> | 500 | `forms.errors.internal` ← **the F-9 bucket** |
>
> So the leak is narrow but real: it is exactly the *route-layer* `schema.parse()` calls —
> `formListQuerySchema.parse` in `GET /api/forms` and every `…RequestSchema.parse(body)` in the
> admin POST/PATCH handlers. The cases affected are **FORMS-CRUD-002** (`pageSize=101`) and
> **FORMS-CRUD-004** (bad `key` shape), plus any other malformed-payload probe. Write them as
> "not 2xx **and** not 500" — that fails today and passes once the mapping lands. Do not assert
> `500`: a test that pins 500 pins the defect.

## 2.2 Optimistic locking — the case the order asks for cannot be written today

The order asks for "optimistic-locking 409s". Reporting honestly:

**The forms module implements no optimistic locking.** `grep -rn "optimisticLock\|OptimisticLock\|
expected-updated-at\|enforceCommandOptimisticLock" packages/core/src/modules/forms` returns
**zero** hits across `.ts` and `.tsx`. All eleven entities carry
`@Property({ name: 'updated_at', …, onUpdate: () => new Date() })`, and `GET /api/forms` returns
`updatedAt` — but:

- the routes are hand-written, not `makeCrudRoute`, so the `OM_OPTIMISTIC_LOCK=all` generic reader
  (registered by the CRUD factory) never reaches them;
- no route reads `x-om-ext-optimistic-lock-expected-updated-at`;
- no command calls `enforceCommandOptimisticLock`;
- the backend Studio is not a `CrudForm`, so `CrudForm`'s auto-derive-from-`initialValues.updatedAt`
  does not apply either.

That contradicts the root `AGENTS.md` § Always rule ("Support optimistic locking on every NEW
user-editable entity and edit/delete form (it is **default ON**)"). It is an **implementation gap,
not a test gap** — `optimisticLockUi`'s `putWithLock` / `expectConflictBody` have nothing to talk
to. The plan below therefore carries:

- **FORMS-LOCK-001 (P1, BLOCKED)** — the real 409 case, authorable only after the guard is wired.
- **FORMS-RUN-030 (P0)** — the concurrency control that *does* exist: submission autosave is
  guarded by `base_revision_id`, and a stale one yields `STALE_BASE` **409**. This is testable now
  and is the closest analogue.

## 2.3 Shared fixtures this suite needs (new work)

Proposed new file **`packages/core/src/helpers/integration/formsFixtures.ts`**, exported as
`@open-mercato/core/helpers/integration/formsFixtures` (plus the optional legacy re-export shim
under `packages/core/src/modules/core/__integration__/helpers/`). Modelled on
`workflowsFixtures.ts` (payload builders + create/delete + poll).

| Export | Purpose |
|---|---|
| `buildMinimalFormSchema(suffix?)` | The canonical compilable schema. Must carry `x-om-roles`, `x-om-default-actor-role`, `x-om-sections`, and `properties` with `x-om-type` / `x-om-label` / `x-om-editable-by`. Copy the shape from `__tests__/form-version-compiler.test.ts:7-32` — it is already proven to compile. |
| `buildSensitiveFormSchema(suffix?)` | Same plus an `x-om-sensitive: true` field — required by the anonymize and analytics-exclusion cases. |
| `buildFileFieldFormSchema(suffix?)` | Adds an `x-om-type: 'file'` field with `x-om-accept` / `x-om-max-size-bytes` — required by every attachment case (`resolveFieldUploadConfig` returns `null` and the upload 404s without it). |
| `createFormFixture(request, token, {key?, name?, …})` | `POST /api/forms` → `{ id, key }`. Key defaults to `` `qa_forms_${Date.now()}` `` (must match `/^[a-z][a-z0-9_-]*$/`, 3-64 chars). |
| `forkDraftFixture(request, token, formId, fromVersionId?)` | `POST /api/forms/:id/versions/fork`. |
| `updateDraftFixture(request, token, formId, versionId, {schema, uiSchema, roles, changelog})` | `PATCH …/versions/:versionId`. |
| `publishVersionFixture(request, token, formId, versionId, changelog?)` | `POST …/versions/:versionId/publish` → `{versionId, versionNumber}`. |
| `createPublishedFormFixture(request, token, opts)` | The composite the majority of cases need: create → fork → update draft → publish. Returns `{formId, formKey, versionId, versionNumber}`. |
| `createDistributionFixture(request, token, formId, {mode, defaultLocale, …})` | `POST /api/forms/:id/distributions` → `{id}`; re-read via `GET /api/forms/distributions/:id` for `publicSlug`. |
| `createInvitationsFixture(request, token, distributionId, recipients)` | `POST …/invitations` → `{invitations:[{id, rawToken}]}`. **`rawToken` is returned exactly once** — capture it. |
| `startPublicSubmission(request, {slug?, token?, locale?, captchaToken?, clientIp?})` | `POST /api/forms/public/start` through `withCredentialIsolatedRequest`, with an `x-forwarded-for` override so each spec owns its rate-limit bucket. Returns `{submission, revision, access_token}`. |
| `deleteFormIfExists(request, token, formId)` | `DELETE /api/forms/:id` — best-effort cleanup. |
| `deleteDistributionIfExists(...)` / `revokeInvitationIfExists(...)` | Best-effort cleanup (distribution close is `PATCH … {status:'closed'}`; invitation delete is `DELETE …/invitations/:id`). |
| `uniqueFormKey(prefix?)` | Retry-safe unique key generator. |

Also needed: a **second-organization fixture**. `authFixtures.createOrganizationFixture` +
`dbFixtures.createOrganizationInDb` / `setUserAclInDb` already exist; the cross-tenant cases wrap
them rather than adding new plumbing.

And **`packages/core/src/modules/forms/__integration__/meta.ts`**:

```ts
export const integrationMeta = {
  description: 'Forms authoring, runtime, distribution and GDPR flows',
  dependsOnModules: ['forms', 'customer_accounts', 'attachments'],
}
```

(`customer_accounts` for `portalLogin`, `attachments` for the storage-backed upload/PDF paths.
Without these, CI's affected-only selection will not re-run the forms suite when either changes.)

Finally, add **`FORMS`** to the category table in `.ai/qa/AGENTS.md`.

## 2.4 Test-case table

`P0` = ship first (core contract + tenant isolation + the happy paths the module exists for).
`P1` = ship next. `P2` = nice to have. **BQ** = browser QA, not an integration test.

Prefix convention: `TC-FORMS-<AREA>-<NNN>.spec.ts`, one case per file.

### (a) Form CRUD, ACL and tenant scoping

| Id | P | Title | Routes / paths | Fixtures | Steps | Assertions |
|---|---|---|---|---|---|---|
| FORMS-CRUD-001 | P0 | Form create → read → patch → delete round trip | `POST /api/forms`, `GET /api/forms/[id]`, `PATCH /api/forms/[id]`, `DELETE /api/forms/[id]` | admin token | POST `{key, name, defaultLocale:'en', supportedLocales:['en']}` → GET → PATCH `{name}` → DELETE → GET again | 201 + `{id}`; GET 200 with matching `key`/`name`/`status:'draft'`; PATCH 200 and name changed; DELETE 200; final GET 404 |
| FORMS-CRUD-002 | P0 | List is paginated, filtered and capped at 100 | `GET /api/forms?status=&q=&page=&pageSize=` | 3 forms, one archived | list default → `?pageSize=101` → `?q=<unique fragment>` → `?status=draft` | default `pageSize` 20; `q` returns only the matching form; `status` filter excludes the archived one; `total`/`page`/`totalPages` coherent. `pageSize=101` ⇒ **4xx, not 500** (F-9: today it 500s via `handleRouteError`) |
| FORMS-CRUD-003 | P0 | Duplicate form key is rejected | `POST /api/forms` ×2 | one form | POST the same `key` twice | second POST **422 `{error:'forms.errors.form_key_taken'}`** (`commands/form.ts:102`, a `CrudHttpError` — correctly mapped, unaffected by F-9); the first form still readable; no orphan row |
| FORMS-CRUD-004 | P0 | Invalid form key shape is rejected | `POST /api/forms` | admin token | POST `key:'A-bad key'`, `key:'ab'` (too short), `key:'x'.repeat(65)` | each **4xx, not 500** (F-9) naming the offending field; nothing created |
| FORMS-ACL-005 | P0 | `forms.view` alone cannot create or edit | `POST /api/forms`, `PATCH /api/forms/[id]` | `createRoleFixture` + `setRoleAclFeatures(['forms.view'])` + `createUserFixture`; one admin-created form | login as the restricted user; GET the list; POST a form; PATCH the existing form | GET 200; POST 403; PATCH 403 |
| FORMS-ACL-006 | P0 | No forms feature at all ⇒ every admin route denied | all admin routes above | role with `[]` features | call `GET /api/forms`, `GET /api/forms/:id`, `GET /api/forms/:id/submissions`, `GET /api/forms/:id/analytics` | all 403 |
| FORMS-ACL-007 | P1 | Each write feature is enforced independently | `…/reopen`, `…/export`, `…/anonymize`, `…/distributions` | four single-feature roles | with only `forms.submissions.manage`: reopen 2xx, export 403, anonymize 403, distributions 403 — then rotate | each route accepts exactly its declared feature and rejects the other three |
| FORMS-TEN-008 | P0 | Cross-tenant/org form read is 404, not 403 | `GET /api/forms/[id]` | `createOrganizationInDb` + `setUserAclInDb` for a second org, or a second admin user scoped elsewhere; one form in org A | as an org-B principal, GET the org-A form id | 404 (`NOT_FOUND`) — never 200, never 403 (no existence leak) |
| FORMS-TEN-009 | P0 | Cross-tenant form mutate/delete is 404 | `PATCH`/`DELETE /api/forms/[id]` | as above | PATCH then DELETE the foreign id | both 404; re-read from org A proves the row is untouched |
| FORMS-TEN-010 | P1 | Same form key may exist in two organizations | `POST /api/forms` in org A and org B | two orgs | create `key='qa_dup'` in both | both 201 — uniqueness is `(organization_id, key)`, per `validators.ts:15` |
| FORMS-AUTH-011 | P0 | Admin routes reject an unauthenticated caller | `GET /api/forms`, `POST /api/forms` | none | **`withCredentialIsolatedRequest`** — issue with no `Authorization` | 401. *Without the isolated context this test passes vacuously on a replayed cookie (§1.6 rule 7).* |
| FORMS-LOCK-001 | P1 **BLOCKED** | Concurrent form edit yields 409 | `PATCH /api/forms/[id]` with `x-om-ext-optimistic-lock-expected-updated-at` | `optimisticLockUi.readUpdatedAt` / `putWithLock` | read `updatedAt`; bump via a second PATCH; re-PATCH with the stale header | 409 with the standard conflict body (`expectConflictBody`). **Cannot be authored until §2.2 is implemented.** Do not ship a green-on-nothing version: a route that ignores the header returns 200 and the test would have to assert 200, pinning the defect. |

### (b) Form versions: draft → compile → publish → fork → diff

| Id | P | Title | Routes | Fixtures | Steps | Assertions |
|---|---|---|---|---|---|---|
| FORMS-VER-001 | P0 | Full lifecycle: fork draft → update → publish | `POST /api/forms/[id]/versions/fork`, `PATCH …/[versionId]`, `POST …/publish`, `GET /api/forms/[id]` | `createFormFixture`, `buildMinimalFormSchema` | fork → PATCH `{schema, uiSchema, roles}` → publish | fork 2xx with a `draft` version id; PATCH 200; publish 2xx `{versionId, versionNumber:1}`; parent form now `status:'active'` with `currentPublishedVersionId` set and `currentPublishedVersionNumber:1` |
| FORMS-VER-002 | P0 | Publishing an uncompilable draft is rejected | `POST …/publish` | draft whose `schema` omits `x-om-roles` / has a bad `x-om-type` | PATCH a broken schema, then publish | **422 `{error:'forms.errors.schema_invalid', code, path, message}`** — `compileOrThrowValidation` wraps `FormCompilationError` in a `CrudHttpError(422)` (`commands/form-version.ts:126-147`), so this is correctly mapped; parent form stays `draft` with `currentPublishedVersionId` null |
| FORMS-VER-003 | P0 | Fork from a published version produces v2 and leaves v1 published | fork with `{fromVersionId: v1}`, then publish | published form from FORMS-VER-001 | fork from v1 → PATCH a changed label → publish | new version `versionNumber:2`; `GET /api/forms/:id` points at v2; `GET …/versions/v1` still readable with `status:'published'` or `'archived'` — pin the observed value |
| FORMS-VER-004 | P1 | Version diff reports the changed field | `GET /api/forms/[id]/versions/[versionId]/diff?against=<v1>` | v1 + v2 from FORMS-VER-003 | diff v2 against v1 | 200; the changed field key appears in the diff; an unchanged field does not |
| FORMS-VER-005 | P1 | Diff requires `against` and rejects a foreign version id | same | v1, v2, plus a version from another form | call with no `against`; call with a cross-form/cross-tenant `against` | 400 (zod) and 404 respectively |
| FORMS-VER-006 | P1 | Republishing an identical schema is rejected | fork → publish with the byte-identical schema | published form | fork, publish without editing | **422 `{error:'forms.errors.no_op_publish'}`** (`commands/form-version.ts:531-532`, guarded by `previous.schemaHash === compiled.schemaHash`) |
| FORMS-VER-009 | P1 | A second concurrent draft is refused | `POST /api/forms/[id]/versions/fork` ×2 | form with an open draft | fork twice without publishing | second call **422 `{error:'forms.errors.draft_already_exists'}`** (`form-version.ts:171`) |
| FORMS-VER-010 | P1 | A published version is frozen against edits | `PATCH …/versions/[versionId]` | published v1 | PATCH the published version's schema | **409 `{error:'forms.errors.version_is_frozen'}`** (`form-version.ts:318`) — the append-only/immutable-version contract |
| FORMS-VER-011 | P2 | Version id from another form is rejected | `PATCH`/`publish`/`diff` | two forms, each with a version | call form A's route with form B's `versionId` | **400 `{error:'forms.errors.version_form_mismatch'}`** (`form-version.ts:315/485/686`) |
| FORMS-VER-007 | P2 | `forms.view` can read a version but not patch it | `GET`/`PATCH …/versions/[versionId]` | `forms.view`-only role | GET then PATCH | 200 then 403 |
| FORMS-VER-008 | P1 | Cross-tenant version routes are 404 | `GET`/`PATCH`/`publish`/`diff` | second org | call all four with a foreign `formId`/`versionId` | all 404 |

### (c) Public runner: start, autosave, submit, resume, tamper

All of these must be issued from `withCredentialIsolatedRequest` and must set a unique
`x-forwarded-for` per spec.

| Id | P | Title | Routes | Fixtures | Steps | Assertions |
|---|---|---|---|---|---|---|
| FORMS-PUB-001 | P0 | Open-mode happy path: resolve → start → autosave → submit | `GET /api/forms/public/distributions/[slug]`, `POST /api/forms/public/start`, `PATCH /api/forms/public/submissions/[id]`, `POST …/submit` | `createPublishedFormFixture` + open distribution | GET by slug; POST start `{slug}`; PATCH `{base_revision_id, patch:{full_name:'Jane'}}`; POST submit `{base_revision_id}` | slug GET 200 with the compiled context and no `allowedDomains`; start 2xx with `submission`, `revision`, `access_token`; PATCH 200 with a new `revisionNumber`; submit 2xx with `status:'submitted'` and a server-derived `submitMetadata.ip`/`userAgent` |
| FORMS-PUB-002 | P0 | Stale `base_revision_id` on autosave ⇒ `STALE_BASE` 409 | `PATCH /api/forms/public/submissions/[id]` | started submission | PATCH once (rev 1→2); PATCH again reusing rev 1 | second call **409** `{error:'STALE_BASE'}` (see §2.2 — this is the real concurrency guard) |
| FORMS-PUB-003 | P0 | Access token is required and is scoped to one submission | `PATCH`/`POST …/submit` | two started submissions A and B | call A's routes with no bearer; with a garbage bearer; with **B's** token | 401/403 in all three; never 200. `resolveRuntimePrincipal` returns `null` on a present-but-invalid bearer and does **not** fall through to a session |
| FORMS-PUB-004 | P0 | A tampered access token is rejected | `PATCH /api/forms/public/submissions/[id]` | started submission | flip one hex char of the HMAC segment; truncate to 4 segments; set `exp` to the past | all rejected (`signature` / `malformed` / `expired` paths in `verifyAccessToken`) |
| FORMS-PUB-005 | P0 | Double submit is rejected | `POST …/submit` ×2 | submitted submission | submit twice | second 422 `INVALID_STATUS`; the submission keeps its original `submittedAt` |
| FORMS-PUB-006 | P1 | Autosave after submit is rejected | `PATCH …/submissions/[id]` | submitted submission | PATCH | 422 `INVALID_STATUS` |
| FORMS-PUB-007 | P1 | Answers failing the compiled AJV schema are rejected | `PATCH …/submissions/[id]` | schema with `required:['full_name']`, `minLength:1`, and `additionalProperties:false` semantics | PATCH `{patch:{full_name: 123}}`; PATCH `{patch:{not_a_field:'x'}}` | 400/422 `VALIDATION_FAILED` with the field named; no revision appended |
| FORMS-PUB-008 | P1 | Resume by GET returns the saved state | `GET /api/forms/public/submissions/[id]` | started + autosaved submission | GET with the access token | 200; `currentRevisionId` matches the last PATCH; role-sliced answers present |
| FORMS-PUB-009 | P1 | Save re-issues a slid access token | `PATCH …/submissions/[id]` | started submission | PATCH and read the response | response carries a fresh `access_token` distinct from the one start returned (token-authorized path only) |
| FORMS-PUB-010 | P1 | Server-side ending tamper check | `POST /api/forms/[id]/run/submissions` | published form with two endings and a jump condition | POST `{formVersionId, answers, hidden, endingKey:'<wrong ending>'}` | `accepted:false` / `reachedEndingKey` is the evaluator's ending, not the claimed one (R-3). **Flag:** this is the deprecated route; if F-3 removes it, drop this case |
| FORMS-RUN-030 | P0 | Portal runtime happy path (customer session, not token) | `GET /api/forms/by-key/[key]/active`, `POST /api/forms/form-submissions`, `PATCH /api/forms/form-submissions/[id]`, `POST …/submit` | `createCustomerUserFixture` + `portalLogin`; published form | all four calls with `portalCookieHeaders(session)` | by-key 200 with role-sliced schema; start 2xx; PATCH 200; submit 2xx. Unauthenticated variants all 401 |
| FORMS-RUN-031 | P1 | Cross-device resume token | `GET /api/forms/form-submissions/[id]/resume-token` | portal customer with an active actor row; a second customer without one | GET as the actor; GET as the non-actor | 200 with a 4-segment `submissionId.userId.exp.hmac` token for the actor; **403 `{error:'NO_ACTOR'}`** for the other |
| FORMS-RUN-032 | P1 | `by-subject` listing only returns submissions the caller acts on | `GET /api/forms/form-submissions/by-subject/[type]/[id]` | two customers, two submissions on the same subject | GET as each | each sees only their own; the other's id is absent |

### (d) Distributions, embed policy and invitations

| Id | P | Title | Routes | Fixtures | Steps | Assertions |
|---|---|---|---|---|---|---|
| FORMS-DIST-001 | P0 | Create an open distribution and resolve it publicly | `POST /api/forms/[id]/distributions`, `GET /api/forms/distributions/[id]`, `GET /api/forms/public/distributions/[slug]` | published form | POST `{mode:'open', defaultLocale:'en'}`; read back for `publicSlug`; GET the public route anonymously | POST 201; the read-back carries a non-null `publicSlug`; the public GET 200 with the served context |
| FORMS-DIST-002 | P0 | Closed / paused / not-yet-open / expired / capped distributions return 410 | `PATCH /api/forms/distributions/[id]`, `GET /api/forms/public/distributions/[slug]`, `POST /api/forms/public/start` | open distribution | PATCH `{status:'closed'}`; retry the public GET and start. Repeat with `{status:'paused'}`, with `opensAt` in the future, with `closesAt` in the past, and with `maxResponses:1` after one submit | all five ⇒ **410 `{error:'GONE'}`** on both the public GET and `start` (`distribution-service.ts:451-467`); the non-`active` case additionally carries `details.status` |
| FORMS-DIST-003 | P0 | `requireCustomerAuth` distributions refuse an anonymous start | `POST /api/forms/public/start` | distribution with `requireCustomerAuth:true` | anonymous start by slug | **409** `CUSTOMER_AUTH_REQUIRED` and **no** `access_token` in the body |
| FORMS-DIST-004 | P1 | Response cap is enforced atomically at submit | `POST /api/forms/public/submit` | `maxResponses:1`, two submissions started before either submits | start A, start B, submit A, submit B | A 2xx; B **410** *before* any state change — re-read B and assert it is still `draft`/`in_progress`, not `submitted` (the reserve-then-submit order in `public/submissions/[id]/submit/route.ts`) |
| FORMS-DIST-005 | P1 | `allowMultipleSubmissions:false` blocks a second run | `POST /api/forms/public/start` | open distribution, one submitted submission, same participant | start again | rejected (410/422 — pin the observed code) |
| FORMS-EMB-006 | P0 | Embed settings reject an enabled-but-empty allowlist | `POST`/`PATCH` distribution with `settings.embed` | published form | POST `{settings:{embed:{enabled:true, allowedDomains:[]}}}`; then `{enabled:true, allowedDomains:['http://evil.com']}`; then `['https://www.acme.com']` | first two 400/422 (`embedSettingsSchema` refine + `normalizeEmbedOrigin`); the third 201/200 |
| FORMS-EMB-007 | P0 | Embed policy returns the allowlist and fails closed | `GET /api/forms/public/distributions/[slug]/embed-policy` | embed-enabled distribution + a non-embeddable one + a bogus slug | GET all three anonymously | embeddable ⇒ `frame-ancestors https://www.acme.com`; non-embeddable and unknown ⇒ `frame-ancestors 'none'`; **never** a 500 |
| FORMS-EMB-008 | P1 | `allowedDomains` never leaks into the public context | `GET /api/forms/public/distributions/[slug]` | embed-enabled distribution | GET anonymously and stringify the whole body | the literal allowlisted host does **not** appear anywhere in the payload (R-RS-1) |
| FORMS-EMB-009 | P2 | Embed loader is served and is origin-locked | `GET /api/forms/public/embed-loader` | none | GET anonymously | 200; a JS content type; body contains `data-om-form` and an `event.origin` comparison plus the `om-forms:` prefix check (R-RS-4) |
| FORMS-INV-010 | P0 | Bulk invitation create returns each raw token exactly once | `POST /api/forms/distributions/[id]/invitations` | personal-mode distribution | POST 3 recipients; then `GET …/invitations` | POST 201 with 3 `{id, rawToken}`; the list GET returns the 3 ids **without** `rawToken` and **without** `recipient_email`/`recipient_name` (R-2d-3) |
| FORMS-INV-011 | P0 | Invitation token redemption end to end | `GET /api/forms/public/invitations/[token]`, `POST /api/forms/public/start` | invitation from FORMS-INV-010 | GET `/api/forms/public/invitations/{rawToken}` anonymously; POST start `{token}`; autosave; submit | GET 200 with a PII-free descriptor and marks the invitation `opened`; start 2xx with an `access_token`; the full flow completes; a second `GET` shows the `opened`/`submitted` transition |
| FORMS-INV-012 | P0 | Unknown / revoked / already-submitted invitation tokens are rejected | `GET /api/forms/public/invitations/[token]`, `POST /api/forms/public/start`, `POST …/invitations/[id]/send` | one invitation, then `DELETE …/invitations/[id]` | GET with a random 64-char token; GET with the revoked token; start with each; then try `send` on a revoked and on a submitted invitation | unknown ⇒ 404; revoked/submitted public paths ⇒ 410 `GONE`; `send` ⇒ **409 `forms.errors.invitation_revoked`** / **409 `forms.errors.invitation_submitted`** (`commands/invitation.ts:284-287`); a recipient with no email ⇒ **422 `forms.errors.invitation_no_email`**; no `access_token` ever minted |
| FORMS-INV-013 | P1 | Invitation send dispatches an email | `POST …/invitations/[invitationId]/send` | `seedSystemEmailChannel` + `clearCapturedSystemEmails` from `communicationChannelsFixtures`; invitation with an email recipient | POST send; `waitForCapturedSystemEmail` | one captured email to the recipient whose body contains the `/i/<token>` link built by `commands/invitation.ts:75`; the invitation's `sentAt` is set. *Requires `SYSTEM_EMAIL_PROVIDER=__test_seed__` — already set in CI* |
| FORMS-INV-014 | P1 | Invitation routes are tenant-scoped | all invitation routes | second org | call create/list/send/delete with a foreign `distributionId` | all 404 |
| FORMS-DIST-015 | P1 | Distribution routes require `forms.distribute` | all distribution + invitation routes | `forms.view`+`forms.design` role without `forms.distribute` | call each | all 403 |

### (e) Submissions inbox, revisions, reopen, actors, audit, anonymize, export, PDF

| Id | P | Title | Routes | Fixtures | Steps | Assertions |
|---|---|---|---|---|---|---|
| FORMS-SUB-001 | P0 | Admin submissions inbox lists and paginates | `GET /api/forms/[id]/submissions?page=&pageSize=` | published form + 3 submitted submissions | list default; `pageSize=1&page=2`; `pageSize=101` | default `pageSize` 25; page 2 returns the second row; `pageSize=101` rejected by zod (`.max(100)`); `total` correct |
| FORMS-SUB-002 | P0 | Admin submission detail is role-filtered and tenant-scoped | `GET /api/forms/submissions/[submissionId]` | submitted submission; second org | GET as the owning admin; GET as an org-B admin | 200 with the serialized submission (`id`, `status`, `currentRevisionId`, `submitMetadata`, `updatedAt`); org-B 404 |
| FORMS-SUB-003 | P0 | Revision timeline grows with each autosave | `GET /api/forms/submissions/[submissionId]/revisions` | submission with 3 autosaves | GET | 3+ revisions, `revisionNumber` strictly increasing, `changedFieldKeys` populated; **no decrypted answer payload in the body** |
| FORMS-SUB-004 | P0 | Reopen allows further saves | `POST …/reopen`, then `PATCH /api/forms/public/submissions/[id]` | submitted submission + valid access token | reopen as admin; PATCH as the participant | reopen 2xx with `status:'reopened'`; the subsequent PATCH 200 (it was 422 before reopen — assert both halves) |
| FORMS-SUB-005 | P1 | Reopen requires `forms.submissions.manage` | `POST …/reopen` | `forms.view`-only role | reopen | 403 |
| FORMS-SUB-006 | P1 | Assign and revoke an actor | `POST …/actors`, `DELETE …/actors/[actorId]` | submission + a staff user id | POST `{user_id, role:'<declared role>'}`; POST with `role:'not_a_declared_role'`; DELETE the created actor | valid 2xx; invalid 422 `INVALID_ROLE`; DELETE 2xx and the actor's `revoked_at` is set (the row survives) |
| FORMS-SUB-007 | P0 | Access-audit rows are written by reads and exports, and reading the audit writes none | `GET …/access-audit` after `GET …/export` | submitted submission | read the audit list (count N); call `GET …/export`; read again; read again | after export the count grew by exactly 1 with `access_purpose:'export'`; the two audit reads do **not** grow it; rows carry no answer payload |
| FORMS-SUB-008 | P0 | Anonymize requires the typed confirmation and tombstones sensitive fields | `POST …/anonymize` | submission built on `buildSensitiveFormSchema` with a sensitive answer | POST `{}`; POST `{confirm:'delete'}`; POST `{confirm:'DELETE'}`; then GET the detail and the revisions | first two 422 `forms.errors.confirmation_required`; the third 2xx; `anonymizedAt` set; the sensitive value is gone from every revision; the non-sensitive value survives; actor rows and audit rows survive; `submitMetadata` IP/UA cleared |
| FORMS-SUB-009 | P1 | Anonymize requires `forms.submissions.anonymize` specifically | `POST …/anonymize` | role with `forms.submissions.manage` but not `…anonymize` | POST with the correct body | 403 |
| FORMS-EXP-010 | P0 | Single-submission GDPR export | `GET /api/forms/submissions/[submissionId]/export` | submitted submission with a known answer | GET | 200; the document carries form key/name, version number, status, timestamps and the **decrypted** answers with human labels and types; attachments referenced by id, never inlined |
| FORMS-EXP-011 | P1 | Per-subject GDPR export covers every submission for the subject | `GET /api/forms/forms/subjects/[subjectType]/[subjectId]/export` | two submissions for one subject | GET | 200 with both submissions; one `export` audit row **per submission**. **Use the doubled path from F-1** |
| FORMS-EXP-012 | P1 | Export requires `forms.submissions.export` | both export routes | `forms.view`-only role | GET | 403 |
| FORMS-PDF-013 | P1 | PDF snapshot is generated lazily and is then immutable | `GET /api/forms/submissions/[submissionId]/pdf` ×2 | submitted submission | GET; GET again | both 200 `application/pdf`, body starts `%PDF`; the two bodies are byte-identical; an `export` audit row is written. **`test.setTimeout()` — generation can exceed the 20s default** |
| FORMS-PDF-014 | P1 | Participant can download their own PDF | `GET /api/forms/public/submissions/[id]/pdf` | submitted anonymous submission + its access token | GET with the token; GET with no token; GET with another submission's token | 200 / 401-403 / 404 |
| FORMS-PDF-015 | P2 | The queued PDF worker produces the same artifact | `drainIntegrationQueue('forms-pdf-snapshot')` | submitted submission | submit; drain the queue; GET the PDF | the snapshot exists without the lazy fallback having to render it (`pdfSnapshotAttachmentId` set before the first GET) |
| FORMS-CON-016 | P2 | Consent projection is PII-free | `GET /api/forms/forms/subjects/[type]/[id]/consents` | form with a `signature` field, one signed submission | submit; drain/await the `forms-consent-projector` subscriber; GET | 200; rows carry only the clause SHA-256, signed-at and status timestamps; **no** signature image, typed name or answer value anywhere in the body |
| FORMS-SUB-017 | P1 | Submission routes are tenant-scoped across the board | every `/api/forms/submissions/[submissionId]/*` route | second org | call all 10 sub-routes with a foreign submission id | all 404 |

### (f) Attachments

| Id | P | Title | Routes | Fixtures | Steps | Assertions |
|---|---|---|---|---|---|---|
| FORMS-ATT-001 | P0 | Anonymous upload → download round trip | `POST /api/forms/public/submissions/[id]/attachments`, `GET …/attachments/[attachmentId]` | `buildFileFieldFormSchema`; anonymous submission + access token | multipart POST a small PNG for the file field; GET it back; autosave the returned id into the field | POST 2xx `{id, filename, contentType, sizeBytes}`; GET returns the identical bytes; the autosave PATCH succeeds |
| FORMS-ATT-002 | P0 | Upload is rejected for a non-`file` field and for an unknown field | `POST …/attachments` | form with a text field only | POST targeting the text field, and a nonexistent field key | 404/422 — `resolveFieldUploadConfig` returns `null` unless `x-om-type === 'file'` |
| FORMS-ATT-003 | P0 | MIME allowlist and size ceiling are enforced server-side | `POST …/attachments` | file field with `x-om-accept:['image/png']`, `x-om-max-size-bytes` small | upload a `text/plain`; upload a PNG over the ceiling | both 4xx with an `AttachmentServiceError` code; nothing stored |
| FORMS-ATT-004 | P0 | Cross-submission attachment download is denied | `GET …/attachments/[attachmentId]` | two submissions, one attachment | GET A's attachment with B's token; GET with no token | 404 both (no enumeration) |
| FORMS-ATT-005 | P1 | Authenticated (portal) upload path | `POST /api/forms/form-submissions/[id]/attachments` | portal customer with an actor row; a second customer without one; no session | upload as each | actor 2xx; non-actor **403 `{error:'FORBIDDEN'}`**; no session **401 `{error:'UNAUTHORIZED'}`** (note the code differs from the resume-token route's `NO_ACTOR` — assert the literal string each route returns) |
| FORMS-ATT-006 | P1 | Admin download writes an export audit row | `GET /api/forms/submissions/[submissionId]/attachments/[attachmentId]` | attachment on a submitted submission | GET as admin; read the access audit | 200 with the bytes; one new `export` audit row |
| FORMS-ATT-007 | P2 | Theme-logo upload returns an opaque asset id in a public partition | `POST /api/forms/[id]/theme-logo` | published form; PNG under 2 MiB | POST multipart; POST an oversized file; POST a non-image | 2xx `{assetId}` (UUID) then two 4xx. Clean up with `deleteAttachmentPartitionIfExists`. *Needs `attachments` in `dependsOnModules`* |

### (g) Rate limiting and CAPTCHA

| Id | P | Title | Routes | Fixtures | Steps | Assertions |
|---|---|---|---|---|---|---|
| FORMS-RL-001 | P1 | Public start is rate-limited per client IP | `POST /api/forms/public/start` | open distribution; a **unique synthetic `x-forwarded-for`** for this spec | fire `FORMS_PUBLIC_RATE_LIMIT_PER_MIN + 5` (default 30) starts from that IP | at least one 429 with `{error:'RATE_LIMITED'}` and a `Retry-After` header. **Two hazards:** (1) the limiter **fails open** when `RateLimiterService` is unavailable — the spec must first probe and `test.skip()` with a reason rather than go red; (2) it must set its own XFF or it will exhaust the bucket for every later public spec (§1.6 rule 9). Consider setting `FORMS_PUBLIC_RATE_LIMIT_PER_MIN` low for the run rather than firing 35 requests |
| FORMS-RL-002 | P2 | A different client IP is unaffected | same | two synthetic IPs | exhaust IP-A, then call once from IP-B | IP-B 2xx — proves the key is per-IP, not global |
| FORMS-CAP-003 | P1 | CAPTCHA-gated distribution requires a token | `POST /api/forms/public/start` | distribution with `settings:{captcha:true}`, no `FORMS_CAPTCHA_PROVIDER` configured | start with no `captchaToken`; start with any non-empty `captchaToken` | first 422 `CAPTCHA_REQUIRED`; second 2xx (token *presence* only, since no provider is configured — `enforceCaptcha` in `public/start/route.ts`) |
| FORMS-CAP-004 | — **BQ / env-gated** | Real provider verification (`CAPTCHA_FAILED`) | same | requires `FORMS_CAPTCHA_PROVIDER` + `FORMS_CAPTCHA_SECRET` and a live Turnstile/reCAPTCHA endpoint | — | **Not an integration test.** Gate behind `requiredEnvVars: ['FORMS_CAPTCHA_PROVIDER','FORMS_CAPTCHA_SECRET']` if it is ever written, per `.ai/qa/AGENTS.md`; otherwise leave it to the unit test `__tests__/captcha-verifier.test.ts` |

### (h) Analytics

| Id | P | Title | Routes | Fixtures | Steps | Assertions |
|---|---|---|---|---|---|---|
| FORMS-ANA-001 | P1 | Analytics counts submissions and completions | `GET /api/forms/[id]/analytics` | published form; 3 submissions, 2 submitted | GET | 200; `funnel` totals match; `byDay` sums to the total; `timeToComplete` present |
| FORMS-ANA-002 | P0 | Analytics never returns raw answer values for sensitive or free-text fields | same | `buildSensitiveFormSchema` with a distinctive sensitive answer string and a free-text answer | submit; GET analytics; stringify the whole body | neither answer string appears anywhere; enumerable non-sensitive fields DO get `{value, count}` distributions. *This is the PII-safety contract — P0 despite the area being P1* |
| FORMS-ANA-003 | P1 | Analytics is tenant-scoped and feature-gated | same | second org; `forms.view`-less role | GET the foreign form id; GET without the feature | 404 and 403 |
| FORMS-ANA-004 | P2 | Window filters narrow the result | `?from=&to=` | submissions across two days | GET with a window covering one | counts reflect only the window |

### (i) Portal pages (`frontend/[orgSlug]/portal/forms/**`)

| Id | P | Title | Path | Fixtures | Steps | Assertions |
|---|---|---|---|---|---|---|
| FORMS-PORTAL-001 | P0 | Portal form page requires a customer session | `/{orgSlug}/portal/forms/{key}` | published form; org slug; no session | `page.goto` with no portal cookies | redirected to `/{orgSlug}/portal/login`, not rendered — enforced by the `(frontend)` catch-all from `requireCustomerAuth: true` |
| FORMS-PORTAL-002 | P0 | Signed-in customer renders and submits the form | `/{orgSlug}/portal/forms/{key}` | `createCustomerUserFixture` + UI portal login; published form | log in; open the page; fill the field; submit | the field is visible (locate by **placeholder or role**, not by label text — label text is the schema's `x-om-label` and is the thing most likely to churn); a completion state appears; `GET /api/forms/[id]/submissions` as admin shows the new submitted row |
| FORMS-PORTAL-003 | P1 | Continue page resumes a draft | `/{orgSlug}/portal/submissions/{id}/continue` | customer with an in-progress submission | open the page | the previously saved answer is prefilled; saving appends a revision |
| FORMS-PORTAL-004 | P1 | Portal page for a nonexistent / other-tenant form key | `/{orgSlug}/portal/forms/{bad-key}` | signed-in customer | open | a friendly unavailable/error state, not a stack trace or a blank page |
| FORMS-PORTAL-005 | — **BQ** | Portal sidebar entry for forms | portal nav | — | — | **There is none.** Neither portal page declares a `nav` block, so `/api/customer_accounts/portal/nav` will never list forms (F-4). Not a test — a product decision |

### (j) Backend Form Studio — integration vs browser QA

The Studio (`/backend/forms/[id]`) is a large `@dnd-kit` drag-and-drop canvas with palette, logic,
style, validation and preview panels. Drag-and-drop is the single most fragile thing to automate
and the least informative when it breaks. Split it:

| Id | P | Title | Path | Verdict |
|---|---|---|---|---|
| FORMS-UI-001 | P0 | Forms list page renders and is feature-gated | `/backend/forms` | **Integration.** `login(page,'admin')` → the list shows an API-created form by name; a `forms.view`-less user gets the denied state |
| FORMS-UI-002 | P0 | Create form via the UI persists | `/backend/forms/create` | **Integration.** Fill key + name + locale, submit, assert the redirect and that `GET /api/forms` returns the row. Locate inputs by **placeholder**, per the house convention |
| FORMS-UI-003 | P1 | Studio loads a published form without error | `/backend/forms/[id]` | **Integration, shallow.** Assert the canvas mounts, the existing field's label is on screen, and no error boundary. Do not drag |
| FORMS-UI-004 | P1 | Submissions tab lists a submission and opens the drawer | `/backend/forms/[id]/submissions` | **Integration.** API-create a submission, open the tab, assert the row, open the detail drawer |
| FORMS-UI-005 | P1 | Distributions tab creates a distribution and reveals the public link | `/backend/forms/[id]/distributions` | **Integration.** Create via the UI, assert the slug URL is shown, then `GET /api/forms/public/distributions/{slug}` anonymously returns 200 |
| FORMS-UI-006 | P2 | Analytics tab renders without data and with data | `/backend/forms/[id]/analytics` | **Integration, shallow.** Empty state, then non-zero counts |
| FORMS-UI-007 | P2 | History tab shows both versions | `/backend/forms/[id]/history` | **Integration, shallow.** Two versions listed after a fork+publish |
| — | — | Drag a palette field onto the canvas; reorder; resize in the grid; the logic/condition builder; the style panel and live preview; signature drawing; matrix/ranking/scale widgets | Studio | **Browser QA only.** Pointer-event-heavy, layout-dependent, and already covered by 20+ jest unit tests (`grid-collision`, `grid-resize-math`, `grid-keyboard-coordinates`, `condition-builder`, `style-compiler`, `signature-field`, `matrix-field`, `ranking-field`, …). Automating them as Playwright specs buys little and costs a permanent flake source |
| — | — | Visual/branding: theme logo rendering, contrast, dark mode, `/embed/[slug]` inside a real third-party iframe | `/f/[slug]`, `/embed/[slug]` | **Browser QA.** The *policy* is covered by FORMS-EMB-006/007/008; the rendering is a screenshot question |

## 2.5 Suggested shipping order

**P0 — 42 cases.** The contract, tenant isolation and the two happy paths the module exists for:

```
FORMS-CRUD-001 002 003 004      FORMS-ACL-005 006       FORMS-TEN-008 009
FORMS-AUTH-011                  FORMS-VER-001 002 003
FORMS-PUB-001 002 003 004 005   FORMS-RUN-030
FORMS-DIST-001 002 003          FORMS-EMB-006 007
FORMS-INV-010 011 012           FORMS-SUB-001 002 003 004 007 008
FORMS-EXP-010                   FORMS-ATT-001 002 003 004
FORMS-ANA-002                   FORMS-PORTAL-001 002    FORMS-UI-001 002
```

Rationale for the four that look like they belong lower: **FORMS-AUTH-011** is the only case that
exercises `withCredentialIsolatedRequest`, and without it the whole suite's "unauthenticated is
rejected" claims are suspect (§1.6 rule 7). **FORMS-ANA-002** is a PII-leak guard, not an
analytics feature. **FORMS-EMB-006/007** are the framing-security posture. **FORMS-SUB-007** is
the audit-chain guard that the GDPR story rests on.

**P1 — 41 cases.** Rest of the version lifecycle (FORMS-VER-004..011), remaining runtime
(FORMS-PUB-006..010, FORMS-RUN-031/032), distribution caps and ACL (FORMS-DIST-004/005/015,
FORMS-EMB-008, FORMS-INV-013/014), submissions/GDPR/PDF (FORMS-SUB-005/006/009/017,
FORMS-EXP-011/012, FORMS-PDF-013/014), attachments (FORMS-ATT-005/006), rate limit and captcha
(FORMS-RL-001, FORMS-CAP-003), analytics (FORMS-ANA-001/003), portal (FORMS-PORTAL-003/004),
UI (FORMS-UI-003/004/005), plus **FORMS-LOCK-001 once §2.2 is implemented**.

**P2 — 10 cases.** Embed-loader internals, consent projection, queue-driven PDF, analytics
windows, theme logo, the shallow UI tabs, the cross-IP rate-limit check.

Counts were taken from the tables themselves, not estimated:

```
$ awk -F'|' '/^\| FORMS-[A-Z]+-[0-9]+ \|/ {gsub(/ /,"",$2); print $2"\t"$3}' \
    .ai/analysis/forms-integration-test-plan.md | sort -u | awk -F'\t' '{split($2,a," "); print a[1]}' \
  | sort | uniq -c
     42 P0
     41 P1
     10 P2
      2 —      (FORMS-CAP-004, FORMS-PORTAL-005 — browser QA / not a test)
```

## 2.6 Cases that cannot be integration-tested

| Case | Why | Where it belongs |
|---|---|---|
| FORMS-LOCK-001 | The feature does not exist (§2.2) | Implement first, then test |
| FORMS-CAP-004 | Needs a live Turnstile/reCAPTCHA secret | Unit test `__tests__/captcha-verifier.test.ts`, or env-gated with `requiredEnvVars` |
| Studio drag/drop, grid resize, condition builder, style panel, signature canvas | Pointer-event and layout dependent; 20+ jest unit tests already cover the maths | Browser QA |
| `/embed/[slug]` framed by a real external origin | Needs a second origin serving the host page | Browser QA; the CSP value itself is FORMS-EMB-007 |
| Retention purge (`forms-retention-purge`) | Needs submissions older than `retentionDays` (min 1 day) | Unit test `__tests__/retention.test.ts`; an integration variant would need clock control |
| Visual/branding, dark mode, contrast | Screenshot questions | Browser QA / `om-ds-guardian` |

## 2.7 Findings to hand back to the implementation tasks

These came out of the mapping and are **code issues, not test items**. Repeated here so they are
not lost in the tables:

| # | Finding | Evidence |
|---|---|---|
| F-1 | GDPR subject routes are mounted at the doubled `/api/forms/forms/subjects/…`; docstrings and OpenAPI say `/api/forms/subjects/…` | `api-route-metadata.generated.ts`; `module-registry.ts:2394` |
| F-2 | `GET /api/forms/[id]/run/context` is unauthenticated **and unscoped** — no org/tenant filter, no distribution gate | `api/[id]/run/context/route.ts:37` |
| F-3 | `frontend/forms/[id]/run/page.tsx` has no `page.meta.ts` (metadata `undefined`) and is the only caller of the `@deprecated` `POST /api/forms/[id]/run/submissions` | `frontend-routes.generated.ts:271`; `runner/FormRunner.tsx` |
| F-4 | Portal pages gate on `requireCustomerAuth` only; `setup.ts` declares no `defaultCustomerRoleFeatures`; no portal `nav` block | `frontend/[orgSlug]/portal/**/page.meta.ts`; `setup.ts` |
| F-5 | `setup.ts` `defaultRoleFeatures` covers `admin` only | `setup.ts` |
| F-6 | No optimistic locking anywhere in the module, against the root `AGENTS.md` § Always rule | zero grep hits (§2.2) |
| F-7 | `packages/core/src/modules/core/__integration__/helpers/s3Fixtures.ts` re-exports a canonical file that no longer exists | `ls packages/core/src/helpers/integration/` |
| F-8 | `yarn install` in a fresh worktree leaves `better-sqlite3@13.0.3` and `cpu-features@0.0.10` unbuilt (`YN0009`) while still exiting 0 | §1.7 |
| F-9 | Route-layer `schema.parse()` ZodErrors leak to **500 `forms.errors.internal`** on the admin routes, contradicting each route's own OpenAPI `errors` (400/422). Domain `CrudHttpError`s are fine; only malformed payload/query probes are affected | `api/helpers.ts:62`; zero `ZodError` hits in the module |
| F-10 | The ephemeral lane cannot boot from a clean checkout: `apps/mercato/.env` ships `JWT_SECRET=change-me-dev-secret`, and the app runs under `NODE_ENV=production`, where `packages/shared/src/lib/auth/jwt.ts` **refuses to start** on a published placeholder. CI sidesteps this with a job-level `JWT_SECRET`; a local run must export one | §1.7 |
| F-11 | **The forms PR's `ephemeral-integration` shard is green on nothing today** — `OM_INTEGRATION_MODULES=forms` matches zero specs, so the config falls back to the `expect(true).toBe(true)` sentinel | §1.7 |
