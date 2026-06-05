import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures';

/**
 * TC-CATALOG-2453-VARIANT: proves the #2453-class fix for
 * `updateVariantCommand` (packages/core/src/modules/catalog/commands/variants.ts).
 *
 * The bug: when a variant update both changes scalar columns (name, sku) AND sets
 * `isDefault: true`, the command runs `enforceSingleDefaultVariant`'s interleaved
 * `em.findOne` inside `withAtomicFlush`. Pre-fix, that interleaved read on the same
 * EntityManager discarded the pending scalar changes from MikroORM's unit of work,
 * so the PUT returned 200 (and bumped updated_at) but `name`/`sku` reverted to their
 * previous values on the next read.
 *
 * This test forces the interleaved read by promoting a SECOND, non-default variant to
 * default on a product that already has a DIFFERENT default variant — that condition is
 * what makes `enforceSingleDefaultVariant` execute its `em.findOne`. It then re-fetches
 * via GET and asserts the changed scalar columns actually round-trip to the new value
 * (not just status 200) AND that the previously-default variant flipped to `is_default=false`.
 */

type VariantReadItem = {
  id: string;
  name?: string | null;
  sku?: string | null;
  is_default?: boolean | null;
};

test.describe('TC-CATALOG-2453-VARIANT: variant scalar update persists through interleaved default-enforcement read', () => {
  test('promoting a variant to default while renaming persists name + sku and flips the prior default', async ({ request }) => {
    let token: string | null = null;
    let productId: string | null = null;
    const stamp = Date.now();

    try {
      token = await getAuthToken(request, 'admin');

      productId = await createProductFixture(request, token, {
        title: `QA 2453 Variant Host ${stamp}`,
        sku: `QA-2453-HOST-${stamp}`,
      });

      const defaultVariantId = await createVariantFixture(request, token, {
        productId,
        name: `Original Default ${stamp}`,
        sku: `QA-2453-DEF-${stamp}`,
        isDefault: true,
      });
      const secondVariantId = await createVariantFixture(request, token, {
        productId,
        name: `Original Second ${stamp}`,
        sku: `QA-2453-SEC-${stamp}`,
        isDefault: false,
      });
      expect(defaultVariantId).not.toBe(secondVariantId);

      const readVariants = async (): Promise<VariantReadItem[]> => {
        const res = await apiRequest(
          request,
          'GET',
          `/api/catalog/variants?productId=${encodeURIComponent(productId!)}&pageSize=100`,
          { token: token! },
        );
        expect(res.status(), 'variant list readable').toBe(200);
        return ((await res.json()) as { items?: VariantReadItem[] }).items ?? [];
      };

      const beforeUpdate = await readVariants();
      expect(
        beforeUpdate.find((variant) => variant.id === defaultVariantId)?.is_default,
        'precondition: first variant is the default',
      ).toBe(true);
      expect(
        beforeUpdate.find((variant) => variant.id === secondVariantId)?.is_default,
        'precondition: second variant is NOT default',
      ).toBe(false);

      // CRITICAL TRIGGER: change scalar fields (name + sku) AND set isDefault: true on a
      // product that already has a DIFFERENT default variant. This forces
      // enforceSingleDefaultVariant's interleaved em.findOne inside withAtomicFlush.
      const updatedName = `Renamed Promoted ${stamp}`;
      const updatedSku = `QA-2453-NEWSKU-${stamp}`;
      const updateRes = await apiRequest(request, 'PUT', '/api/catalog/variants', {
        token,
        data: {
          id: secondVariantId,
          name: updatedName,
          sku: updatedSku,
          isDefault: true,
        },
      });
      expect(updateRes.status(), 'variant update returns 200').toBe(200);

      const afterUpdate = await readVariants();
      const promoted = afterUpdate.find((variant) => variant.id === secondVariantId);
      const demoted = afterUpdate.find((variant) => variant.id === defaultVariantId);

      expect(promoted, 'promoted variant readable after update').toBeTruthy();
      // The bug-proving assertions: scalar columns must round-trip, not revert.
      expect(promoted!.name, 'name persisted through interleaved default-enforcement read').toBe(updatedName);
      expect(promoted!.sku, 'sku persisted through interleaved default-enforcement read').toBe(updatedSku);
      expect(promoted!.is_default, 'promoted variant is now default').toBe(true);

      // Single-default invariant: the previously-default variant flips off.
      expect(demoted, 'previously-default variant readable after update').toBeTruthy();
      expect(demoted!.is_default, 'previously-default variant flipped to non-default').toBe(false);
      expect(
        afterUpdate.filter((variant) => variant.is_default === true).length,
        'exactly one default variant remains',
      ).toBe(1);
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
