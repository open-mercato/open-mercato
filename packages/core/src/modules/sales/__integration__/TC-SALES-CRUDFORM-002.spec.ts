import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures';
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
} from '@open-mercato/core/helpers/integration/crudFormPersistence';

/**
 * TC-SALES-CRUDFORM-002: Channel-offer CrudForm persists scalars (#2466).
 *
 * An offer links a catalog product to a sales channel (the "channel-offer" surface), served by
 * the catalog offers route but gated by `sales.channels.manage`. Proves create + update
 * round-trip every scalar — including the `channelId` / `productId` foreign keys retained across
 * a partial update and a JSON `metadata` blob.
 *
 * Verified contract:
 * - Route `/api/catalog/offers`: POST 201 `{ id }`, PUT/DELETE 200 `{ ok: true }`, list `?id=`.
 * - Request bodies camelCase; responses camelCase (`channelId`, `productId`, `isActive`, ...).
 * - Create requires `channelId`, `productId`, `title`; PUT is partial so omitted FKs are retained.
 * - Self-contained: creates its own channel + product, deletes them in `finally`; the offer is
 *   deleted by the harness round-trip.
 * - The offer has no default custom fields, so this surface covers scalars + FK + JSON metadata.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const OFFERS_PATH = '/api/catalog/offers';
const CHANNELS_PATH = '/api/sales/channels';

async function createChannelFixture(
  request: APIRequestContext,
  token: string,
  stamp: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', CHANNELS_PATH, {
    token,
    data: { name: `QA CRUDFORM Offer Channel ${stamp}`, code: `qa-offer-${stamp}` },
  });
  expect(response.status(), 'channel fixture create should be 201').toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'channel fixture should return an id');
}

async function deleteChannelIfExists(
  request: APIRequestContext,
  token: string | null,
  channelId: string | null,
): Promise<void> {
  if (!token || !channelId) return;
  await apiRequest(request, 'DELETE', `${CHANNELS_PATH}?id=${encodeURIComponent(channelId)}`, { token }).catch(
    () => undefined,
  );
}

test.describe('TC-SALES-CRUDFORM-002: Channel-offer CrudForm persists scalars', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled();
  });

  test('round-trips title, description, isActive, media url, metadata and retains FKs on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = `${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    let channelId: string | null = null;
    let productId: string | null = null;

    try {
      channelId = await createChannelFixture(request, token, stamp);
      productId = await createProductFixture(request, token, {
        title: `QA CRUDFORM Offer Product ${stamp}`,
        sku: `QA-OFFER-${stamp}`,
      });

      await runCrudFormRoundTrip({
        request,
        token,
        collectionPath: OFFERS_PATH,
        create: {
          payload: {
            channelId,
            productId,
            title: `QA CRUDFORM Offer ${stamp}`,
            description: 'Original offer description',
            isActive: true,
            defaultMediaUrl: 'https://cdn.example.com/qa-offer-original.png',
            metadata: { source: 'qa-crudform', tier: 1 },
          },
        },
        expectAfterCreate: {
          scalars: {
            channelId,
            productId,
            title: `QA CRUDFORM Offer ${stamp}`,
            description: 'Original offer description',
            isActive: true,
            defaultMediaUrl: 'https://cdn.example.com/qa-offer-original.png',
            metadata: { source: 'qa-crudform', tier: 1 },
          },
        },
        update: {
          payload: (id) => ({
            id,
            title: `QA CRUDFORM Offer ${stamp} EDITED`,
            description: 'Updated offer description',
            isActive: false,
            defaultMediaUrl: 'https://cdn.example.com/qa-offer-edited.png',
            metadata: { source: 'qa-crudform', tier: 2 },
          }),
        },
        expectAfterUpdate: {
          scalars: {
            channelId,
            productId,
            title: `QA CRUDFORM Offer ${stamp} EDITED`,
            description: 'Updated offer description',
            isActive: false,
            defaultMediaUrl: 'https://cdn.example.com/qa-offer-edited.png',
            metadata: { source: 'qa-crudform', tier: 2 },
          },
        },
      });
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
      await deleteChannelIfExists(request, token, channelId);
    }
  });
});
