import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

/**
 * TC-QIDX-9182: credential columns stay out of the stored index document.
 *
 * `auth:user` has `password_hash` and `email_hash`, and both match the default search
 * blocklist. Neither may be stored in `entity_indexes.doc`:
 *   1. on a create, which takes the event path (`buildIndexDoc`);
 *   2. on a reindex, which takes the batch path (`buildIndexDocument`) and also replaces a
 *      copy that a row written before the fix still holds;
 *   3. on the next ordinary write after that reindex, which takes the event path again.
 */

const USER_ENTITY = 'auth:user'
const BLOCKLISTED_KEYS = ['password_hash', 'email_hash']
const DISPLAY_KEYS = ['email', 'name']
const STALE_COPY = 'tc-qidx-9182-stale-copy'
const EVENTS_QUEUE = 'events'
const INDEX_TIMEOUT_MS = 15_000
const REINDEX_TIMEOUT_MS = 60_000

async function storedKeys(userId: string): Promise<string[] | null> {
  return withClient(async (client) => {
    const result = await client.query<{ keys: string[] }>(
      `select array(select key from jsonb_object_keys(doc) as key order by key) as keys
         from entity_indexes
        where entity_type = $1 and entity_id = $2 and deleted_at is null`,
      [USER_ENTITY, userId],
    )
    return result.rows[0]?.keys ?? null
  })
}

async function storedValue(userId: string, key: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query<{ value: string | null }>(
      `select doc ->> $3 as value from entity_indexes
        where entity_type = $1 and entity_id = $2 and deleted_at is null`,
      [USER_ENTITY, userId, key],
    )
    return result.rows[0]?.value ?? null
  })
}

function expectNoBlocklistedKeys(keys: string[] | null, moment: string): void {
  expect(keys, `The user should be indexed ${moment}`).not.toBeNull()
  expect(keys, `The display columns should be stored ${moment}`).toEqual(expect.arrayContaining(DISPLAY_KEYS))
  for (const key of BLOCKLISTED_KEYS) {
    expect(keys, `${key} must not be stored ${moment}`).not.toContain(key)
  }
}

async function reindexUsers(request: APIRequestContext, token: string): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/query_index/reindex', {
    token,
    data: { entityType: USER_ENTITY },
  })
  expect(response.ok(), `POST /api/query_index/reindex: ${response.status()}`).toBeTruthy()
  await drainIntegrationQueue(EVENTS_QUEUE)
}

async function removeIndexResidue(userId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('delete from entity_indexes where entity_type = $1 and entity_id = $2', [USER_ENTITY, userId])
    await client.query('delete from search_tokens where entity_type = $1 and entity_id = $2', [USER_ENTITY, userId])
  })
}

test.describe('TC-QIDX-9182: blocklisted columns stay out of the stored index document', () => {
  test('a create, a reindex and the next write store auth:user without its hash columns', async ({ request }) => {
    test.setTimeout(180_000)
    const token = await getAuthToken(request, 'superadmin')
    const { organizationId } = getTokenContext(token)
    const stamp = Date.now()
    let userId: string | null = null

    try {
      userId = await createUserFixture(request, token, {
        email: `qa-qidx-9182-${stamp}@acme.com`,
        password: 'Valid1!Pass',
        organizationId,
        roles: ['employee'],
        name: `QA TC-QIDX-9182 ${stamp}`,
      })
      const createdId = userId

      await expect.poll(() => storedKeys(createdId), { timeout: INDEX_TIMEOUT_MS }).not.toBeNull()
      expectNoBlocklistedKeys(await storedKeys(createdId), 'after the create')

      await withClient((client) => client.query(
        `update entity_indexes set doc = doc || jsonb_build_object('password_hash', $3::text)
          where entity_type = $1 and entity_id = $2`,
        [USER_ENTITY, createdId, STALE_COPY],
      ))
      expect(await storedValue(createdId, 'password_hash'), 'A row written before the fix holds a copy').toBe(STALE_COPY)
      await reindexUsers(request, token)
      await expect.poll(() => storedValue(createdId, 'password_hash'), { timeout: REINDEX_TIMEOUT_MS }).not.toBe(STALE_COPY)
      expectNoBlocklistedKeys(await storedKeys(createdId), 'after the reindex')

      const nameBefore = await storedValue(createdId, 'name')
      const update = await apiRequest(request, 'PUT', '/api/auth/users', {
        token,
        data: { id: createdId, name: `QA TC-QIDX-9182 renamed ${stamp}` },
      })
      expect(update.status(), 'PUT /api/auth/users').toBe(200)
      await expect.poll(() => storedValue(createdId, 'name'), { timeout: INDEX_TIMEOUT_MS }).not.toBe(nameBefore)
      expectNoBlocklistedKeys(await storedKeys(createdId), 'after the next write')
    } finally {
      await deleteUserIfExists(request, token, userId)
      if (userId) await removeIndexResidue(userId).catch(() => undefined)
    }
  })
})
