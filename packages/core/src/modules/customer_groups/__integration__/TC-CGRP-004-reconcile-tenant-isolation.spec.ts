import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { deleteGeneralEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  cleanupSecondTenantActor,
  createSecondTenantActor,
  uniqueStamp,
  type SecondTenantActor,
} from './helpers';

/**
 * TC-CGRP-004: `GET /api/customer-groups/reconcile` tenant isolation.
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §13.
 *
 * `lib/reconcile.ts`'s `scanOrphanedCustomerGroupReferences` scopes the raw
 * `sales_tax_rates`/`catalog_product_variant_prices` scan by the caller's own
 * `tenantId` when one is supplied, and `route.ts` always passes
 * `auth.tenantId` — never a client-controlled value (root AGENTS.md § Never:
 * "expose cross-tenant data or skip tenant/organization scoping").
 *
 * A `sales_tax_rates` row is the lightest fixture that reaches the orphan
 * scan (`POST /api/sales/tax-rates` only needs `name`/`code`/`rate`, unlike a
 * catalog price row which needs a product + price-kind + currency), so this
 * spec creates an orphan reference there rather than in `catalog`.
 */
const RECONCILE_PATH = '/api/customer-groups/reconcile';
const TAX_RATES_PATH = '/api/sales/tax-rates';

type OrphanRow = { groupId: string };

test.describe('TC-CGRP-004: customer groups reconcile tenant isolation', () => {
  test('an orphan reference in tenant A is invisible to tenant B reconcile scan', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();
    const orphanGroupId = randomUUID();

    let taxRateId: string | null = null;
    let actor: SecondTenantActor | null = null;

    try {
      const taxRateResponse = await apiRequest(request, 'POST', TAX_RATES_PATH, {
        token: adminToken,
        data: { name: `QA CGRP 004 Tax ${stamp}`, code: `qa-cgrp-004-${stamp}`, rate: 5, customerGroupId: orphanGroupId },
      });
      expect(taxRateResponse.status(), 'tax-rate orphan fixture create should be 201').toBe(201);
      taxRateId = (await readJsonSafe<{ id?: string }>(taxRateResponse))?.id ?? null;
      expect(taxRateId, 'tax-rate orphan fixture should return an id').toBeTruthy();

      // Tenant A's own scan lists the orphan.
      const ownScanResponse = await apiRequest(request, 'GET', RECONCILE_PATH, { token: adminToken });
      expect(ownScanResponse.status(), 'tenant A reconcile scan should be 200').toBe(200);
      const ownScanBody = await readJsonSafe<{ orphans?: OrphanRow[] }>(ownScanResponse);
      expect(
        (ownScanBody?.orphans ?? []).some((row) => row.groupId === orphanGroupId),
        'tenant A reconcile scan should list its own orphaned customer_group_id',
      ).toBe(true);

      actor = await createSecondTenantActor(request, superadminToken, stamp);

      const crossScanResponse = await apiRequest(request, 'GET', RECONCILE_PATH, { token: actor.token });
      expect(crossScanResponse.status(), 'tenant B reconcile scan should be 200').toBe(200);
      const crossScanBody = await readJsonSafe<{ orphans?: OrphanRow[] }>(crossScanResponse);
      expect(
        (crossScanBody?.orphans ?? []).some((row) => row.groupId === orphanGroupId),
        'tenant B reconcile scan must not list a tenant-A orphan',
      ).toBe(false);
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, TAX_RATES_PATH, taxRateId);
      await cleanupSecondTenantActor(request, superadminToken, actor);
    }
  });
});
