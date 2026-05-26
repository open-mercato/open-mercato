import { test, expect } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createPersonFixture,
  createDealFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-042: Deal-linked note appears in deal changelog
 * Spec: .ai/specs/2026-04-23-crm-post-upgrade-bug-fixes.md Phase 2 (Q2=d)
 *
 * Verifies the audit_logs API matches action_logs where
 * snapshot_after->>'dealId' = <dealId> when resourceKind=customers.deal
 * and includeRelated=true. A note created against a person but also linked
 * to a deal must show up in the deal's changelog.
 */
test.describe('TC-CRM-042: Deal changelog includes related notes via snapshot.dealId filter', () => {
  test('note with dealId shows up under customers.deal + includeRelated even though parentResource points at the person', async ({
    request,
  }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;
    let personEntityId: string | null = null;
    let dealId: string | null = null;
    let commentId: string | null = null;
    const stamp = Date.now();
    const companyName = `QA TC-CRM-042 Co ${stamp}`;
    const personName = `QA TC-CRM-042 Person ${stamp}`;
    const dealTitle = `QA TC-CRM-042 Deal ${stamp}`;
    const noteBody = `QA TC-CRM-042 note body ${stamp}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);
      personEntityId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TC042-${stamp}`,
        displayName: personName,
        companyEntityId: companyId,
      });
      dealId = await createDealFixture(request, token, {
        title: dealTitle,
        companyIds: [companyId],
        personIds: [personEntityId],
      });

      const createCommentRes = await apiRequest(request, 'POST', '/api/customers/comments', {
        token,
        data: {
          entityId: personEntityId,
          dealId,
          body: noteBody,
        },
      });
      expect(
        createCommentRes.ok(),
        `comment create should succeed: ${createCommentRes.status()}`,
      ).toBeTruthy();
      const createBody = (await createCommentRes.json()) as { id?: string | null };
      commentId = typeof createBody.id === 'string' ? createBody.id : null;
      expect(commentId, 'expected comment id in create response').toBeTruthy();

      await expect
        .poll(
          async () => {
            const res = await apiRequest(
              request,
              'GET',
              `/api/audit_logs/audit-logs/actions?resourceKind=customers.deal&resourceId=${encodeURIComponent(dealId!)}&includeRelated=true&pageSize=100`,
              { token: token! },
            );
            if (!res.ok()) return 0;
            const payload = (await res.json()) as {
              items?: Array<{
                resourceKind?: string | null;
                resourceId?: string | null;
                commandId?: string | null;
              }>;
            };
            const items = Array.isArray(payload.items) ? payload.items : [];
            return items.filter(
              (entry) =>
                entry.commandId === 'customers.comments.create' &&
                entry.resourceKind === 'customers.comment' &&
                entry.resourceId === commentId,
            ).length;
          },
          {
            message: 'deal changelog should include the note via snapshot_after.dealId filter',
            timeout: 15000,
          },
        )
        .toBeGreaterThanOrEqual(1);

      const unrelatedDealRes = await apiRequest(
        request,
        'GET',
        `/api/audit_logs/audit-logs/actions?resourceKind=customers.deal&resourceId=${encodeURIComponent('00000000-0000-0000-0000-000000000000')}&includeRelated=true&pageSize=100`,
        { token },
      );
      expect(unrelatedDealRes.ok()).toBeTruthy();
      const unrelatedBody = (await unrelatedDealRes.json()) as {
        items?: Array<{ resourceId?: string | null; commandId?: string | null }>;
      };
      const unrelatedItems = Array.isArray(unrelatedBody.items) ? unrelatedBody.items : [];
      const leaked = unrelatedItems.filter(
        (entry) =>
          entry.commandId === 'customers.comments.create' && entry.resourceId === commentId,
      );
      expect(leaked, 'note must not leak into unrelated deals').toHaveLength(0);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/comments', commentId);
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', personEntityId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
