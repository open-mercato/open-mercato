import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';

type BrandingBody = {
  organizationId?: string;
  organizationName?: string;
  tenantId?: string;
  logoUrl?: string | null;
};

type AdminNavBody = {
  brand?: {
    name?: string;
    logo?: {
      src?: string;
      alt?: string;
    } | null;
  } | null;
};

/**
 * TC-DIR-013: Organization sidebar branding
 * Covers:
 * - POST /api/directory/organizations
 * - PUT/GET /api/directory/organization-branding with om_selected_org scope
 * - GET /api/auth/admin/nav brand payload for the selected organization
 */
test.describe('TC-DIR-013: Organization sidebar branding', () => {
  test('persists the selected organization logo and exposes it in admin nav', async ({ request }) => {
    let token: string | null = null;
    let organizationId: string | null = null;
    const stamp = Date.now();
    const organizationName = `QA TC-DIR-013 ${stamp}`;
    const logoUrl = `https://example.com/open-mercato/qa-sidebar-logo-${stamp}.svg`;

    try {
      token = await getAuthToken(request, 'superadmin');
      const { tenantId } = getTokenContext(token);

      const createResponse = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token,
        data: { name: organizationName, tenantId },
      });
      expect(createResponse.status(), 'POST /api/directory/organizations should return 201').toBe(201);
      const createBody = await readJsonSafe<{ id?: string }>(createResponse);
      organizationId = expectId(createBody?.id, 'Organization creation response should include id');

      const updateResponse = await apiRequestWithSelectedOrg(
        request,
        'PUT',
        '/api/directory/organization-branding',
        {
          token,
          selectedOrgId: organizationId,
          data: { logoUrl },
        },
      );
      expect(updateResponse.status(), 'PUT /api/directory/organization-branding should return 200').toBe(200);
      const updateBody = await readJsonSafe<BrandingBody>(updateResponse);
      expect(updateBody?.organizationId).toBe(organizationId);
      expect(updateBody?.organizationName).toBe(organizationName);
      expect(updateBody?.tenantId).toBe(tenantId);
      expect(updateBody?.logoUrl).toBe(logoUrl);

      const readResponse = await apiRequestWithSelectedOrg(
        request,
        'GET',
        '/api/directory/organization-branding',
        { token, selectedOrgId: organizationId },
      );
      expect(readResponse.status(), 'GET /api/directory/organization-branding should return 200').toBe(200);
      const readBody = await readJsonSafe<BrandingBody>(readResponse);
      expect(readBody?.logoUrl).toBe(logoUrl);

      const navResponse = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/auth/admin/nav?orgId=${encodeURIComponent(organizationId)}&tenantId=${encodeURIComponent(tenantId)}`,
        { token, selectedOrgId: organizationId },
      );
      expect(navResponse.status(), 'GET /api/auth/admin/nav should return 200').toBe(200);
      const navBody = await readJsonSafe<AdminNavBody>(navResponse);
      expect(navBody?.brand?.name).toBe(organizationName);
      expect(navBody?.brand?.logo?.src).toBe(logoUrl);
      expect(navBody?.brand?.logo?.alt).toBe(`${organizationName} logo`);
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', organizationId);
    }
  });
});
