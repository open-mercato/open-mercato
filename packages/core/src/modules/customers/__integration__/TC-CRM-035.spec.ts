import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createPersonFixture,
  createCompanyFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-035: Nested profile payload normalization for PUT people & companies
 *
 * Regression coverage for issue #793.
 *
 * Verifies that:
 * 1. PUT /api/customers/people with nested profile.linkedInUrl persists the value end-to-end.
 * 2. PUT /api/customers/people with an unsupported nested profile key returns 400.
 * 3. PUT /api/customers/people with a malformed (non-object) profile returns 400.
 * 4. PUT /api/customers/people with top-level + nested keeps top-level precedence.
 * 5. PUT /api/customers/companies with nested profile.legalName persists the value.
 * 6. PUT /api/customers/companies with an unsupported nested profile key returns 400.
 * 7. PUT /api/customers/companies with a malformed profile returns 400.
 */
test.describe('TC-CRM-035: Nested profile payload normalization', () => {
  // --- People ---

  test('PUT /api/customers/people with nested profile.linkedInUrl persists the value', async ({ request }) => {
    let token: string | null = null;
    let personId: string | null = null;

    try {
      token = await getAuthToken(request);
      const ts = Date.now();
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM035a${ts}`,
        displayName: `QA TC-CRM-035a ${ts}`,
      });

      const putResponse = await apiRequest(request, 'PUT', '/api/customers/people', {
        token,
        data: {
          id: personId,
          profile: {
            linkedInUrl: 'https://linkedin.com/in/nested-crm035',
          },
        },
      });
      expect(putResponse.ok(), `PUT failed: ${putResponse.status()}`).toBeTruthy();
      const putBody = await readJsonSafe<Record<string, unknown>>(putResponse);
      expect(putBody).toEqual({ ok: true });

      const getResponse = await apiRequest(request, 'GET', `/api/customers/people/${personId}`, { token });
      expect(getResponse.ok(), `GET failed: ${getResponse.status()}`).toBeTruthy();
      const detail = await readJsonSafe<Record<string, unknown>>(getResponse);
      const profile = detail!.profile as Record<string, unknown>;
      expect(profile.linkedInUrl).toBe('https://linkedin.com/in/nested-crm035');
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });

  test('PUT /api/customers/people with multiple nested profile fields persists all values', async ({ request }) => {
    let token: string | null = null;
    let personId: string | null = null;

    try {
      token = await getAuthToken(request);
      const ts = Date.now();
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM035b${ts}`,
        displayName: `QA TC-CRM-035b ${ts}`,
      });

      const putResponse = await apiRequest(request, 'PUT', '/api/customers/people', {
        token,
        data: {
          id: personId,
          profile: {
            department: 'Engineering',
            timezone: 'Europe/Warsaw',
          },
        },
      });
      expect(putResponse.ok(), `PUT failed: ${putResponse.status()}`).toBeTruthy();

      const getResponse = await apiRequest(request, 'GET', `/api/customers/people/${personId}`, { token });
      expect(getResponse.ok()).toBeTruthy();
      const detail = await readJsonSafe<Record<string, unknown>>(getResponse);
      const profile = detail!.profile as Record<string, unknown>;
      expect(profile.department).toBe('Engineering');
      expect(profile.timezone).toBe('Europe/Warsaw');
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });

  test('PUT /api/customers/people with top-level + nested gives top-level precedence', async ({ request }) => {
    let token: string | null = null;
    let personId: string | null = null;

    try {
      token = await getAuthToken(request);
      const ts = Date.now();
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM035c${ts}`,
        displayName: `QA TC-CRM-035c ${ts}`,
      });

      const putResponse = await apiRequest(request, 'PUT', '/api/customers/people', {
        token,
        data: {
          id: personId,
          linkedInUrl: 'https://linkedin.com/in/top-level-wins',
          profile: {
            linkedInUrl: 'https://linkedin.com/in/nested-loses',
          },
        },
      });
      expect(putResponse.ok(), `PUT failed: ${putResponse.status()}`).toBeTruthy();

      const getResponse = await apiRequest(request, 'GET', `/api/customers/people/${personId}`, { token });
      expect(getResponse.ok()).toBeTruthy();
      const detail = await readJsonSafe<Record<string, unknown>>(getResponse);
      const profile = detail!.profile as Record<string, unknown>;
      expect(profile.linkedInUrl).toBe('https://linkedin.com/in/top-level-wins');
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });

  test('PUT /api/customers/people with unsupported nested profile key returns 400', async ({ request }) => {
    let token: string | null = null;
    let personId: string | null = null;

    try {
      token = await getAuthToken(request);
      const ts = Date.now();
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM035d${ts}`,
        displayName: `QA TC-CRM-035d ${ts}`,
      });

      const putResponse = await apiRequest(request, 'PUT', '/api/customers/people', {
        token,
        data: {
          id: personId,
          profile: {
            favoriteColor: 'blue',
          },
        },
      });
      expect(putResponse.status(), 'Should return 400 for unsupported nested key').toBe(400);
      const body = await readJsonSafe<Record<string, unknown>>(putResponse);
      expect(body).toHaveProperty('error');
      expect(String((body as Record<string, unknown>).error)).toContain('favoriteColor');

      // Verify no change was persisted
      const getResponse = await apiRequest(request, 'GET', `/api/customers/people/${personId}`, { token });
      expect(getResponse.ok()).toBeTruthy();
      const detail = await readJsonSafe<Record<string, unknown>>(getResponse);
      const profile = detail!.profile as Record<string, unknown>;
      expect(profile.linkedInUrl).toBeNull();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });

  test('PUT /api/customers/people with non-object profile returns 400', async ({ request }) => {
    let token: string | null = null;
    let personId: string | null = null;

    try {
      token = await getAuthToken(request);
      const ts = Date.now();
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM035e${ts}`,
        displayName: `QA TC-CRM-035e ${ts}`,
      });

      const putResponse = await apiRequest(request, 'PUT', '/api/customers/people', {
        token,
        data: {
          id: personId,
          profile: 'abc',
        },
      });
      expect(putResponse.status(), 'Should return 400 for non-object profile').toBe(400);
      const body = await readJsonSafe<Record<string, unknown>>(putResponse);
      expect(body).toHaveProperty('error');
      expect(String((body as Record<string, unknown>).error)).toContain('object');

      // Verify no change was persisted
      const getResponse = await apiRequest(request, 'GET', `/api/customers/people/${personId}`, { token });
      expect(getResponse.ok()).toBeTruthy();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });

  // --- Companies ---

  test('PUT /api/customers/companies with nested profile.legalName persists the value', async ({ request }) => {
    let token: string | null = null;
    let companyId: string | null = null;

    try {
      token = await getAuthToken(request);
      const ts = Date.now();
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-035f ${ts}`);

      const putResponse = await apiRequest(request, 'PUT', '/api/customers/companies', {
        token,
        data: {
          id: companyId,
          profile: {
            legalName: 'Acme Legal QA',
          },
        },
      });
      expect(putResponse.ok(), `PUT failed: ${putResponse.status()}`).toBeTruthy();
      const putBody = await readJsonSafe<Record<string, unknown>>(putResponse);
      expect(putBody).toEqual({ ok: true });

      const getResponse = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, { token });
      expect(getResponse.ok(), `GET failed: ${getResponse.status()}`).toBeTruthy();
      const detail = await readJsonSafe<Record<string, unknown>>(getResponse);
      const profile = detail!.profile as Record<string, unknown>;
      expect(profile.legalName).toBe('Acme Legal QA');
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  test('PUT /api/customers/companies with unsupported nested profile key returns 400', async ({ request }) => {
    let token: string | null = null;
    let companyId: string | null = null;

    try {
      token = await getAuthToken(request);
      const ts = Date.now();
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-035g ${ts}`);

      const putResponse = await apiRequest(request, 'PUT', '/api/customers/companies', {
        token,
        data: {
          id: companyId,
          profile: {
            linkedInUrl: 'https://linkedin.com/in/not-a-company-field',
          },
        },
      });
      expect(putResponse.status(), 'Should return 400 for unsupported nested key').toBe(400);
      const body = await readJsonSafe<Record<string, unknown>>(putResponse);
      expect(body).toHaveProperty('error');
      expect(String((body as Record<string, unknown>).error)).toContain('linkedInUrl');

      // Verify no change was persisted
      const getResponse = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, { token });
      expect(getResponse.ok()).toBeTruthy();
      const detail = await readJsonSafe<Record<string, unknown>>(getResponse);
      const profile = detail!.profile as Record<string, unknown>;
      expect(profile.legalName).toBeNull();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  test('PUT /api/customers/companies with non-object profile returns 400', async ({ request }) => {
    let token: string | null = null;
    let companyId: string | null = null;

    try {
      token = await getAuthToken(request);
      const ts = Date.now();
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-035h ${ts}`);

      const putResponse = await apiRequest(request, 'PUT', '/api/customers/companies', {
        token,
        data: {
          id: companyId,
          profile: 123,
        },
      });
      expect(putResponse.status(), 'Should return 400 for non-object profile').toBe(400);
      const body = await readJsonSafe<Record<string, unknown>>(putResponse);
      expect(body).toHaveProperty('error');
      expect(String((body as Record<string, unknown>).error)).toContain('object');

      // Verify no change was persisted
      const getResponse = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, { token });
      expect(getResponse.ok()).toBeTruthy();
      const detail = await readJsonSafe<Record<string, unknown>>(getResponse);
      const profile = detail!.profile as Record<string, unknown>;
      expect(profile.legalName).toBeNull();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
