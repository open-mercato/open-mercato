import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-PLAN-CRUDFORM-001: Availability rule-set CrudForm persists every field (#2466).
 *
 * Planner's availability rule-set is a Tier B surface (MODULE-LEDGER B4): the create/edit pages
 * build the save payload by hand (`buildAvailabilityRuleSetPayload`) on top of a makeCrud route,
 * so this spec proves that hand-written save path + the route round-trip every field the form
 * exposes — on both create and update.
 *
 * The rule-set surface is scalar-only: `name`, `description`, `timezone`. The planner module
 * declares no custom fields (`ce.ts` is empty and nothing defines `cf.*` for the entity) and the
 * `PlannerAvailabilityRuleSet` entity has no dictionary references or multiselect/array columns.
 * So — per the sweep's "where applicable" rule — this mirrors the pure-scalar currencies
 * reference (TC-CUR-CRUDFORM-001). The route still wires custom-field decoration, but there are
 * none declared to assert.
 *
 * Verified contract:
 * - Create returns 201 `{ id }` (mapped from the command's `ruleSetId`); update returns 200 `{ ok }`.
 * - The list GET filters by `?ids=` (comma-separated), NOT `?id=` — so a custom `readById`.
 * - Request bodies are camelCase; the list response exposes `name`/`description`/`timezone`.
 * - Scope (`organizationId`/`tenantId`) is taken from the caller's token.
 * - Self-contained: the only record created is the rule-set itself, deleted by the harness in `finally`.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const RULE_SETS_PATH = '/api/planner/availability-rule-sets';

async function readRuleSetByIds(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${RULE_SETS_PATH}?ids=${encodeURIComponent(id)}&page=1&pageSize=100`,
    { token },
  );
  expect(response.status(), `read-back availability rule-sets failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<{ items?: CrudRecord[] }>(response);
  return (body?.items ?? []).find((item) => item.id === id) ?? null;
}

test.describe('TC-PLAN-CRUDFORM-001: Availability rule-set CrudForm persists every field', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips name, description, timezone scalars on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const { organizationId, tenantId } = getTokenContext(token);
    const stamp = Date.now();

    await runCrudFormRoundTrip({
      request,
      token,
      collectionPath: RULE_SETS_PATH,
      readById: (id) => readRuleSetByIds(request, token, id),
      create: {
        payload: {
          organizationId,
          tenantId,
          name: `QA CRUDFORM Schedule ${stamp}`,
          description: 'Original schedule description',
          timezone: 'America/New_York',
        },
      },
      expectAfterCreate: {
        scalars: {
          name: `QA CRUDFORM Schedule ${stamp}`,
          description: 'Original schedule description',
          timezone: 'America/New_York',
        },
      },
      update: {
        payload: (id) => ({
          id,
          name: `QA CRUDFORM Schedule ${stamp} EDITED`,
          description: 'Updated schedule description',
          timezone: 'Europe/Warsaw',
        }),
      },
      expectAfterUpdate: {
        scalars: {
          name: `QA CRUDFORM Schedule ${stamp} EDITED`,
          description: 'Updated schedule description',
          timezone: 'Europe/Warsaw',
        },
      },
    });
  });
});
