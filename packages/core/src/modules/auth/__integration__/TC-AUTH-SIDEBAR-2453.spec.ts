import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-AUTH-SIDEBAR-2453: #2453-class interleaved-read scalar-persist proof for
 * `updateSidebarVariant` (auth/services/sidebarPreferencesService.ts).
 *
 * Bug shape (pre-fix): updating a variant's `name`/`settings` columns while the
 * same PUT also sets `isActive: true` forces `deactivateAllVariants`'s interleaved
 * `em.nativeUpdate` to run between the scalar mutation and the terminal
 * `em.flush()` inside `withAtomicFlush`. Under MikroORM v7 that interleaved
 * write/read discards the pending changeset on the managed variant, so the
 * name/settings UPDATE is never issued — the PUT still returns 200 (and the
 * activation flip persists), but the name/settings silently revert.
 *
 * CRITICAL TRIGGER: `isActive: true` MUST be present in the PUT payload. Without
 * it `deactivateAllVariants` never runs, no interleaved write occurs, and the bug
 * does not reproduce.
 *
 * Assertion: re-fetch via GET and assert EACH changed scalar column (name,
 * settings.groupLabels) round-trips to its NEW value — not merely that the PUT
 * returned 200.
 *
 * Endpoints (verified against api/sidebar/variants routes):
 *   POST   /api/auth/sidebar/variants
 *   PUT    /api/auth/sidebar/variants/<id>
 *   GET    /api/auth/sidebar/variants/<id>
 *   DELETE /api/auth/sidebar/variants/<id>
 * PUT/DELETE require the seeded admin's `auth.sidebar.manage` feature.
 */
test.describe('TC-AUTH-SIDEBAR-2453: variant scalar edit persists across interleaved deactivate write', () => {
  test('PUT name+settings WITH isActive:true persists name and settings', async ({ request }) => {
    let token: string | null = null;
    let variantId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      const timestamp = Date.now();
      const originalName = `QA TC-AUTH-SIDEBAR-2453 original ${timestamp}`;
      const updatedName = `QA TC-AUTH-SIDEBAR-2453 updated ${timestamp}`;
      const updatedGroupId = `qa-group-${timestamp}`;
      const updatedGroupLabel = `QA Group ${timestamp}`;

      // 1. Create the variant via the API (inactive, plain settings).
      const createResponse = await apiRequest(request, 'POST', '/api/auth/sidebar/variants', {
        token,
        data: {
          name: originalName,
          isActive: false,
          settings: { groupLabels: { 'qa-original': `Original ${timestamp}` } },
        },
      });
      expect(createResponse.status()).toBe(200);
      const createBody = (await createResponse.json()) as { variant?: { id?: unknown } };
      expect(typeof createBody.variant?.id).toBe('string');
      variantId = createBody.variant?.id as string;

      // 2. PUT the variant: change scalar columns (name + settings) AND set
      //    isActive: true. The isActive flip is the load-bearing trigger — it
      //    forces deactivateAllVariants' interleaved nativeUpdate inside
      //    withAtomicFlush.
      const updateResponse = await apiRequest(
        request,
        'PUT',
        `/api/auth/sidebar/variants/${variantId}`,
        {
          token,
          data: {
            name: updatedName,
            isActive: true,
            settings: { groupLabels: { [updatedGroupId]: updatedGroupLabel } },
          },
        },
      );
      expect(updateResponse.status()).toBe(200);
      const updateBody = (await updateResponse.json()) as {
        variant?: {
          name?: unknown;
          isActive?: unknown;
          settings?: { groupLabels?: Record<string, unknown> };
        };
      };
      // The PUT response itself must already reflect the persisted scalars.
      expect(updateBody.variant?.name).toBe(updatedName);
      expect(updateBody.variant?.isActive).toBe(true);
      expect(updateBody.variant?.settings?.groupLabels?.[updatedGroupId]).toBe(updatedGroupLabel);

      // 3. Re-fetch and assert EACH changed scalar column round-trips to its new
      //    value. Pre-fix these would still hold the original values despite the
      //    200 response (only the isActive flip would have survived).
      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/auth/sidebar/variants/${variantId}`,
        { token },
      );
      expect(detailResponse.status()).toBe(200);
      const detailBody = (await detailResponse.json()) as {
        variant?: {
          name?: unknown;
          isActive?: unknown;
          settings?: { groupLabels?: Record<string, unknown> };
        };
      };
      expect(detailBody.variant?.name).toBe(updatedName);
      expect(detailBody.variant?.isActive).toBe(true);
      expect(detailBody.variant?.settings?.groupLabels?.[updatedGroupId]).toBe(updatedGroupLabel);
      // The original group label must be gone — proving settings was replaced,
      // not merely merged or reverted.
      expect(detailBody.variant?.settings?.groupLabels?.['qa-original']).toBeUndefined();
    } finally {
      if (token && variantId) {
        await apiRequest(request, 'DELETE', `/api/auth/sidebar/variants/${variantId}`, {
          token,
        }).catch(() => undefined);
      }
    }
  });
});
