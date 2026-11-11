import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';

type ListBody = { items?: Array<{ id: string }>; error?: string };

/**
 * TC-DIR-019: Organization list rejects malformed `ids`
 * Covers: GET /api/directory/organizations?ids=… for the options, manage and tree views
 *
 * A malformed or mixed valid/malformed `ids` list is a client error (400 + `Invalid query`,
 * translated into the caller's language) rather than an internal error; a valid but unknown
 * id still yields an empty list and a valid id still returns the organization.
 */
test.describe('TC-DIR-019: Organization list rejects malformed ids', () => {
  const views = ['options', 'manage', 'tree'] as const;
  const unknownOrgId = '99999999-9999-4999-8999-999999999999';
  const invalidQueryByLanguage = [
    { language: 'en', error: 'Invalid query' },
    { language: 'pl', error: 'Nieprawidłowe zapytanie' },
  ];
  let token = '';
  let tenantId = '';
  let orgId: string | null = null;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'superadmin');
    tenantId = getTokenContext(token).tenantId;
    const response = await apiRequest(request, 'POST', '/api/directory/organizations', {
      token,
      data: { name: `QA TC-DIR-019 ${Date.now()}`, tenantId },
    });
    expect(response.status(), 'POST /api/directory/organizations should return 201').toBe(201);
    const body = await readJsonSafe<{ id?: string }>(response);
    orgId = expectId(body?.id, 'Organization creation response should include id');
  });

  test.afterAll(async ({ request }) => {
    await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', orgId);
  });

  for (const view of views) {
    test(`rejects malformed and mixed ids with 400 (view=${view})`, async ({ request }) => {
      for (const ids of ['abc', `${orgId},not-a-uuid`]) {
        for (const { language, error } of invalidQueryByLanguage) {
          const response = await apiRequest(
            request,
            'GET',
            `/api/directory/organizations?view=${view}&ids=${encodeURIComponent(ids)}`,
            { token, headers: { 'Accept-Language': language } },
          );
          expect(response.status(), `ids=${ids} (${language}) should be rejected`).toBe(400);
          const body = await readJsonSafe<ListBody>(response);
          expect(body?.error).toBe(error);
          expect(body?.items ?? []).toHaveLength(0);
        }
      }
    });
  }

  test('returns an empty list for a valid but unknown id', async ({ request }) => {
    const response = await apiRequest(
      request,
      'GET',
      `/api/directory/organizations?view=options&ids=${unknownOrgId}`,
      { token },
    );
    expect(response.status()).toBe(200);
    const body = await readJsonSafe<ListBody>(response);
    expect(body?.items ?? []).toHaveLength(0);
  });

  test('returns the organization for a valid id', async ({ request }) => {
    for (const view of ['options', 'manage'] as const) {
      const response = await apiRequest(
        request,
        'GET',
        `/api/directory/organizations?view=${view}&tenantId=${encodeURIComponent(tenantId)}&ids=${orgId}&status=all`,
        { token },
      );
      expect(response.status(), `view=${view} should return 200`).toBe(200);
      const body = await readJsonSafe<ListBody>(response);
      expect(body?.items?.map((item) => item.id)).toContain(orgId);
    }
  });
});
