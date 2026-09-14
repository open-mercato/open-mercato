import path from 'node:path'
import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deletePhoneCallsIfExist } from './helpers/phoneCallsFixtures'

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT.trim())
  : path.resolve(process.cwd(), 'apps/mercato')

// Spelled out rather than imported from `commands/calls`: that module pulls in the ORM entity
// classes, and no integration spec in this repository loads those - the decorators do not survive
// the test process's transform. The id is the command's published contract, so a rename that
// forgot this test would fail it loudly at the bus.
const INGEST_COMMAND_ID = 'phone_calls.call.ingest'

type CallRow = { external_call_id?: string | null }
type ListBody = { items?: CallRow[] }
type IngestResult = { phoneCallId: string; created: boolean }

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
    let ingestedId: string | null = null

    try {
      const token = await getAuthToken(request)
      const scope = getTokenScope(token)
      // The query never changes across the three reads: a differing key would be a cache miss
      // for the trivial reason and would prove nothing about invalidation.
      const query = `/api/phone_calls/calls?q=${encodeURIComponent(externalCallId)}&pageSize=100`

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

      await bootstrapFromAppRoot(APP_ROOT)
      const container = await createRequestContainer()
      const commandBus = container.resolve('commandBus') as CommandBus

      const executed = await commandBus.execute<Record<string, unknown>, IngestResult>(
        INGEST_COMMAND_ID,
        {
          input: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            providerKey: 'tillio',
            externalCallId,
            direction: 'inbound',
            status: 'completed',
            participants: [],
            startedAt: new Date('2026-03-10T09:00:00Z'),
            rawPayload: { source: 'TC-PHONE-HUB-006' },
          },
          ctx: {
            container,
            auth: {
              sub: scope.userId,
              tenantId: scope.tenantId,
              orgId: scope.organizationId,
              isSuperAdmin: false,
            },
            organizationScope: {
              selectedId: scope.organizationId,
              filterIds: [scope.organizationId],
              allowedIds: [scope.organizationId],
              tenantId: scope.tenantId,
            },
            selectedOrganizationId: scope.organizationId,
            organizationIds: [scope.organizationId],
          },
        },
      )
      ingestedId = executed.result.phoneCallId
      expect(executed.result.created, 'the marker is run-unique, so this is an insert').toBe(true)

      const afterIngest = await read(request)
      expect(afterIngest.cache, 'the ingest must have dropped the cached page').toBe('miss')
      expect(afterIngest.ids, 'the freshly ingested call is listed').toEqual([externalCallId])
    } finally {
      await deletePhoneCallsIfExist([ingestedId])
    }
  })
})
