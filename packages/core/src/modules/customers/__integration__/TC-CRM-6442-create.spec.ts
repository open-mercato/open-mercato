import { expect, test } from '@playwright/test';
import {
  createDealFixture,
  deleteEntityByBody,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * Deal owner assignment from both create paths.
 *
 * Spec: .ai/specs/2026-09-24-crm-deal-owner-assignment.md (D7, D10, D11), implementation step 8.
 *
 * The standalone New deal page and the person/company create flow both post to
 * `POST /api/customers/deals`, so this asserts that endpoint carries the owner either way.
 */
test.describe('CRM deal owner assignment — create paths', () => {
  const createdDealIds: string[] = [];
  let token = '';
  let ownerUserId = '';
  let otherUserId = '';

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin');

    // The assignable roster is owned by the optional `staff` module. Pull real user ids from
    // it when present; otherwise fall back to the authenticated user so the suite stays
    // self-contained and does not depend on seeded demo staff.
    const rosterResponse = await apiRequest(request, 'GET', '/api/staff/team-members/assignable?page=1&pageSize=50', { token });
    const roster = rosterResponse.ok() ? await readJsonSafe(rosterResponse) : null;
    const items = Array.isArray((roster as { items?: unknown })?.items)
      ? ((roster as { items: Array<Record<string, unknown>> }).items)
      : [];
    const rosterUserIds = items
      .map((item) => (typeof item.userId === 'string' ? item.userId : null))
      .filter((value): value is string => Boolean(value));

    const meResponse = await apiRequest(request, 'POST', '/api/auth/feature-check', {
      token,
      data: { features: [] },
    });
    const me = await readJsonSafe(meResponse);
    const currentUserId = typeof (me as { userId?: unknown })?.userId === 'string'
      ? (me as { userId: string }).userId
      : '';

    ownerUserId = rosterUserIds[0] ?? currentUserId;
    otherUserId = rosterUserIds[1] ?? currentUserId;
    expect(ownerUserId, 'No assignable user id available for the owner tests').toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    for (const dealId of createdDealIds) {
      await deleteEntityByBody(request, token, '/api/customers/deals', dealId);
    }
  });

  test('creates a deal with an owner, as both create forms do', async ({ request }) => {
    const dealId = await createDealFixture(request, token, {
      title: `TC-CRM-6442-create created with owner ${Date.now()}`,
      ownerUserId,
    });
    createdDealIds.push(dealId);

    const detail = await apiRequest(request, 'GET', `/api/customers/deals/${dealId}`, { token });
    expect(detail.ok()).toBeTruthy();
    const payload = await readJsonSafe(detail);
    expect((payload as { deal?: { ownerUserId?: string } })?.deal?.ownerUserId).toBe(ownerUserId);
  });

});
