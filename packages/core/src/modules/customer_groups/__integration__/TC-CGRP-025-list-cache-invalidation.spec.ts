import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCustomerGroupFixture,
  createCustomerGroupMembershipFixture,
  deleteCustomerGroupIfExists,
  deleteCustomerGroupMembershipIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { fixturePriority, uniqueStamp } from './helpers';

/**
 * TC-CGRP-025: tenant-level CRUD list caches are flushed by a create.
 *
 * Regression coverage for the `makeCrudRoute` cache-tag fix (#6370): lists of
 * `orgField: null` entities (`CustomerGroup`, `CustomerGroupMembership`) were
 * cached under the caller's organization collection tag, while a write only
 * invalidates the tenant-level `org:null` tag. With `ENABLE_CRUD_API_CACHE`
 * on (forced by the ephemeral integration runner) the identical list GET
 * issued right after a 201 create was a cache hit serving the pre-create
 * payload.
 *
 * Each case primes the cache with an empty list for a URL only this run can
 * match, creates a row, then repeats the IDENTICAL URL and expects the new row.
 */
const GROUPS_PATH = '/api/customer_groups/customer-groups';
const MEMBERSHIPS_PATH = '/api/customer_groups/customer-groups/memberships';

async function listIds(request: APIRequestContext, token: string, url: string): Promise<string[]> {
  const response = await apiRequest(request, 'GET', url, { token });
  expect(response.status(), `GET ${url} should be 200`).toBe(200);
  const body = await readJsonSafe<{ items?: Array<{ id?: string }> }>(response);
  return (body?.items ?? []).flatMap((item) => (typeof item.id === 'string' ? [item.id] : []));
}

test.describe('TC-CGRP-025: tenant-level list cache is invalidated on create', () => {
  test('the groups list re-fetched with the identical URL after a create includes the new group', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const listUrl = `${GROUPS_PATH}?search=${encodeURIComponent(`qa-cgrp-025-${stamp}`)}&pageSize=10`;

    let groupId: string | null = null;

    try {
      expect(await listIds(request, token, listUrl), 'the list must start empty for this run').toEqual([]);

      groupId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-025-${stamp}`,
        name: `QA CGRP 025 Group ${stamp}`,
        priority: fixturePriority(stamp, 1),
      });

      expect(
        await listIds(request, token, listUrl),
        'the identical list URL must not serve the cached pre-create payload',
      ).toEqual([groupId]);
    } finally {
      await deleteCustomerGroupIfExists(request, token, groupId);
    }
  });

  test('the memberships list re-fetched with the identical URL after a create includes the new membership', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const customerId = randomUUID();
    const listUrl = `${MEMBERSHIPS_PATH}?customerId=${encodeURIComponent(customerId)}&pageSize=10`;

    let groupId: string | null = null;
    let membershipId: string | null = null;

    try {
      groupId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-025-m-${stamp}`,
        name: `QA CGRP 025 Membership Group ${stamp}`,
        priority: fixturePriority(stamp, 2),
      });

      expect(await listIds(request, token, listUrl), 'a fresh customer must start with no memberships').toEqual([]);

      membershipId = await createCustomerGroupMembershipFixture(request, token, { groupId, customerId });

      expect(
        await listIds(request, token, listUrl),
        'the identical list URL must not serve the cached pre-create payload',
      ).toEqual([membershipId]);
    } finally {
      await deleteCustomerGroupMembershipIfExists(request, token, membershipId);
      await deleteCustomerGroupIfExists(request, token, groupId);
    }
  });
});
