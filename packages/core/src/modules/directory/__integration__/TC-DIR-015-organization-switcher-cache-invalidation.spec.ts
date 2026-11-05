import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';

type SwitcherNode = {
  name?: string;
  children?: SwitcherNode[];
};

function flattenOrganizationNames(items: SwitcherNode[]): string[] {
  return items.flatMap((item) => [
    ...(typeof item.name === 'string' ? [item.name] : []),
    ...flattenOrganizationNames(Array.isArray(item.children) ? item.children : []),
  ]);
}

test.describe('TC-DIR-015: Organization switcher cache invalidation', () => {
  test('should expose a newly created organization after warming the switcher cache', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const organizationName = `QA TC-DIR-015 Cache ${Date.now()}`;
    let organizationId: string | null = null;

    try {
      const warmResponse = await apiRequest(
        request,
        'GET',
        '/api/directory/organization-switcher',
        { token },
      );
      expect(warmResponse.status(), 'Initial organization switcher request should return 200').toBe(200);

      const createResponse = await apiRequest(
        request,
        'POST',
        '/api/directory/organizations',
        {
          token,
          data: { name: organizationName },
        },
      );
      expect(createResponse.status(), 'Organization creation should return 201').toBe(201);
      const createBody = await readJsonSafe<{ id?: string }>(createResponse);
      organizationId = expectId(createBody?.id, 'Organization create response should contain an id');

      await expect.poll(
        async () => {
          const switcherResponse = await apiRequest(
            request,
            'GET',
            '/api/directory/organization-switcher',
            { token },
          );
          if (switcherResponse.status() !== 200) return [];
          const body = await readJsonSafe<{ items?: SwitcherNode[] }>(switcherResponse);
          return flattenOrganizationNames(Array.isArray(body?.items) ? body.items : []);
        },
        {
          intervals: [500],
          message: 'Organization mutation should invalidate the cached switcher response',
        },
      ).toContain(organizationName);
    } finally {
      await deleteGeneralEntityIfExists(
        request,
        token,
        '/api/directory/organizations',
        organizationId,
      );
    }
  });
});
