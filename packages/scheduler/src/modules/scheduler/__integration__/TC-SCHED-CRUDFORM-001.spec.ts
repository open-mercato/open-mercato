import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-SCHED-CRUDFORM-001: Scheduled Job CrudForm persists scope, target + payload JSON (#2466).
 *
 * The scheduler's scheduled-job is the Tier-B "JSON-bearing scalar" surface: scope
 * (scopeType, server-derived org/tenant), schedule (scheduleType/scheduleValue/timezone),
 * target (targetType/targetQueue), and a nested `targetPayload` JSON object. Proves create +
 * update round-trip every value.
 *
 * Verified contract (differs from the makeCrud-default reference specs):
 * - The list GET filters by `?id=` (single uuid), not the `?ids=` other sweep modules use; the
 *   explicit `readById` documents that contract and mirrors the sibling specs (the shared
 *   harness default reads back via `?id=` too).
 * - Read-back is camelCase: the list `transformItem` maps every column to camelCase
 *   (`scopeType`, `scheduleType`, `targetPayload`, `isEnabled`, ...), so the scalar
 *   expectations use camelCase keys (not the snake_case of resources/staff).
 * - The scheduled-job declares no custom entity (no `ce.ts`), so there are no `cf_*` fields —
 *   the surface is scalars + nested JSON only.
 * - Scope is derived server-side from the caller's auth context and is immutable on update:
 *   `scopeType: 'organization'` fills org+tenant from the admin token and survives the edit.
 * - Update is a partial PUT: omitted target fields are retained, so the update changes the
 *   payload JSON while proving `targetType`/`targetQueue` survive untouched.
 * - Harness cleanup deletes via `?id=`; the scheduler delete resolves the id from the query
 *   string, so the default `finally` cleanup removes the fixture.
 *
 * Self-contained: the job needs no pre-created fixtures (queue target + inline JSON), and the
 * harness deletes it in `finally`.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const SCHEDULER_JOBS_PATH = '/api/scheduler/jobs';

async function readScheduledJobById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(
    request,
    'GET',
    `${SCHEDULER_JOBS_PATH}?id=${encodeURIComponent(id)}&page=1&pageSize=100`,
    { token },
  );
  expect(response.status(), `read-back scheduler jobs failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<{ items?: CrudRecord[] }>(response);
  return (body?.items ?? []).find((item) => item.id === id) ?? null;
}

test.describe('TC-SCHED-CRUDFORM-001: Scheduled Job CrudForm persists scope, target + payload JSON', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips scalars, scope, target + nested payload JSON on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();

    const createPayload = {
      source: 'integration-test',
      attempts: 3,
      retries: { max: 5, backoff: 'exponential' },
      tags: ['alpha', 'beta'],
    };
    const updatePayload = {
      source: 'integration-test-edited',
      attempts: 1,
      retries: { max: 0, backoff: 'fixed' },
      tags: ['gamma'],
    };

    await runCrudFormRoundTrip({
      request,
      token,
      collectionPath: SCHEDULER_JOBS_PATH,
      readById: (id) => readScheduledJobById(request, token, id),
      create: {
        payload: {
          name: `QA CRUDFORM Scheduled Job ${stamp}`,
          description: 'Original scheduled job description',
          scopeType: 'organization',
          scheduleType: 'interval',
          scheduleValue: '15m',
          timezone: 'UTC',
          targetType: 'queue',
          targetQueue: 'scheduler-execution',
          targetPayload: createPayload,
          isEnabled: true,
          sourceType: 'user',
        },
      },
      expectAfterCreate: {
        scalars: {
          name: `QA CRUDFORM Scheduled Job ${stamp}`,
          description: 'Original scheduled job description',
          scopeType: 'organization',
          scheduleType: 'interval',
          scheduleValue: '15m',
          timezone: 'UTC',
          targetType: 'queue',
          targetQueue: 'scheduler-execution',
          targetCommand: null,
          targetPayload: createPayload,
          isEnabled: true,
          sourceType: 'user',
        },
      },
      update: {
        payload: (id) => ({
          id,
          name: `QA CRUDFORM Scheduled Job ${stamp} EDITED`,
          description: 'Updated scheduled job description',
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          timezone: 'Europe/Warsaw',
          targetPayload: updatePayload,
          isEnabled: false,
        }),
      },
      expectAfterUpdate: {
        scalars: {
          name: `QA CRUDFORM Scheduled Job ${stamp} EDITED`,
          description: 'Updated scheduled job description',
          scopeType: 'organization',
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          timezone: 'Europe/Warsaw',
          targetType: 'queue',
          targetQueue: 'scheduler-execution',
          targetCommand: null,
          targetPayload: updatePayload,
          isEnabled: false,
        },
      },
    });
  });
});
