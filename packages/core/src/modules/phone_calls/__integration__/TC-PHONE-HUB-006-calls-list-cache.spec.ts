import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deletePhoneCallsIfExist, ingestPhoneCallFixture } from './helpers/phoneCallsFixtures'

type CallRow = { external_call_id?: string | null }
type ListBody = { items?: CallRow[] }

/**
 * TC-PHONE-HUB-006 — an ingest makes the cached call list stale, and the list route notices.
 *
 * The write side and the read side agree on one string and nothing else. The list route
 * declares no `events`/`actions`, so `makeCrudRoute` derives its cache tag from the ORM class
 * name; the command's own id and `resourceKind` both canonicalize to different tags. Only the
 * `cacheAliases` entry the command puts on its log bridges the two. Drop it and nothing fails
 * loudly - the list simply keeps serving the page it cached before the calls arrived.
 *
 * The ingest is driven through the command bus in this process rather than over HTTP, because
 * the hub has no route that writes: the only writer is this command, and pointing the provider
 * at a local stub is refused by `safeOutboundFetch`. The ephemeral environment puts the test
 * process and the app server on one sqlite cache backend (`CACHE_STRATEGY=sqlite`), so an
 * invalidation performed here is the same invalidation the running app sees.
 */
test.describe('TC-PHONE-HUB-006: ingest invalidates the cached calls list', () => {
  test('an identical query is served from cache until an ingest, then reflects it', async ({ request }) => {
    test.slow()

    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const externalCallId = `qa-phone-hub-006-${stamp}`
    const providerKey = `qa-cache-${stamp}`
    let ingestedId: string | null = null

    try {
      const token = await getAuthToken(request)
      const scope = getTokenScope(token)
      // The query never changes across the three reads: a differing key would be a cache miss
      // for the trivial reason and would prove nothing about invalidation.
      const query = `/api/phone_calls/calls?providerKey=${encodeURIComponent(providerKey)}&pageSize=100`

      async function read(context: APIRequestContext): Promise<{ cache: string | undefined; ids: string[] }> {
        const response = await apiRequest(context, 'GET', query, { token })
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<ListBody>(response)
        return {
          cache: response.headers()['x-om-cache'],
          ids: (body?.items ?? []).map((item) => item.external_call_id ?? ''),
        }
      }

      const first = await read(request)
      expect(first.cache, 'a run-unique query cannot already be cached').toBe('miss')
      expect(first.ids, 'nothing carries this marker yet').toEqual([])

      const cached = await read(request)
      // Without this the test would pass on a route that never caches at all, and the
      // invalidation assertion below would be vacuous.
      expect(cached.cache, 'the repeated query must be served from the cache').toBe('hit')
      expect(cached.ids).toEqual([])

      const ingested = await ingestPhoneCallFixture(scope, {
        providerKey,
        externalCallId,
        direction: 'inbound',
        status: 'completed',
        participants: [],
        startedAt: new Date('2026-03-10T09:00:00Z'),
        rawPayload: { source: 'TC-PHONE-HUB-006' },
      })
      ingestedId = ingested.phoneCallId
      expect(ingested.created, 'the marker is run-unique, so this is an insert').toBe(true)

      const afterIngest = await read(request)
      expect(afterIngest.cache, 'the ingest must have dropped the cached page').toBe('miss')
      expect(afterIngest.ids, 'the freshly ingested call is listed').toEqual([externalCallId])
    } finally {
      await deletePhoneCallsIfExist([ingestedId])
    }
  })
})
