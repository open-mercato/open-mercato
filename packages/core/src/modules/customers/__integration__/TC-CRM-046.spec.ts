import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-046: Deal list filters round-trip IDs (no label drop)
 * Spec: .ai/specs/2026-04-23-crm-post-upgrade-bug-fixes.md Phase 6 (Q8a)
 *
 * The previous implementation stored LABEL strings in `filterValues.people` and
 * then mapped them back to IDs via `peopleState.labelToId`. Any label mismatch
 * (case, trimming, composed-label separator) silently dropped the filter. This
 * test exercises the end-to-end flow: the user picks a person in the filter
 * overlay → the URL now carries a `personId` param → the listed deals include
 * only deals linked to that person.
 */
test.describe('TC-CRM-046: Deal list filter by people uses value-keyed IDs', () => {
  test('applying the People filter narrows the result set without silently dropping the value', async ({
    page,
    request,
  }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;
    let keeperPersonId: string | null = null;
    let distractorPersonId: string | null = null;
    let keeperDealId: string | null = null;
    let distractorDealId: string | null = null;
    const stamp = Date.now();
    const keeperName = `QA TC-CRM-046 Keeper ${stamp}`;
    const distractorName = `QA TC-CRM-046 Distractor ${stamp}`;
    const keeperDealTitle = `QA TC-CRM-046 Keeper Deal ${stamp}`;
    const distractorDealTitle = `QA TC-CRM-046 Distractor Deal ${stamp}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-046 Co ${stamp}`);
      keeperPersonId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TC046K-${stamp}`,
        displayName: keeperName,
        companyEntityId: companyId,
      });
      distractorPersonId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TC046D-${stamp}`,
        displayName: distractorName,
        companyEntityId: companyId,
      });
      keeperDealId = await createDealFixture(request, token, {
        title: keeperDealTitle,
        companyIds: [companyId],
        personIds: [keeperPersonId],
      });
      distractorDealId = await createDealFixture(request, token, {
        title: distractorDealTitle,
        companyIds: [companyId],
        personIds: [distractorPersonId],
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals?personId=${keeperPersonId}`, {
        waitUntil: 'domcontentloaded',
      });

      await expect(page.getByRole('cell', { name: keeperDealTitle, exact: true })).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByRole('cell', { name: distractorDealTitle, exact: true })).toHaveCount(0);

      // The chip displays the resolved person label, not the raw UUID.
      const peopleChip = page
        .locator('[data-testid="active-filter-chip"]')
        .filter({ hasText: /people.*qa tc-crm-046 keeper/i })
        .first();
      await expect(peopleChip).toBeVisible();

      // Removing the filter via the chip must widen the list again.
      await peopleChip.getByRole('button', { name: /remove filter/i }).click();
      await expect(page.getByRole('cell', { name: distractorDealTitle, exact: true })).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', keeperDealId);
      await deleteEntityIfExists(request, token, '/api/customers/deals', distractorDealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', keeperPersonId);
      await deleteEntityIfExists(request, token, '/api/customers/people', distractorPersonId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
