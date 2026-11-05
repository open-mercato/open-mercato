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

  test('association filter (personId) AND advanced-tree filter intersect on Deals list', async ({
    page,
    request,
  }) => {
    test.slow();

    // Verifies end-to-end that mixing a legacy association filter (personId) with
    // a v2 advanced-filter tree on the same request returns the AND-intersection,
    // not the union or one-side-only. Two deals share the same person; only one
    // matches the title advanced filter.

    let token: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;
    let keeperDealId: string | null = null;
    let distractorDealId: string | null = null;
    const stamp = Date.now();
    // Single-token markers so the engine's tokenized contains-search doesn't
    // accidentally match the other deal (see TC-CRM-047 note).
    const keeperToken = `KEEPER${stamp}`;
    const distractorToken = `DISTRACTOR${stamp}`;
    const keeperDealTitle = `QA TC-CRM-046b ${keeperToken}`;
    const distractorDealTitle = `QA TC-CRM-046b ${distractorToken}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-046b Co ${stamp}`);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TC046b-${stamp}`,
        displayName: `QA TC-CRM-046b Person ${stamp}`,
        companyEntityId: companyId,
      });
      // Both deals are linked to the SAME person — association filter alone would
      // return both. The advanced-tree filter must narrow the intersection to one.
      keeperDealId = await createDealFixture(request, token, {
        title: keeperDealTitle,
        companyIds: [companyId],
        personIds: [personId],
      });
      distractorDealId = await createDealFixture(request, token, {
        title: distractorDealTitle,
        companyIds: [companyId],
        personIds: [personId],
      });

      await login(page, 'admin');
      const query = new URLSearchParams();
      // Legacy association filter.
      query.set('personId', personId);
      // v2 tree filter targeting only the keeper title.
      query.set('filter[v]', '2');
      query.set('filter[root][combinator]', 'and');
      query.set('filter[root][children][0][type]', 'rule');
      query.set('filter[root][children][0][field]', 'title');
      query.set('filter[root][children][0][op]', 'contains');
      query.set('filter[root][children][0][value]', keeperToken);

      await page.goto(`/backend/customers/deals?${query.toString()}`, {
        waitUntil: 'domcontentloaded',
      });

      // AND intersection: only the keeper deal should show. The distractor
      // satisfies the association filter but fails the title filter, so a union
      // (incorrect) would still display it.
      await expect(page.getByRole('cell', { name: keeperDealTitle, exact: true })).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByRole('cell', { name: distractorDealTitle, exact: true })).toHaveCount(0);

      // Both filter surfaces should be reflected as chips: the association chip
      // for the person, plus a top-level advanced-filter chip for the title rule.
      await expect(
        page.locator('[data-testid="active-filter-chip"]').filter({ hasText: /people/i }).first(),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="active-filter-chip"]').filter({ hasText: /title/i }).first(),
      ).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', keeperDealId);
      await deleteEntityIfExists(request, token, '/api/customers/deals', distractorDealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
