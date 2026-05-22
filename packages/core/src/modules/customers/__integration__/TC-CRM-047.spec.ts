import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createDealFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-047: advancedFilterState survives a full page refresh
 * Spec: .ai/specs/2026-04-23-crm-post-upgrade-bug-fixes.md Phase 6 (Q8c)
 *
 * Seeds a `filter[...]` query-string shape that the URL sync writes when a user
 * builds an advanced filter, reloads the page, and asserts the filter is still
 * honored after navigation. Previously the advanced filter was only serialised
 * into the API URL — the browser URL sync dropped it, so refreshes reset the
 * filter to empty.
 */
test.describe('TC-CRM-047: advancedFilterState round-trips through the URL', () => {
  test('advanced filter query params survive a page reload', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;
    let dealAId: string | null = null;
    let dealBId: string | null = null;
    const stamp = Date.now();
    // Use a single-token unique marker per deal — the query engine's `contains`
    // operator tokenises the filter value and ORs the matches, so multi-word
    // markers (e.g. "TC-CRM-047 A <stamp>") would match deals that share any
    // token ("A" vs "B" alone, <stamp> alone). A single opaque word-token is
    // guaranteed to isolate one deal.
    const keeperToken = `KEEPER${stamp}`;
    const distractorToken = `DISTRACTOR${stamp}`;
    const dealATitle = `QA TC-CRM-047 ${keeperToken}`;
    const dealBTitle = `QA TC-CRM-047 ${distractorToken}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-047 Co ${stamp}`);
      dealAId = await createDealFixture(request, token, {
        title: dealATitle,
        companyIds: [companyId],
      });
      dealBId = await createDealFixture(request, token, {
        title: dealBTitle,
        companyIds: [companyId],
      });

      await login(page, 'admin');
      const query = new URLSearchParams()
      query.set('filter[logic]', 'and')
      query.set('filter[conditions][0][field]', 'title')
      query.set('filter[conditions][0][op]', 'contains')
      query.set('filter[conditions][0][value]', keeperToken)

      await page.goto(`/backend/customers/deals?${query.toString()}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('cell', { name: dealATitle, exact: true })).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('cell', { name: dealBTitle, exact: true })).toHaveCount(0);

      // Reload — the URL still carries the filter, state is re-hydrated from it.
      await page.reload({ waitUntil: 'domcontentloaded' });
      // The page accepts legacy `filter[conditions]` params, then normalizes the
      // address bar to the V2 tree-shaped `filter[root]` form.
      await expect(page).toHaveURL(new RegExp(`filter(\\[|%5B)v(\\]|%5D)=2.*${keeperToken}`, 'i'));
      await expect(page.getByRole('cell', { name: dealATitle, exact: true })).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('cell', { name: dealBTitle, exact: true })).toHaveCount(0);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealAId);
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealBId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
