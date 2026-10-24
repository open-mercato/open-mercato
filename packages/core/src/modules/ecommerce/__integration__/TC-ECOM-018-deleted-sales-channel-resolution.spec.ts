import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness';
import {
  CHANNEL_BINDINGS_PATH,
  cleanupStorefrontFixture,
  createChannelBindingFixture,
  createSalesChannelFixture,
  createStorefrontFixture,
  deleteSalesChannelIfExists,
  getStorefrontContext,
  type StorefrontFixture,
} from './helpers';

/**
 * TC-ECOM-018: a store whose default sales channel was deleted stops resolving that channel.
 * Source: .ai/specs/SPEC-029-2026-02-17-ecommerce-storefront-module.md §4.1 and §8.
 *
 * `sales.channels.delete` hard-deletes the channel row. Store resolution only accepts a default
 * channel binding whose sales channel still exists, and `sales.channel.*` evicts the cached
 * resolution, so the store answers `503 store_misconfigured` right after the delete instead of
 * serving a channel that no longer exists. The bindings themselves are kept, so undoing the
 * delete brings the store back with its configuration intact.
 */

const SALES_CHANNELS_PATH = '/api/sales/channels';
const EVICTION_TIMEOUT = 20_000;

type BindingState = { id: string; deleted: boolean };

async function readBindingStates(bindingIds: string[]): Promise<BindingState[]> {
  return withClient(async (client) => {
    const result = await client.query(
      'select id, deleted_at is not null as deleted from ecommerce_store_channel_bindings where id = any($1::uuid[]) order by id',
      [bindingIds],
    );
    return result.rows as BindingState[];
  });
}

async function listStoreBindingIds(request: APIRequestContext, token: string, storeId: string): Promise<string[]> {
  const response = await apiRequest(
    request,
    'GET',
    `${CHANNEL_BINDINGS_PATH}?storeId=${encodeURIComponent(storeId)}&pageSize=100`,
    { token },
  );
  expect(response.status()).toBe(200);
  const items = (await readJsonSafe<{ items?: Array<{ id: string }> }>(response))?.items ?? [];
  return items.map((item) => item.id).sort();
}

async function deleteSalesChannel(request: APIRequestContext, token: string, id: string): Promise<string> {
  const response = await apiRequest(request, 'DELETE', `${SALES_CHANNELS_PATH}?id=${encodeURIComponent(id)}`, { token });
  expect(response.status(), `sales channel delete should be 200 (${await response.text()})`).toBe(200);
  return expectOperation(response, 'sales channel delete').undoToken;
}

async function contextStatus(hostname: string): Promise<number> {
  return (await getStorefrontContext(hostname)).status;
}

test.describe('TC-ECOM-018: deleting a store default sales channel', () => {
  test.describe.configure({ timeout: 120_000 });

  test('the storefront answers 503 after the delete and the bindings are kept', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    let fixture: StorefrontFixture | null = null;
    let otherChannelId: string | null = null;
    try {
      fixture = await createStorefrontFixture(request, token);
      const hostname = fixture.hostname;
      otherChannelId = await createSalesChannelFixture(request, token, `${fixture.stamp}-other`);
      const otherBindingId = await createChannelBindingFixture(request, token, {
        storeId: fixture.storeId,
        salesChannelId: otherChannelId,
        isDefault: false,
      });
      const bindingIds = [fixture.channelBindingId ?? '', otherBindingId].sort();

      const before = await getStorefrontContext(hostname);
      expect(before.status, `context should resolve before the delete (${before.text})`).toBe(200);

      await deleteSalesChannel(request, token, fixture.salesChannelId);

      await expect.poll(() => contextStatus(hostname), { timeout: EVICTION_TIMEOUT }).toBe(503);
      const after = await getStorefrontContext(hostname);
      expect(after.body).toEqual({ error: 'store_misconfigured' });
      expect(await readBindingStates(bindingIds)).toEqual(bindingIds.map((id) => ({ id, deleted: false })));
      expect(await listStoreBindingIds(request, token, fixture.storeId)).toEqual(bindingIds);
    } finally {
      await cleanupStorefrontFixture(request, token, fixture);
      await deleteSalesChannelIfExists(request, token, otherChannelId);
    }
  });

  test('undoing the sales channel delete serves the store again', async ({ request }) => {
    skipIfUndoTestsDisabled();
    const token = await getAuthToken(request, 'admin');
    let fixture: StorefrontFixture | null = null;
    try {
      fixture = await createStorefrontFixture(request, token);
      const hostname = fixture.hostname;
      const before = await getStorefrontContext(hostname);
      expect(before.status, `context should resolve before the delete (${before.text})`).toBe(200);

      const undoToken = await deleteSalesChannel(request, token, fixture.salesChannelId);
      await expect.poll(() => contextStatus(hostname), { timeout: EVICTION_TIMEOUT }).toBe(503);

      await undoOk(request, token, undoToken, 'sales channel delete');
      await expect.poll(() => contextStatus(hostname), { timeout: EVICTION_TIMEOUT }).toBe(200);
    } finally {
      await cleanupStorefrontFixture(request, token, fixture);
    }
  });
});
