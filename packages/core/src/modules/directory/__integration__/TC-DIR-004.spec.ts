import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

type SwitcherPayload = {
  items?: Array<{
    id?: string;
    name?: string;
    children?: Array<unknown>;
  }>;
  tenants?: Array<{
    id?: string;
    name?: string;
  }>;
};

function buildSuperAdminCookie(tenantId: string, organizationId: string | null): string {
  const parts = [`om_selected_tenant=${encodeURIComponent(tenantId)}`];
  if (organizationId) {
    parts.push(`om_selected_org=${encodeURIComponent(organizationId)}`);
  }
  return parts.join('; ');
}

function buildSwitcherCookie(tenantId: string): string {
  return `om_selected_tenant=${encodeURIComponent(tenantId)}; om_selected_org=__all__`;
}

async function apiRequestWithCookie(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; cookie: string; data?: unknown },
) {
  return request.fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      Cookie: options.cookie,
    },
    data: options.data,
  });
}

function flattenNames(items: Array<{ name?: string; children?: Array<unknown> }> | undefined): string[] {
  if (!Array.isArray(items)) return [];
  const result: string[] = [];
  const walk = (nodes: Array<{ name?: string; children?: Array<unknown> }>) => {
    for (const node of nodes) {
      if (typeof node.name === 'string' && node.name.length > 0) result.push(node.name);
      const children = Array.isArray(node.children)
        ? (node.children.filter((child): child is { name?: string; children?: Array<unknown> } => !!child && typeof child === 'object'))
        : [];
      if (children.length > 0) walk(children);
    }
  };
  walk(items);
  return result;
}

/**
 * TC-DIR-004: Superadmin tenant override and switcher freshness
 * Covers: POST /api/directory/organizations, GET /api/directory/organization-switcher
 */
test.describe('TC-DIR-004: Superadmin tenant override and switcher freshness', () => {
  test('should honor form tenant selection and expose new tenant and organization in switcher payloads immediately', async ({ request }) => {
    let token: string | null = null;
    let tenantId: string | null = null;
    let organizationId: string | null = null;

    const tenantName = `QA TC-DIR-004 Tenant ${Date.now()}`;
    const organizationName = `QA TC-DIR-004 Org ${Date.now()}`;

    try {
      token = await getAuthToken(request, 'superadmin');
      const { tenantId: actorTenantId, organizationId: actorOrganizationId } = getTokenContext(token);
      expect(actorTenantId, 'Superadmin token should include a tenant context').toBeTruthy();

      const staleHeaderCookie = buildSuperAdminCookie(actorTenantId, actorOrganizationId || null);

      const createTenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token,
        data: { name: tenantName },
      });
      expect(createTenantResponse.status(), 'POST /api/directory/tenants should return 201').toBe(201);
      const createTenantBody = await readJsonSafe<{ id?: string }>(createTenantResponse);
      tenantId = expectId(createTenantBody?.id, 'Tenant create response should contain an id');

      const staleTenantSwitcherResponse = await apiRequestWithCookie(
        request,
        'GET',
        '/api/directory/organization-switcher',
        {
          token,
          cookie: staleHeaderCookie,
        },
      );
      expect(staleTenantSwitcherResponse.status(), 'GET /api/directory/organization-switcher should return 200').toBe(200);
      const staleTenantSwitcherBody = await readJsonSafe<SwitcherPayload>(staleTenantSwitcherResponse);
      const tenantNames = Array.isArray(staleTenantSwitcherBody?.tenants)
        ? staleTenantSwitcherBody.tenants
          .map((entry) => (typeof entry?.name === 'string' ? entry.name : null))
          .filter((entry): entry is string => !!entry)
        : [];
      expect(tenantNames, 'Switcher tenant list should include the newly created tenant immediately').toContain(tenantName);

      const createOrganizationResponse = await apiRequestWithCookie(
        request,
        'POST',
        '/api/directory/organizations',
        {
          token,
          cookie: staleHeaderCookie,
          data: {
            name: organizationName,
            tenantId,
          },
        },
      );
      expect(
        createOrganizationResponse.status(),
        'POST /api/directory/organizations should allow a superadmin to target the form-selected tenant even when the header tenant differs',
      ).toBe(201);
      const createOrganizationBody = await readJsonSafe<{ id?: string }>(createOrganizationResponse);
      organizationId = expectId(createOrganizationBody?.id, 'Organization create response should contain an id');

      const targetTenantSwitcherResponse = await apiRequestWithCookie(
        request,
        'GET',
        '/api/directory/organization-switcher',
        {
          token,
          cookie: buildSwitcherCookie(tenantId),
        },
      );
      expect(targetTenantSwitcherResponse.status(), 'GET /api/directory/organization-switcher should return 200').toBe(200);
      const targetTenantSwitcherBody = await readJsonSafe<SwitcherPayload>(targetTenantSwitcherResponse);
      const organizationNames = flattenNames(targetTenantSwitcherBody?.items);
      expect(
        organizationNames,
        'Switcher organization tree should include the newly created organization immediately for the selected tenant',
      ).toContain(organizationName);
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', organizationId);
      await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', tenantId);
    }
  });
});
