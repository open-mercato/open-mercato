import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  assertScalarFieldsPersisted,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-INTEG-CRUDFORM-001: Integration credentials CrudForm persists every field (#2466, #2561).
 *
 * `integrations` is a Tier B surface (MODULE-LEDGER.md): credentials are NOT a makeCrud
 * collection route. They are a registry-keyed key/value blob behind
 * `PUT|GET /api/integrations/:id/credentials` — there is no `?id=`/`?ids=` list, no POST/DELETE,
 * and a save is a full-blob upsert. So `runCrudFormRoundTrip` (which assumes a collection route
 * with POST/PUT/DELETE + a `?id=` list GET) does not fit; this spec drives the
 * save → read-back → assert → update → read-back → assert cycle inline, reusing only the sweep
 * gate (`skipIfCrudFormExtensionTestsDisabled`) and the shared scalar matcher
 * (`assertScalarFieldsPersisted`).
 *
 * Verified contract (`api/[id]/credentials/route.ts` + `lib/credentials-service.ts`):
 * - The save body is `{ credentials: Record<string, string | number | boolean | null> }`
 *   (`saveCredentialsSchema`, ≤200 keys); the route does NOT enforce the provider's declared
 *   schema, so any secret/text/select-shaped keys round-trip.
 * - The GET returns `{ integrationId, schema, credentials }` with `credentials` DECRYPTED
 *   verbatim (no field masking — encryption is at-rest only), so exact-value assertions are valid.
 * - Both verbs require `integrations.credentials.manage` (the seeded admin has it).
 *
 * Self-contained: the integration provider is discovered at runtime from `GET /api/integrations`
 * (no hard-coded provider id); the spec skips on a provider-less install. Credentials need tenant
 * data encryption, so it probes the GET and skips on 503. The admin home-org credential row is
 * shared/meaningful (it is not a throwaway entity), so cleanup RESTORES the pre-test blob in
 * `finally` rather than deleting it — mirroring TC-INT-008.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */

async function pickIntegrationId(request: APIRequestContext, token: string): Promise<string | null> {
  const response = await apiRequest(request, 'GET', '/api/integrations', { token });
  if (response.status() !== 200) return null;
  const body = await readJsonSafe<{ items?: CrudRecord[] }>(response);
  const items = Array.isArray(body?.items) ? body!.items : [];
  return items.length > 0 ? String(items[0].id) : null;
}

async function readCredentials(
  request: APIRequestContext,
  token: string,
  integrationId: string,
): Promise<{ status: number; credentials: CrudRecord }> {
  const response = await apiRequest(request, 'GET', `/api/integrations/${integrationId}/credentials`, { token });
  const body = (await readJsonSafe<{ credentials?: CrudRecord }>(response)) ?? {};
  const credentials =
    body.credentials && typeof body.credentials === 'object' ? (body.credentials as CrudRecord) : {};
  return { status: response.status(), credentials };
}

test.describe('TC-INTEG-CRUDFORM-001: Integration credentials CrudForm persists every field on save + update', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips secret/text/select credential fields on save and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');

    const integrationId = await pickIntegrationId(request, token);
    if (!integrationId) {
      test.skip(true, 'No integration provider modules registered — skipping credentials CrudForm coverage');
      return;
    }
    const credentialsPath = `/api/integrations/${integrationId}/credentials`;

    // Probe encryption (the credentials surface requires tenant data encryption) and capture the
    // pre-test blob so it can be restored in `finally`.
    const initial = await readCredentials(request, token, integrationId);
    if (initial.status === 503) {
      test.skip(true, 'Integration credentials encryption is unavailable in this environment');
      return;
    }
    expect(initial.status, 'credentials GET should be 200 when encryption is available').toBe(200);
    const originalCredentials = initial.credentials;

    const stamp = Date.now();
    // secret / text / select are the headline kinds for this surface; number/boolean/null exercise
    // the rest of the saveCredentialsSchema value union so "every field value persists" holds here.
    const savedCredentials: CrudRecord = {
      apiSecret: `sk_crudform_${stamp}`,
      displayLabel: `QA CRUDFORM Integration ${stamp}`,
      environment: 'sandbox',
      maxConnections: 3,
      verboseLogging: true,
      legacyToken: `legacy_${stamp}`,
    };

    try {
      const saveResponse = await apiRequest(request, 'PUT', credentialsPath, {
        token,
        data: { credentials: savedCredentials },
      });
      expect(saveResponse.status(), 'save credentials should be 200').toBe(200);

      const afterSave = await readCredentials(request, token, integrationId);
      expect(afterSave.status, 'read-back after save should be 200').toBe(200);
      assertScalarFieldsPersisted(afterSave.credentials, savedCredentials, 'after-save');

      // Update: rotate the secret, edit the text, switch the select, change number/boolean, and
      // clear a secret with null — proving an edit round-trips and a null clears the stored value.
      const updatedCredentials: CrudRecord = {
        apiSecret: `sk_crudform_${stamp}_ROTATED`,
        displayLabel: `QA CRUDFORM Integration ${stamp} EDITED`,
        environment: 'production',
        maxConnections: 5,
        verboseLogging: false,
        legacyToken: null,
      };
      const updateResponse = await apiRequest(request, 'PUT', credentialsPath, {
        token,
        data: { credentials: updatedCredentials },
      });
      expect(updateResponse.status(), 'update credentials should be 200').toBe(200);

      const afterUpdate = await readCredentials(request, token, integrationId);
      expect(afterUpdate.status, 'read-back after update should be 200').toBe(200);
      assertScalarFieldsPersisted(afterUpdate.credentials, updatedCredentials, 'after-update');
      expect(afterUpdate.credentials.legacyToken, 'a secret cleared to null persists as null').toBeNull();
    } finally {
      await apiRequest(request, 'PUT', credentialsPath, {
        token,
        data: { credentials: originalCredentials },
      }).catch(() => undefined);
    }
  });
});
