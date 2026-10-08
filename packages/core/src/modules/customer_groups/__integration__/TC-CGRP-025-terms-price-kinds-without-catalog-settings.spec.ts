import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomerGroupFixture,
  deleteCustomerGroupIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui';
import { fixturePriority, uniqueStamp } from './helpers';

const CATALOG_PRICE_KINDS_PATH = '/api/catalog/price-kinds';
const TERMS_PRICE_KINDS_PATH = '/api/customer_groups/customer-groups/price-kinds';
const TERMS_MANAGER_FEATURES = [
  'customer_groups.groups.view',
  'customer_groups.groups.manage',
  'customer_groups.memberships.view',
  'customer_groups.memberships.manage',
  'customer_groups.terms.view',
  'customer_groups.terms.manage',
  'customers.people.view',
  'catalog.products.view',
];

type PriceKindOption = { id?: string; code?: string; title?: string };

/**
 * TC-CGRP-025 (#7077): a terms manager without `catalog.settings.manage` can pick a
 * price kind and save a group's terms without an "Access denied" flash replacing the
 * success message. The picker reads `GET /api/customer_groups/customer-groups/price-kinds`
 * (gated by `customer_groups.terms.view`) instead of `/api/catalog/price-kinds`.
 */
test.describe('TC-CGRP-025: terms price kind picker without catalog.settings.manage', () => {
  test('lists price kinds and reports a successful save as a success', async ({ page }) => {
    const adminToken = await getAuthToken(page.request, 'admin');
    const { tenantId, organizationId } = getTokenContext(adminToken);
    expectId(organizationId, 'Admin token should carry an organization');
    const stamp = uniqueStamp();
    const email = `qa-cgrp-025-${stamp}@example.com`;
    const password = 'StrongSecret123!';
    const priceKindCode = `qa_cgrp025_${stamp}`;
    const priceKindTitle = `QA CGRP 025 Price Kind ${stamp}`;
    let priceKindId: string | null = null;
    let groupId: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;

    try {
      const priceKindResponse = await apiRequest(page.request, 'POST', CATALOG_PRICE_KINDS_PATH, {
        token: adminToken,
        data: { code: priceKindCode, title: priceKindTitle },
      });
      expect(priceKindResponse.status(), 'price-kind fixture create should be 201').toBe(201);
      priceKindId = expectId(
        (await readJsonSafe<{ id?: string }>(priceKindResponse))?.id,
        'price-kind fixture should return an id',
      );
      groupId = await createCustomerGroupFixture(page.request, adminToken, {
        code: `qa-cgrp-025-${stamp}`,
        name: `QA CGRP 025 Group ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 1),
      });
      roleId = await createRoleFixture(page.request, adminToken, { name: `qa-cgrp-025-${stamp}`, tenantId });
      await setRoleAclFeatures(page.request, adminToken, {
        roleId,
        features: TERMS_MANAGER_FEATURES,
        organizations: [organizationId],
      });
      userId = await createUserFixture(page.request, adminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
        name: 'QA CGRP 025 Terms Manager',
      });

      const managerToken = await getAuthToken(page.request, email, password);
      const catalogResponse = await apiRequest(page.request, 'GET', `${CATALOG_PRICE_KINDS_PATH}?pageSize=20`, {
        token: managerToken,
      });
      expect(catalogResponse.status(), 'catalog price kinds stay gated by catalog.settings.manage').toBe(403);

      const byIdResponse = await apiRequest(
        page.request,
        'GET',
        `${TERMS_PRICE_KINDS_PATH}?ids=${encodeURIComponent(priceKindId)}&pageSize=1`,
        { token: managerToken },
      );
      expect(byIdResponse.status(), 'terms price kinds are readable with terms.view').toBe(200);
      const byIdBody = await readJsonSafe<{ items?: PriceKindOption[] }>(byIdResponse);
      expect(byIdBody?.items).toEqual([{ id: priceKindId, code: priceKindCode, title: priceKindTitle }]);

      const searchResponse = await apiRequest(
        page.request,
        'GET',
        `${TERMS_PRICE_KINDS_PATH}?search=${encodeURIComponent(priceKindCode)}`,
        { token: managerToken },
      );
      expect(searchResponse.status()).toBe(200);
      const searchBody = await readJsonSafe<{ items?: PriceKindOption[] }>(searchResponse);
      expect((searchBody?.items ?? []).map((item) => item.id)).toContain(priceKindId);

      const deniedResponses: string[] = [];
      page.on('response', (response) => {
        if (response.status() === 403) deniedResponses.push(response.url());
      });

      const loginForm = new URLSearchParams({ email, password });
      const loginResponse = await page.request.post('/api/auth/login', {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        data: loginForm.toString(),
      });
      expect(loginResponse.ok(), 'terms manager should log in').toBe(true);

      await page.goto(`/backend/customer-groups/${groupId}/edit`);
      await expect(page.locator('[data-crud-field-id="code"] input')).toHaveValue(`qa-cgrp-025-${stamp}`, {
        timeout: 15_000,
      });
      await page.getByRole('button', { name: 'Set terms for this group' }).click();

      const priceKindInput = page.locator('[data-crud-field-id="priceKindId"]').getByRole('combobox');
      await expect(priceKindInput).toBeVisible({ timeout: 10_000 });
      await priceKindInput.click();
      await priceKindInput.fill(priceKindCode);
      await page.getByRole('option', { name: `${priceKindTitle} (${priceKindCode})` }).click();

      await fillControlledInput(page.locator('[data-crud-field-id="paymentTermsDays"] input'), '45');
      await page.getByRole('button', { name: 'Save terms' }).click();

      await expect(page.getByRole('alert').filter({ hasText: 'Commercial terms saved.' })).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.locator('[data-crud-field-id="paymentTermsDays"] input')).toHaveValue('45');
      await expect(page.locator('[data-crud-field-id="priceKindId"]').getByRole('combobox')).toHaveValue(
        `${priceKindTitle} (${priceKindCode})`,
        { timeout: 10_000 },
      );
      await expect(page.getByRole('alert').filter({ hasText: 'Access denied' })).toHaveCount(0);
      expect(deniedResponses.filter((url) => url.includes('price-kinds'))).toEqual([]);
    } finally {
      await deleteCustomerGroupIfExists(page.request, adminToken, groupId);
      await deleteUserIfExists(page.request, adminToken, userId);
      await deleteRoleIfExists(page.request, adminToken, roleId);
      await deleteGeneralEntityIfExists(page.request, adminToken, CATALOG_PRICE_KINDS_PATH, priceKindId);
    }
  });
});
