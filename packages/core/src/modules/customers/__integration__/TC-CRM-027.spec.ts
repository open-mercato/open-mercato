import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

type JsonRecord = Record<string, unknown>;

async function resolveRoleIdByName(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  roleName: string,
): Promise<string> {
  const response = await apiRequest(request, 'GET', `/api/auth/roles?pageSize=100&search=${encodeURIComponent(roleName)}`, {
    token,
  });
  expect(response.ok()).toBeTruthy();
  const body = await readJsonSafe<JsonRecord>(response);
  const items = Array.isArray(body?.items) ? (body.items as JsonRecord[]) : [];
  const match = items.find((item) => item?.name === roleName);
  expect(match).toBeTruthy();
  expect(typeof match?.id).toBe('string');
  return String(match?.id);
}

/**
 * TC-CRM-027: Person Detail Company Highlight & Interaction ACL
 *
 * Verifies:
 * - Person detail API returns resolved company { id, displayName } for the highlights summary
 * - Employee role (view-only) is denied write operations on interactions
 */
test.describe('TC-CRM-027: Person Detail & Interaction ACL', () => {
  test('should return company object in person detail response', async ({ request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA CRM027 Company ${Date.now()}`);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM027P${Date.now()}`,
        displayName: `QA CRM-027 Person ${Date.now()}`,
        companyEntityId: companyId,
      });

      const detailRes = await apiRequest(request, 'GET', `/api/customers/people/${personId}`, { token });
      expect(detailRes.ok()).toBeTruthy();
      const body = await readJsonSafe<JsonRecord>(detailRes);

      // Verify company field is present with resolved displayName
      const company = body?.company as JsonRecord | undefined;
      expect(company).toBeTruthy();
      expect(company?.id).toBe(companyId);
      expect(typeof company?.displayName).toBe('string');
      expect((company?.displayName as string).length).toBeGreaterThan(0);

      // Verify profile also has companyEntityId
      const profile = body?.profile as JsonRecord | undefined;
      expect(profile?.companyEntityId).toBe(companyId);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });

  test('should return null company when person has no company', async ({ request }) => {
    let token: string | null = null;
    let personId: string | null = null;

    try {
      token = await getAuthToken(request);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CRM027NoCo${Date.now()}`,
        displayName: `QA CRM-027 NoCo ${Date.now()}`,
      });

      const detailRes = await apiRequest(request, 'GET', `/api/customers/people/${personId}`, { token });
      expect(detailRes.ok()).toBeTruthy();
      const body = await readJsonSafe<JsonRecord>(detailRes);

      expect(body?.company).toBeNull();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });

  test('should deny employee write access to interactions when manage feature is removed', async ({ request }) => {
    let adminToken: string | null = null;
    let employeeToken: string | null = null;
    let companyId: string | null = null;
    let interactionId: string | null = null;
    let originalFeatures: string[] | null = null;
    let employeeRoleId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      employeeToken = await getAuthToken(request, 'employee');
      companyId = await createCompanyFixture(request, adminToken, `QA CRM027 ACL ${Date.now()}`);
      employeeRoleId = await resolveRoleIdByName(request, adminToken, 'employee');

      // Save original employee features
      const aclRes = await apiRequest(request, 'GET', `/api/auth/roles/acl?roleId=${employeeRoleId}`, { token: adminToken });
      expect(aclRes.ok()).toBeTruthy();
      const aclBody = await readJsonSafe<JsonRecord>(aclRes);
      originalFeatures = Array.isArray(aclBody?.features) ? (aclBody!.features as string[]) : [];

      // Strip manage features from employee
      const viewOnlyFeatures = originalFeatures.filter(
        (f) => f !== 'customers.*' && f !== 'customers.interactions.manage',
      );
      const updateAclRes = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: adminToken,
        data: { roleId: employeeRoleId, features: viewOnlyFeatures },
      });
      expect(updateAclRes.ok()).toBeTruthy();

      // Employee can list (view)
      const listRes = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${companyId}&limit=5`, { token: employeeToken });
      expect(listRes.ok()).toBeTruthy();

      // Employee cannot create
      const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token: employeeToken,
        data: { entityId: companyId, interactionType: 'call', title: 'Unauthorized' },
      });
      expect(createRes.status()).toBe(403);

      // Create one as admin so we can test update/delete denial
      const adminCreateRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token: adminToken,
        data: { entityId: companyId, interactionType: 'call', title: 'Admin created', scheduledAt: '2026-09-01T10:00:00Z' },
      });
      const adminCreated = await readJsonSafe<JsonRecord>(adminCreateRes);
      interactionId = typeof adminCreated?.id === 'string' ? adminCreated.id : null;

      // Employee cannot update
      const updateRes = await apiRequest(request, 'PUT', '/api/customers/interactions', {
        token: employeeToken,
        data: { id: interactionId, title: 'Hacked' },
      });
      expect(updateRes.status()).toBe(403);

      // Employee cannot complete
      const completeRes = await apiRequest(request, 'POST', '/api/customers/interactions/complete', {
        token: employeeToken,
        data: { id: interactionId },
      });
      expect(completeRes.status()).toBe(403);

      // Employee cannot cancel
      const cancelRes = await apiRequest(request, 'POST', '/api/customers/interactions/cancel', {
        token: employeeToken,
        data: { id: interactionId },
      });
      expect(cancelRes.status()).toBe(403);

      // Employee cannot delete
      const deleteRes = await apiRequest(request, 'DELETE', `/api/customers/interactions?id=${interactionId}`, { token: employeeToken });
      expect(deleteRes.status()).toBe(403);
    } finally {
      // Restore original employee features
      if (adminToken && originalFeatures && employeeRoleId) {
        await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
          token: adminToken,
          data: { roleId: employeeRoleId, features: originalFeatures },
        });
      }
      if (interactionId && adminToken) {
        await apiRequest(request, 'DELETE', `/api/customers/interactions?id=${interactionId}`, { token: adminToken }).catch(() => {});
      }
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId);
    }
  });
});
