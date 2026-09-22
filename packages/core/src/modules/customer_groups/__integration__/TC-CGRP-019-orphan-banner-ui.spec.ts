import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { deleteGeneralEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { uniqueStamp } from './helpers';

/**
 * TC-CGRP-019: orphan banner (`components/OrphanBanner.tsx`, mounted on
 * `backend/customer-groups/page.tsx`) surfaces a dangling `customer_group_id`
 * reference and links through to the report page
 * (`backend/customer-groups/orphans/page.tsx`).
 *
 * Source: .ai/runs/2026-09-22-release-2-customer-groups-visibility/PLAN.md
 * Step 1.14.
 *
 * Creates the orphan reference as a `sales_tax_rates` row carrying a random,
 * non-existent `customerGroupId` — the same lightest-fixture choice
 * documented on TC-CGRP-004/TC-CGRP-008 (`POST /api/sales/tax-rates` only
 * needs `name`/`code`/`rate`, unlike a catalog price row which needs a
 * product + price-kind + currency), reused here for the UI layer.
 */
const TAX_RATES_PATH = '/api/sales/tax-rates';

test.describe('TC-CGRP-019: orphan banner and report page', () => {
  test('the banner shows a nonzero count and links to the report listing the orphan', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const orphanGroupId = randomUUID();

    let taxRateId: string | null = null;

    try {
      const taxRateResponse = await apiRequest(request, 'POST', TAX_RATES_PATH, {
        token,
        data: { name: `QA CGRP 019 Tax ${stamp}`, code: `qa-cgrp-019-${stamp}`, rate: 5, customerGroupId: orphanGroupId },
      });
      expect(taxRateResponse.status(), 'orphan tax-rate fixture create should be 201').toBe(201);
      taxRateId = (await readJsonSafe<{ id?: string }>(taxRateResponse))?.id ?? null;
      expect(taxRateId, 'orphan tax-rate fixture should return an id').toBeTruthy();

      await login(page, 'admin');
      await page.goto('/backend/customer-groups', { waitUntil: 'domcontentloaded' });

      const banner = page.getByText(/\d+ orphaned customer-group reference\(s\) found/);
      await expect(banner).toBeVisible({ timeout: 20_000 });

      await page.getByRole('link', { name: 'View report' }).click();
      await page.waitForURL(/\/backend\/customer-groups\/orphans$/, { timeout: 15_000 });

      await expect(page.getByRole('heading', { name: 'Orphaned Customer Group References' })).toBeVisible({
        timeout: 15_000,
      });
      // The orphaned group id itself renders as a font-mono block on its card.
      await expect(page.getByText(orphanGroupId, { exact: true })).toBeVisible({ timeout: 15_000 });
      // ...and the specific offending tax-rate id is listed as a sample link.
      await expect(page.getByRole('link', { name: taxRateId! })).toBeVisible();
    } finally {
      await deleteGeneralEntityIfExists(request, token, TAX_RATES_PATH, taxRateId);
    }
  });
});
