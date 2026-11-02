import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  CODES_PATH,
  CODES_RELEASE_PATH,
  CODES_RESERVE_PATH,
  CODES_USE_PATH,
  CODES_VALIDATE_PATH,
  PROMOTIONS_FEATURES,
  USAGE_REGISTER_PATH,
  USAGE_REVERT_PATH,
  cleanupSecondTenantActor,
  codeDetailQueryPath,
  codeGeneratePath,
  codeGeneratedPath,
  createCodeFixture,
  createPromotionFixture,
  createSecondTenantActor,
  deleteCodeIfExists,
  deletePromotionIfExists,
  uniqueStamp,
  type SecondTenantActor,
} from './helpers';
import { codeReservationExistsInDb, readCodeRow, readPromotionUsageRows, deletePromotionUsageRowsInDb } from './helpers/db';

/**
 * TC-PROM-082: cross-tenant isolation for every Phase 3 route this run's Step 6.4/6.7
 * introduced — the `Code` admin CRUD + generation routes (`codes`, `codes/[id]/generate`,
 * `codes/[id]/generated`) and the 6 cart-facing routes (`codes/reserve|validate|use|
 * release`, `usage/register|revert`). `TC-PROM-004` already covers the Phase 1 admin
 * `Promotion` CRUD routes and `TC-PROM-081` the Phase 2 cart-facing routes
 * (`evaluate`/`product-page`/`dynamic-labels`/`free-products`) — this is the Phase 3
 * counterpart, following both specs' own per-route tenant-isolation pattern: a
 * genuinely separate tenant B must never read, mutate, or be answered differently about
 * tenant A's data than it would for a truly unknown id.
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §API Contracts intro
 * paragraph (tenant/organization ownership check before use) + §Implementation Plan
 * Phase 3 step 25's own "cross-tenant test per Phase 3 route" line.
 */
test.describe('TC-PROM-082: Phase 3 routes cross-tenant isolation', () => {
  test('a tenant-A Code/PromotionUsage is never visible, mutable, or reachable from tenant B', async ({ request }) => {
    test.setTimeout(90_000);
    const adminToken = await getAuthToken(request, 'admin');
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = uniqueStamp();

    let actor: SecondTenantActor | null = null;
    let staticCodeId: string | null = null;
    let dynamicCodeId: string | null = null;
    let promotionId: string | null = null;
    const staticCodeString = `QA-PROM-082-${stamp}`.toUpperCase();
    const reservationCartId = randomUUID();

    try {
      actor = await createSecondTenantActor(request, superadminToken, stamp, [
        ...PROMOTIONS_FEATURES,
        'promotions.codes.manage',
        'promotions.codes.redeem',
        'promotions.usage.manage',
      ]);

      const staticFixture = await createCodeFixture(request, adminToken, {
        name: `QA PROM 082 Static ${stamp}`,
        type: 'static',
        code: staticCodeString,
        usage: 'unlimited',
        active: true,
      });
      staticCodeId = staticFixture.id;

      const dynamicFixture = await createCodeFixture(request, adminToken, {
        name: `QA PROM 082 Dynamic ${stamp}`,
        type: 'dynamic',
        amount: 5,
        active: true,
      });
      dynamicCodeId = dynamicFixture.id;

      // A real reservation under tenant A, to prove tenant B's `release` cannot touch it.
      const reserveUnderA = await apiRequest(request, 'POST', CODES_RESERVE_PATH, {
        token: adminToken,
        data: { codeString: staticCodeString, cartId: reservationCartId, customerId: null },
      });
      expect(reserveUnderA.status(), 'reserving under tenant A should succeed').toBe(200);

      const promotionFixture = await createPromotionFixture(request, adminToken, { name: `QA PROM 082 Promo ${stamp}` });
      promotionId = promotionFixture.id;
      const promotionDetail = await apiRequest(request, 'GET', `/api/promotions/${promotionId}`, { token: adminToken });
      const promotionDetailBody = await readJsonSafe<{ organizationId?: string; tenantId?: string }>(promotionDetail);
      const promotionOrgId = promotionDetailBody?.organizationId ?? null;
      const promotionTenantId = promotionDetailBody?.tenantId ?? null;

      const usageOrderId = `qa-prom-082-${stamp}`;
      const revertOrderId = `qa-prom-082-revert-${stamp}`;
      const registerUnderA = await apiRequest(request, 'POST', USAGE_REGISTER_PATH, {
        token: adminToken,
        data: {
          orderId: usageOrderId,
          orderType: 'order',
          customerId: null,
          currency: 'USD',
          appliedPromotions: [
            { promotionId, promotionName: 'QA Promo 082', effects: [{ type: 'LINE_DISCOUNT', amountNet: '-5.00' }] },
          ],
        },
      });
      expect(registerUnderA.status()).toBe(200);
      // A SEPARATE orderId that tenant B never registers against, so the `usage/revert`
      // isolation check below cannot be confounded by a row tenant B's own
      // cross-tenant-write test (further down) wrote for itself under the SAME orderId.
      const registerForRevertUnderA = await apiRequest(request, 'POST', USAGE_REGISTER_PATH, {
        token: adminToken,
        data: {
          orderId: revertOrderId,
          orderType: 'order',
          customerId: null,
          currency: 'USD',
          appliedPromotions: [
            { promotionId, promotionName: 'QA Promo 082', effects: [{ type: 'LINE_DISCOUNT', amountNet: '-3.00' }] },
          ],
        },
      });
      expect(registerForRevertUnderA.status()).toBe(200);

      // === `codes` admin CRUD: list/detail/update/delete ===
      const listB = await apiRequest(request, 'GET', `${CODES_PATH}?pageSize=100`, { token: actor.token });
      expect(listB.status()).toBe(200);
      const listBBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(listB);
      expect((listBBody?.items ?? []).some((item) => item.id === staticCodeId)).toBe(false);

      const detailB = await apiRequest(request, 'GET', codeDetailQueryPath(staticCodeId!), { token: actor.token });
      expect(detailB.status()).toBe(200);
      const detailBBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(detailB);
      expect((detailBBody?.items ?? []).length, 'tenant B must get an empty items array, not the tenant-A row').toBe(0);

      const updateB = await apiRequest(request, 'PUT', CODES_PATH, {
        token: actor.token,
        data: { id: staticCodeId, name: 'cross-tenant rename attempt' },
      });
      expect(updateB.status(), 'tenant B update of a tenant-A code must 404').toBe(404);

      const deleteB = await apiRequest(request, 'DELETE', `${CODES_PATH}?id=${encodeURIComponent(staticCodeId!)}`, {
        token: actor.token,
      });
      expect(deleteB.status(), 'tenant B delete of a tenant-A code must 404').toBe(404);

      // === `codes/[id]/generate` and `codes/[id]/generated` ===
      const generateB = await apiRequest(request, 'POST', codeGeneratePath(dynamicCodeId!), { token: actor.token });
      expect(generateB.status(), 'tenant B triggering generation on a tenant-A code must 404').toBe(404);

      const generatedB = await apiRequest(request, 'GET', codeGeneratedPath(dynamicCodeId!), { token: actor.token });
      expect(generatedB.status(), 'tenant B listing generated codes for a tenant-A code must 404').toBe(404);

      // === `codes/reserve` / `codes/validate` / `codes/use`: uniform code_invalid ===
      const reserveB = await apiRequest(request, 'POST', CODES_RESERVE_PATH, {
        token: actor.token,
        data: { codeString: staticCodeString, cartId: randomUUID(), customerId: null },
      });
      expect(reserveB.status(), 'tenant B reserving a tenant-A codeString must answer the uniform code_invalid').toBe(422);
      expect(await readJsonSafe(reserveB)).toEqual({ error: 'code_invalid' });

      const validateB = await apiRequest(request, 'POST', CODES_VALIDATE_PATH, {
        token: actor.token,
        data: { codeString: staticCodeString, cartId: randomUUID(), customerId: null },
      });
      expect(validateB.status()).toBe(200);
      expect(await readJsonSafe(validateB)).toEqual({ valid: false, reason: 'code_invalid' });

      const useB = await apiRequest(request, 'POST', CODES_USE_PATH, {
        token: actor.token,
        data: { codeId: staticCodeId, codeString: staticCodeString, cartId: randomUUID(), customerId: null, type: 'static' },
      });
      expect(useB.status(), 'tenant B using a tenant-A code must answer the uniform code_invalid').toBe(422);
      expect(await readJsonSafe(useB)).toEqual({ error: 'code_invalid' });

      // Survivor: tenant B's use attempt must not have touched the tenant-A code's own
      // use counter.
      const staticCodeRowAfterB = await readCodeRow(staticCodeId!);
      expect(staticCodeRowAfterB?.used).toBe(0);

      // === `codes/release`: scoped nativeDelete must not reach tenant A's reservation ===
      const releaseB = await apiRequest(request, 'POST', CODES_RELEASE_PATH, {
        token: actor.token,
        data: { codeString: staticCodeString, cartId: reservationCartId, customerId: null },
      });
      expect(releaseB.status(), 'release under tenant B always answers 200 (no enumeration oracle)').toBe(200);
      expect(await readJsonSafe(releaseB)).toEqual({ ok: true });
      const reservationSurvived = await codeReservationExistsInDb({ codeId: staticCodeId!, cartId: reservationCartId });
      expect(reservationSurvived, "tenant A's own reservation must survive tenant B's release attempt").toBe(true);

      // === `usage/register`: a foreign promotionId writes its OWN tenant-scoped ledger
      // row (no budget to check — documented "write the ledger row anyway" behaviour,
      // §Promotion Usage Lifecycle) but must never touch or duplicate tenant A's row.
      const registerUnderB = await apiRequest(request, 'POST', USAGE_REGISTER_PATH, {
        token: actor.token,
        data: {
          orderId: usageOrderId,
          orderType: 'order',
          customerId: null,
          currency: 'USD',
          appliedPromotions: [
            { promotionId, promotionName: 'QA Promo 082', effects: [{ type: 'LINE_DISCOUNT', amountNet: '-5.00' }] },
          ],
        },
      });
      expect(registerUnderB.status(), 'a foreign promotionId has no budget to enforce, so this still answers 200').toBe(200);

      const rowsUnderA = await readPromotionUsageRows({
        promotionId: promotionId!,
        organizationId: promotionOrgId!,
        tenantId: promotionTenantId!,
        orderId: usageOrderId,
      });
      expect(rowsUnderA, "tenant A's own usage row for this orderId must be the only one, untouched").toHaveLength(1);
      expect(rowsUnderA[0].organization_id).toBe(promotionOrgId);
      expect(rowsUnderA[0].reverted_at).toBeNull();

      // === `usage/revert`: scoped `em.find` must not reach tenant A's own usage row ===
      // Uses `revertOrderId` specifically, which tenant B never registered against
      // itself — isolating this from the cross-tenant-write behaviour exercised above.
      const revertUnderB = await apiRequest(request, 'POST', USAGE_REVERT_PATH, { token: actor.token, data: { orderId: revertOrderId } });
      expect(revertUnderB.status()).toBe(200);
      expect((await readJsonSafe<{ revertedCount: number }>(revertUnderB))?.revertedCount).toBe(0);

      const rowsAfterBRevert = await readPromotionUsageRows({
        promotionId: promotionId!,
        organizationId: promotionOrgId!,
        tenantId: promotionTenantId!,
        orderId: revertOrderId,
      });
      expect(rowsAfterBRevert[0].reverted_at, "tenant B's revert must never revert tenant A's own row").toBeNull();
    } finally {
      await deletePromotionUsageRowsInDb(promotionId);
      await deletePromotionIfExists(request, adminToken, promotionId);
      await deleteCodeIfExists(request, adminToken, staticCodeId);
      await deleteCodeIfExists(request, adminToken, dynamicCodeId);
      await cleanupSecondTenantActor(request, superadminToken, actor);
    }
  });
});
