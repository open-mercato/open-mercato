import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

/**
 * TC-QIDX-8638: a forced reindex of `customers:customer_person_profile` must not bring back
 * the projection and search tokens of a profile whose parent `customer_entities` row is
 * soft-deleted, and must index the profile again once the parent is restored.
 */

const PERSON_PROFILE = 'customers:customer_person_profile'
const REINDEX_TIMEOUT_MS = 90_000

async function profileIdFor(entityId: string): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>('select id from customer_people where entity_id = $1', [entityId])
    const id = result.rows[0]?.id
    expect(id, `No customer_people row for entity ${entityId}`).toBeTruthy()
    return id as string
  })
}

async function setParentDeleted(entityId: string, deleted: boolean): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      deleted
        ? 'update customer_entities set deleted_at = now() where id = $1'
        : 'update customer_entities set deleted_at = null where id = $1',
      [entityId],
    )
  })
}

async function liveProjectionCount(profileId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'select count(*)::text as count from entity_indexes where entity_type = $1 and entity_id = $2 and deleted_at is null',
      [PERSON_PROFILE, profileId],
    )
    return Number(result.rows[0]?.count ?? 0)
  })
}

async function tokenCount(profileId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'select count(*)::text as count from search_tokens where entity_type = $1 and entity_id = $2',
      [PERSON_PROFILE, profileId],
    )
    return Number(result.rows[0]?.count ?? 0)
  })
}

async function searchHitIds(request: APIRequestContext, token: string, query: string): Promise<string[]> {
  const params = new URLSearchParams({ q: query, strategies: 'tokens', entityTypes: PERSON_PROFILE })
  const response = await apiRequest(request, 'GET', `/api/search/search?${params.toString()}`, { token })
  expect(response.ok(), `GET /api/search/search: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ results?: Array<{ recordId?: string }> }>(response)
  return (body?.results ?? []).map((result) => String(result.recordId ?? ''))
}

async function forceReindex(request: APIRequestContext, token: string): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/query_index/reindex', {
    token,
    data: { entityType: PERSON_PROFILE, force: true },
  })
  expect(response.ok(), `POST /api/query_index/reindex: ${response.status()}`).toBeTruthy()
  await drainIntegrationQueue('events')
}

test.describe('TC-QIDX-8638: profiles of soft-deleted customers stay out of the rebuilt index', () => {
  test('a forced reindex drops the ghost profile and restores it with its parent', async ({ request }) => {
    test.setTimeout(300_000)
    const token = await getAuthToken(request, 'admin')
    const marker = `Qidx8638${Date.now()}`
    let entityId: string | null = null
    let parentDeleted = false
    let testError: unknown = null

    try {
      entityId = await createPersonFixture(request, token, {
        firstName: marker,
        lastName: 'Ghost',
        displayName: `${marker} Ghost`,
      })
      const profileId = await profileIdFor(entityId)
      await expect.poll(() => tokenCount(profileId), { timeout: 30_000 }).toBeGreaterThan(0)
      await expect.poll(() => searchHitIds(request, token, marker), { timeout: 30_000 }).toContain(profileId)

      await setParentDeleted(entityId, true)
      parentDeleted = true
      expect(await liveProjectionCount(profileId)).toBe(1)
      expect(await tokenCount(profileId)).toBeGreaterThan(0)

      await forceReindex(request, token)
      await expect.poll(() => liveProjectionCount(profileId), { timeout: REINDEX_TIMEOUT_MS }).toBe(0)
      await expect.poll(() => tokenCount(profileId), { timeout: REINDEX_TIMEOUT_MS }).toBe(0)
      expect(await searchHitIds(request, token, marker)).not.toContain(profileId)

      await setParentDeleted(entityId, false)
      parentDeleted = false
      await forceReindex(request, token)
      await expect.poll(() => liveProjectionCount(profileId), { timeout: REINDEX_TIMEOUT_MS }).toBe(1)
      await expect.poll(() => tokenCount(profileId), { timeout: REINDEX_TIMEOUT_MS }).toBeGreaterThan(0)
      await expect.poll(() => searchHitIds(request, token, marker), { timeout: 30_000 }).toContain(profileId)
    } catch (error) {
      testError = error
      throw error
    } finally {
      const cleanupFailures: string[] = []
      if (entityId && parentDeleted) {
        try {
          await setParentDeleted(entityId, false)
        } catch (error) {
          cleanupFailures.push(`restore parent ${entityId}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (entityId) {
        try {
          const removal = await apiRequest(request, 'DELETE', `/api/customers/people?id=${encodeURIComponent(entityId)}`, { token })
          if (!removal.ok() && removal.status() !== 404) cleanupFailures.push(`DELETE person ${entityId}: ${removal.status()}`)
        } catch (error) {
          cleanupFailures.push(`DELETE person ${entityId}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (cleanupFailures.length) {
        const description = cleanupFailures.join('; ')
        if (testError) test.info().annotations.push({ type: 'cleanup-failure', description })
        else throw new Error(`[internal] TC-QIDX-8638 cleanup failed: ${description}`)
      }
    }
  })
})
