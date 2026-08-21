import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-WH-CRUDFORM-001: Webhook CrudForm persists scalars, the events multiselect, and the
 * custom-headers JSON object (#2466, Tier B — hand-written / non-makeCrud saves).
 *
 * Webhooks is the first hand-written surface in the sweep. The backend CrudForm
 * (`backend/webhooks`) submits through the canonical, hand-written routes — `POST /api/webhooks`,
 * `PUT /api/webhooks/:id`, `DELETE /api/webhooks/:id` — NOT the makeCrud `/api/webhooks/webhooks`
 * alias, so this spec drives those exact endpoints via the harness `recordPath` seam to prove the
 * real form-submit path persists every field.
 *
 * Verified contract:
 * - Responses are camelCase (hand-written serializer), so scalar assertions use camelCase keys.
 * - `subscribedEvents` is a multiselect string[] (the form `tags` field); `customHeaders` is a JSON
 *   object (the form `JsonBuilder`). Both round-trip through deep equality.
 * - `PUT /api/webhooks/:id` is a partial patch; the spec sends the full field set on update.
 * - Read-back uses the detail GET `/api/webhooks/:id` — the list GET omits `customHeaders` and has no
 *   `id` filter. Cleanup soft-deletes via `DELETE /api/webhooks/:id` in the harness `finally`.
 * - The webhook entity has no custom fields, so the rich coverage here is the multiselect + JSON.
 * - Self-contained: a single webhook fixture, created and deleted within the round-trip.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const WEBHOOKS_PATH = '/api/webhooks';

async function readWebhookById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(request, 'GET', `${WEBHOOKS_PATH}/${encodeURIComponent(id)}`, { token });
  if (response.status() === 404) return null;
  expect(response.status(), `read-back webhook failed: ${response.status()}`).toBe(200);
  const body = await readJsonSafe<CrudRecord>(response);
  return body && body.id === id ? body : null;
}

test.describe('TC-WH-CRUDFORM-001: Webhook CrudForm persists scalars, events multiselect + headers JSON', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips scalars, subscribedEvents array, and customHeaders JSON on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const createEvents = ['catalog.product.created', 'catalog.product.updated'];
    const updateEvents = ['sales.quote.created', 'catalog.product.deleted', 'sales.order.placed'];
    const createHeaders = { 'X-Source': 'om-qa', 'X-Trace': `crudform-${stamp}` };
    const updateHeaders = { 'X-Env': 'integration', 'X-Rotated': 'true' };

    await runCrudFormRoundTrip({
      request,
      token,
      collectionPath: WEBHOOKS_PATH,
      recordPath: (id) => `${WEBHOOKS_PATH}/${encodeURIComponent(id)}`,
      readById: (id) => readWebhookById(request, token, id),
      create: {
        payload: {
          name: `QA CRUDFORM Webhook ${stamp}`,
          description: 'Original webhook description',
          url: `https://example.com/hooks/crudform-${stamp}`,
          subscribedEvents: createEvents,
          httpMethod: 'POST',
          maxRetries: 3,
          timeoutMs: 5000,
          rateLimitPerMinute: 0,
          autoDisableThreshold: 5,
          customHeaders: createHeaders,
        },
      },
      expectAfterCreate: {
        scalars: {
          name: `QA CRUDFORM Webhook ${stamp}`,
          description: 'Original webhook description',
          url: `https://example.com/hooks/crudform-${stamp}`,
          subscribedEvents: createEvents,
          httpMethod: 'POST',
          isActive: true,
          maxRetries: 3,
          timeoutMs: 5000,
          rateLimitPerMinute: 0,
          autoDisableThreshold: 5,
          customHeaders: createHeaders,
        },
      },
      update: {
        payload: () => ({
          name: `QA CRUDFORM Webhook ${stamp} EDITED`,
          description: 'Updated webhook description',
          url: `https://example.com/hooks/crudform-${stamp}-edited`,
          subscribedEvents: updateEvents,
          httpMethod: 'PUT',
          isActive: false,
          maxRetries: 7,
          timeoutMs: 20000,
          rateLimitPerMinute: 120,
          autoDisableThreshold: 25,
          customHeaders: updateHeaders,
        }),
      },
      expectAfterUpdate: {
        scalars: {
          name: `QA CRUDFORM Webhook ${stamp} EDITED`,
          description: 'Updated webhook description',
          url: `https://example.com/hooks/crudform-${stamp}-edited`,
          subscribedEvents: updateEvents,
          httpMethod: 'PUT',
          isActive: false,
          maxRetries: 7,
          timeoutMs: 20000,
          rateLimitPerMinute: 120,
          autoDisableThreshold: 25,
          customHeaders: updateHeaders,
        },
      },
    });
  });
});
