import { expect, test } from '@playwright/test';
import {
  createDealFixture,
  deleteEntityByBody,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at';

/**
 * Deal owner assignment from the detail form and the create forms.
 *
 * Spec: .ai/specs/2026-09-24-crm-deal-owner-assignment.md (D2, D4, D7, D10, D11)
 *
 * The UI writes the owner through the ordinary form contracts — `PUT /api/customers/deals`
 * from the detail form and `POST /api/customers/deals` from both create forms — so these
 * assert the endpoints those surfaces actually call, including the optimistic-lock 409 the
 * detail form relies on.
 */
test.describe('CRM deal owner assignment — detail and create paths', () => {
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
      title: `TC-CRM-6442 created with owner ${Date.now()}`,
      ownerUserId,
    });
    createdDealIds.push(dealId);

    const detail = await apiRequest(request, 'GET', `/api/customers/deals/${dealId}`, { token });
    expect(detail.ok()).toBeTruthy();
    const payload = await readJsonSafe(detail);
    expect((payload as { deal?: { ownerUserId?: string } })?.deal?.ownerUserId).toBe(ownerUserId);
  });

  test('changes the owner through the detail form PUT and persists it', async ({ request }) => {
    const dealId = await createDealFixture(request, token, {
      title: `TC-CRM-6442 reassign ${Date.now()}`,
      ownerUserId,
    });
    createdDealIds.push(dealId);

    const before = await readJsonSafe(await apiRequest(request, 'GET', `/api/customers/deals/${dealId}`, { token }));
    const updatedAt = (before as { deal?: { updatedAt?: string } })?.deal?.updatedAt;
    expect(updatedAt, 'Detail response must expose updatedAt for optimistic locking').toBeTruthy();

    const update = await apiRequest(request, 'PUT', '/api/customers/deals', {
      token,
      data: { id: dealId, ownerUserId: otherUserId },
      headers: { [OPTIMISTIC_LOCK_HEADER]: String(updatedAt) },
    });
    expect(update.ok(), `Owner update failed: ${update.status()}`).toBeTruthy();

    const after = await readJsonSafe(await apiRequest(request, 'GET', `/api/customers/deals/${dealId}`, { token }));
    expect((after as { deal?: { ownerUserId?: string } })?.deal?.ownerUserId).toBe(otherUserId);
  });

  test('rejects a stale owner update with 409 so the form surfaces the conflict', async ({ request }) => {
    const dealId = await createDealFixture(request, token, {
      title: `TC-CRM-6442 stale ${Date.now()}`,
      ownerUserId,
    });
    createdDealIds.push(dealId);

    const before = await readJsonSafe(await apiRequest(request, 'GET', `/api/customers/deals/${dealId}`, { token }));
    const staleUpdatedAt = (before as { deal?: { updatedAt?: string } })?.deal?.updatedAt;
    expect(staleUpdatedAt).toBeTruthy();

    // First write moves the record forward, invalidating the captured version.
    const first = await apiRequest(request, 'PUT', '/api/customers/deals', {
      token,
      data: { id: dealId, ownerUserId: otherUserId },
      headers: { [OPTIMISTIC_LOCK_HEADER]: String(staleUpdatedAt) },
    });
    expect(first.ok()).toBeTruthy();

    // Second write replays the now-stale version, exactly as a second browser tab would.
    const stale = await apiRequest(request, 'PUT', '/api/customers/deals', {
      token,
      data: { id: dealId, ownerUserId },
      headers: { [OPTIMISTIC_LOCK_HEADER]: String(staleUpdatedAt) },
    });
    expect(stale.status()).toBe(409);
  });

  test('leaves the owner untouched when the payload omits it', async ({ request }) => {
    const dealId = await createDealFixture(request, token, {
      title: `TC-CRM-6442 untouched ${Date.now()}`,
      ownerUserId,
    });
    createdDealIds.push(dealId);

    const before = await readJsonSafe(await apiRequest(request, 'GET', `/api/customers/deals/${dealId}`, { token }));
    const updatedAt = (before as { deal?: { updatedAt?: string } })?.deal?.updatedAt;

    const update = await apiRequest(request, 'PUT', '/api/customers/deals', {
      token,
      data: { id: dealId, title: `TC-CRM-6442 untouched renamed ${Date.now()}` },
      headers: { [OPTIMISTIC_LOCK_HEADER]: String(updatedAt) },
    });
    expect(update.ok()).toBeTruthy();

    const after = await readJsonSafe(await apiRequest(request, 'GET', `/api/customers/deals/${dealId}`, { token }));
    expect((after as { deal?: { ownerUserId?: string } })?.deal?.ownerUserId).toBe(ownerUserId);
  });
});
