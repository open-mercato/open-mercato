import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createCustomerGroupFixture,
  createCustomerGroupMembershipFixture,
  createCustomerGroupTermsFixture,
  deleteCustomerGroupIfExists,
  deleteCustomerGroupMembershipIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import { fixturePriority, uniqueStamp } from './helpers';

/**
 * TC-CGRP-023: Phase 2 UI gate — the "Explain terms" panel
 * (`widgets/injection/person-groups-explain-terms.tsx`, mounted at the
 * bottom of the "Groups" tab injected by `person-groups-tab.tsx` into the
 * customer detail page's `detail:customers.person:tabs` spot).
 *
 * Builds a real 2-level hierarchy over HTTP (parent -> child), sets ONE
 * field (`paymentTermsDays`) on the PARENT only, and makes a real customer a
 * member of the CHILD group — mirrors the API-level proof in
 * TC-CGRP-011 (3-level) but asserts the rendered UI instead of the raw
 * `/api/customer-groups/explain-terms` JSON: the resolved value, the
 * PARENT (not child) as the source group, the child -> parent ancestor
 * breadcrumb, and a never-set field falling back to "Tenant default".
 *
 * Source: .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §14 Phase 2 UI
 * paths; `.ai/runs/2026-09-22-release-2-customer-groups-visibility/PLAN.md`
 * Step 2.9.
 */
test.describe('TC-CGRP-023: Explain-terms panel on the customer detail page', () => {
  test('resolves a parent-set field with the parent as source and the child -> parent breadcrumb', async ({
    page,
  }) => {
    const token = await getAuthToken(page.request, 'admin');
    const stamp = uniqueStamp();
    const parentCode = `qa-cgrp-023-p-${stamp}`;
    const parentName = `QA CGRP 023 Parent ${stamp}`;
    const childCode = `qa-cgrp-023-c-${stamp}`;
    const childName = `QA CGRP 023 Child ${stamp}`;
    const personDisplayName = `QA CGRP 023 Person ${stamp}`;

    let parentId: string | null = null;
    let childId: string | null = null;
    let personId: string | null = null;
    let membershipId: string | null = null;

    try {
      parentId = await createCustomerGroupFixture(page.request, token, {
        code: parentCode,
        name: parentName,
        kind: 'b2b',
        priority: fixturePriority(stamp, 1),
      });
      childId = await createCustomerGroupFixture(page.request, token, {
        code: childCode,
        name: childName,
        kind: 'b2b',
        priority: fixturePriority(stamp, 2),
        parentId,
      });
      await createCustomerGroupTermsFixture(page.request, token, {
        groupId: parentId,
        paymentTermsDays: 60,
      });
      personId = await createPersonFixture(page.request, token, {
        firstName: 'QA',
        lastName: `CGRP023 ${stamp}`,
        displayName: personDisplayName,
      });
      membershipId = await createCustomerGroupMembershipFixture(page.request, token, {
        groupId: childId,
        customerId: personId,
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/people-v2/${personId}`);
      await expect(page.getByRole('heading', { name: personDisplayName, exact: true })).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole('tab', { name: 'Groups' }).click();
      await expect(page.getByRole('heading', { name: 'Explain terms' })).toBeVisible({ timeout: 15_000 });

      const list = page.getByLabel('Resolved commercial terms');

      const paymentRow = list.locator('li').filter({ hasText: 'Payment terms' });
      await expect(paymentRow).toContainText('60 days');
      await expect(paymentRow).toContainText(`via ${childName} (${childCode}) → ${parentName} (${parentCode})`);

      const approvalRow = list.locator('li').filter({ hasText: 'Approval required above' });
      await expect(approvalRow).toContainText('Not set');
      await expect(approvalRow).toContainText('Tenant default');
    } finally {
      await deleteCustomerGroupMembershipIfExists(page.request, token, membershipId);
      await deleteEntityIfExists(page.request, token, '/api/customers/people', personId);
      await deleteCustomerGroupIfExists(page.request, token, childId);
      await deleteCustomerGroupIfExists(page.request, token, parentId);
    }
  });
});
