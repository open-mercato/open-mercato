import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  PROMOTIONS_PATH,
  cleanupSecondTenantActor,
  createPromotionFixture,
  createSecondTenantActor,
  deletePromotionIfExists,
  promotionDetailPath,
  uniqueStamp,
  type SecondTenantActor,
} from './helpers';

/**
 * Cross-tenant isolation sanity: a promotion created under tenant A is
 * invisible on tenant B's list, 404s on tenant B's detail GET, and cannot be
 * edited by tenant B. Per §API Contracts' intro paragraph ("every referenced
 * promotionId...is checked for tenant/organization ownership before use — a
 * mismatch answers identically to 'not found', no cross-tenant existence
 * oracle"), ALL of these must read as 404, not 403 — a status-code
 * difference between "truly missing id" and "exists under another tenant"
 * is itself the forbidden oracle.
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §API Contracts
 * intro paragraph + §Implementation Plan Phase 1 step 17.
 */
test.describe('TC-PROM-004: cross-tenant isolation', () => {
  test('a promotion created under tenant A is not visible or editable from tenant B', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();

    let promotionId: string | null = null;
    let actor: SecondTenantActor | null = null;

    try {
      const fixture = await createPromotionFixture(request, adminToken, { name: `QA PROM 004 ${stamp}`, order: 1 });
      promotionId = fixture.id;

      actor = await createSecondTenantActor(request, superadminToken, stamp);

      // GET list: tenant B must not see tenant A's promotion.
      const listResponse = await apiRequest(request, 'GET', `${PROMOTIONS_PATH}?pageSize=100`, { token: actor.token });
      expect(listResponse.status()).toBe(200);
      const listBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(listResponse);
      expect(
        (listBody?.items ?? []).some((item) => item.id === promotionId),
        'tenant B list must not include the tenant-A promotion',
      ).toBe(false);

      // GET detail: tenant B must get 404, not a cross-tenant leak.
      const detailResponse = await apiRequest(request, 'GET', promotionDetailPath(promotionId), { token: actor.token });
      expect(detailResponse.status(), 'tenant B detail GET of a tenant-A promotion must 404').toBe(404);

      // PUT: tenant B must not be able to update the tenant-A promotion, and
      // the response must be 404 (not 403) to avoid a cross-tenant existence oracle.
      const updateResponse = await apiRequest(request, 'PUT', PROMOTIONS_PATH, {
        token: actor.token,
        data: { id: promotionId, name: 'cross-tenant rename attempt' },
      });
      expect(updateResponse.status(), 'tenant B update of a tenant-A promotion must 404, not 403').toBe(404);

      // DELETE: same 404-not-403 requirement.
      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `${PROMOTIONS_PATH}?id=${encodeURIComponent(promotionId)}`,
        { token: actor.token },
      );
      expect(deleteResponse.status(), 'tenant B delete of a tenant-A promotion must 404, not 403').toBe(404);

      // The tenant-A promotion survives untouched under tenant A's own token.
      const survivorResponse = await apiRequest(request, 'GET', promotionDetailPath(promotionId), { token: adminToken });
      expect(survivorResponse.status()).toBe(200);
      const survivorBody = await readJsonSafe<{ name?: string }>(survivorResponse);
      expect(survivorBody?.name, 'tenant-A promotion must be unaffected by tenant-B attempts').toBe(`QA PROM 004 ${stamp}`);
    } finally {
      await deletePromotionIfExists(request, adminToken, promotionId);
      await cleanupSecondTenantActor(request, superadminToken, actor);
    }
  });
});
