import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { createModuleQueue, createQueue, resolveQueueStrategy, type Queue } from '@open-mercato/queue'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot'
import {
  createCompanyFixture,
  createDealFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import type { DealMergeEffectsJob } from '@open-mercato/core/modules/customers/lib/dealMergeEffects'

export const integrationMeta = { dependsOnModules: ['customers', 'auth', 'directory', 'query_index', 'webhooks'] }

/**
 * TC-CRM-DEAL-MERGE-EVENT-ORDER: a merge that moves more than INLINE_MOVED_EFFECT_LIMIT (32) records
 * hands its moved-record CRUD events to the `customers-deal-merge-effects` worker. When the same
 * interaction moves again before that worker drains, the late job must not publish the superseded
 * Deal link after the newer one.
 *
 * Scenario: merge A into B (32 comments + 1 interaction, deferred) and observe B from the original
 * job. Relink the interaction to D, then merge D into C inline and observe C. Replay the first
 * merge's interaction entry (the snapshot pointing at B and the version written by the first
 * merge). The webhook deliveries from before and after the replay are distinguishable by ID.
 *
 * Published CRUD events are observed through a webhook subscribed to `customers.interaction.updated`:
 * the webhooks module's persistent `*` subscriber records one delivery per published event, in
 * publish order, with the event payload. The last delivery for the interaction that carries a Deal
 * link must point at C, and no delivery created after C's must point anywhere else.
 *
 * The replay is asserted only once publishing has settled: the replayed job has completed (so every
 * event it emitted is already stored in the `events` queue), the `events` queue holds no waiting or
 * active job, its failed count did not grow, and the interaction's deliveries stayed identical over
 * EVENTS_SETTLE_STABLE_POLLS consecutive polls. A late B publish therefore has a delivery before the
 * assertion runs and cannot pass unnoticed.
 */

const APP_ROOT = resolveAppRoot()
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const DEALS_PATH = '/api/customers/deals'
const MERGE_PATH = '/api/customers/deals/merge'
const INTERACTIONS_PATH = '/api/customers/interactions'
const WEBHOOKS_PATH = '/api/webhooks'
const DELIVERIES_PATH = '/api/webhooks/deliveries'
const MERGE_EFFECTS_QUEUE = 'customers-deal-merge-effects'
const EVENTS_QUEUE = 'events'
const INTERACTION_UPDATED = 'customers.interaction.updated'
const DEFERRED_COMMENT_COUNT = 32
const EVENTS_SETTLE_STABLE_POLLS = 3
const EVENTS_SETTLE_POLL_INTERVAL_MS = 250
const EVENTS_SETTLE_TIMEOUT_MS = 30_000
const MOCK_INBOUND_TOKEN_HEADER = 'x-mock-webhook-token'
const MOCK_INBOUND_WEBHOOK_SECRET =
  process.env.MOCK_INBOUND_WEBHOOK_SECRET?.trim() || 'open-mercato-mock-dev-inbound-webhook-secret'

type MergeRecordPreview = { id: string; updatedAt: string; fields: Record<string, unknown> }
type MergePreview = { left: MergeRecordPreview; right: MergeRecordPreview }
type ItemPage = { items?: Array<Record<string, unknown>> }
type DeliveryPage = { items?: Array<{ id: string; createdAt: string }>; totalPages?: number }
type DeliveryDetail = { id: string; createdAt: string; payload?: { data?: Record<string, unknown> } }
type PublishedUpdate = { deliveryId: string; createdAt: number; dealId: string | null; carriesDeal: boolean }
type QueueCounts = Awaited<ReturnType<Queue<unknown>['getJobCounts']>>
type SettledUpdates = { updates: PublishedUpdate[]; eventsFailed: number }

type Fixture = {
  token: string
  companyId: string | null
  webhookId: string | null
  interactionId: string | null
  dealIds: Set<string>
  commentIds: string[]
}

async function loadMergePreview(request: APIRequestContext, token: string, leftId: string, rightId: string): Promise<MergePreview> {
  const response = await apiRequest(request, 'GET', `${MERGE_PATH}?${new URLSearchParams({ left: leftId, right: rightId })}`, { token })
  expect(response.status(), 'merge preview should load both Deals').toBe(200)
  const body = await readJsonSafe<MergePreview>(response)
  expect(body?.left.updatedAt).toBeTruthy()
  expect(body?.right.updatedAt).toBeTruthy()
  return body!
}

async function mergeDeals(request: APIRequestContext, token: string, survivorId: string, sourceId: string, title: string): Promise<void> {
  const preview = await loadMergePreview(request, token, survivorId, sourceId)
  const response = await apiRequest(request, 'POST', MERGE_PATH, {
    token,
    data: {
      survivorId,
      sourceId,
      survivorUpdatedAt: preview.left.updatedAt,
      sourceUpdatedAt: preview.right.updatedAt,
      values: { ...preview.left.fields, title },
      customFields: {},
      personIds: [],
      companyIds: [],
      primaryPersonEntityId: null,
    },
  })
  expect(response.status(), `merge ${sourceId} -> ${survivorId} returned ${response.status()}`).toBe(200)
}

async function createWebhook(request: APIRequestContext, token: string, stamp: string): Promise<string> {
  const response = await apiRequest(request, 'POST', WEBHOOKS_PATH, {
    token,
    data: {
      name: `QA deal merge event order ${stamp}`,
      description: 'TC-CRM-DEAL-MERGE-EVENT-ORDER observer',
      url: `${BASE_URL}/api/webhooks/inbound/mock_inbound`,
      subscribedEvents: [INTERACTION_UPDATED],
      httpMethod: 'POST',
      maxRetries: 3,
      timeoutMs: 5_000,
      rateLimitPerMinute: 0,
      autoDisableThreshold: 5,
      customHeaders: { [MOCK_INBOUND_TOKEN_HEADER]: MOCK_INBOUND_WEBHOOK_SECRET },
    },
  })
  expect(response.status(), `POST ${WEBHOOKS_PATH} returned ${response.status()}`).toBe(201)
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'webhook id')
}

async function readPublishedUpdates(
  request: APIRequestContext,
  token: string,
  webhookId: string,
  interactionId: string,
): Promise<PublishedUpdate[]> {
  const deliveryIds: string[] = []
  for (let page = 1; page <= 20; page += 1) {
    const query = new URLSearchParams({ webhookId, eventType: INTERACTION_UPDATED, page: String(page), pageSize: '100' })
    const response = await apiRequest(request, 'GET', `${DELIVERIES_PATH}?${query}`, { token })
    expect(response.status(), `GET ${DELIVERIES_PATH} returned ${response.status()}`).toBe(200)
    const body = await readJsonSafe<DeliveryPage>(response)
    deliveryIds.push(...(body?.items ?? []).map((item) => item.id))
    if (page >= (body?.totalPages ?? 1)) break
  }
  const updates: PublishedUpdate[] = []
  for (const deliveryId of deliveryIds) {
    const response = await apiRequest(request, 'GET', `${DELIVERIES_PATH}/${deliveryId}`, { token })
    expect(response.status(), `GET ${DELIVERIES_PATH}/${deliveryId} returned ${response.status()}`).toBe(200)
    const detail = await readJsonSafe<DeliveryDetail>(response)
    const data = detail?.payload?.data
    if (!data || data.id !== interactionId) continue
    const carriesDeal = Object.prototype.hasOwnProperty.call(data, 'dealId')
    updates.push({
      deliveryId,
      createdAt: Date.parse(String(detail?.createdAt)),
      dealId: typeof data.dealId === 'string' ? data.dealId : null,
      carriesDeal,
    })
  }
  return updates.sort((left, right) => left.createdAt - right.createdAt)
}

async function readInteractionVersion(interactionId: string): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ version: string }>(
      `select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as version
         from customer_interactions where id = $1`,
      [interactionId],
    )
    return expectId(result.rows[0]?.version, 'interaction version')
  })
}

async function waitForPublishedDeal(
  request: APIRequestContext,
  token: string,
  webhookId: string,
  interactionId: string,
  dealId: string,
): Promise<void> {
  await expect.poll(async () => {
    await drainIntegrationQueue(EVENTS_QUEUE, { appRoot: APP_ROOT })
    const updates = await readPublishedUpdates(request, token, webhookId, interactionId)
    return updates.filter((update) => update.carriesDeal).at(-1)?.dealId ?? null
  }, { message: 'the latest delivery for the interaction must show the merged Deal' }).toBe(dealId)
}

async function readProjectionDealId(recordId: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query<{ deal_id: string | null }>(
      `select doc->>'deal_id' as deal_id
         from entity_indexes
        where entity_type = 'customers:customer_interaction' and entity_id = $1 and deleted_at is null`,
      [recordId],
    )
    return result.rows[0]?.deal_id ?? null
  })
}

async function listInteractionIds(request: APIRequestContext, token: string, dealId: string): Promise<string[]> {
  const pathWithQuery = `${INTERACTIONS_PATH}?dealId=${dealId}&limit=100`
  const response = await apiRequest(request, 'GET', pathWithQuery, { token })
  expect(response.status(), `GET ${pathWithQuery} returned ${response.status()}`).toBe(200)
  const body = await readJsonSafe<ItemPage>(response)
  return (body?.items ?? []).map((item) => String(item.id))
}

function openIntegrationQueue<T>(queueName: string): Queue<T> {
  if (resolveQueueStrategy() === 'async') return createModuleQueue<T>(queueName)
  const baseDir = process.env.QUEUE_BASE_DIR?.trim() || path.resolve(APP_ROOT, '.mercato/queue')
  return createQueue<T>(queueName, 'local', { baseDir, concurrency: 1 })
}

async function replayFirstMergeJob(job: DealMergeEffectsJob): Promise<void> {
  const queue = openIntegrationQueue<DealMergeEffectsJob>(MERGE_EFFECTS_QUEUE)
  try {
    const { completed, failed } = await queue.getJobCounts()
    await queue.enqueue(job)
    await drainIntegrationQueue(MERGE_EFFECTS_QUEUE, { appRoot: APP_ROOT })
    await expect.poll(() => queue.getJobCounts(), {
      message: 'the delayed first-merge job must complete successfully',
    }).toMatchObject({ completed: completed + 1, failed, waiting: 0, active: 0 })
  } finally {
    await queue.close()
  }
}

async function readEventsQueueCounts(): Promise<QueueCounts> {
  const queue = openIntegrationQueue<unknown>(EVENTS_QUEUE)
  try {
    return await queue.getJobCounts()
  } finally {
    await queue.close()
  }
}

async function readSettledPublishedUpdates(
  request: APIRequestContext,
  token: string,
  webhookId: string,
  interactionId: string,
): Promise<SettledUpdates> {
  let previousSignature: string | null = null
  let stablePolls = 0
  let settled: SettledUpdates = { updates: [], eventsFailed: 0 }
  await expect.poll(async () => {
    await drainIntegrationQueue(EVENTS_QUEUE, { appRoot: APP_ROOT })
    const counts = await readEventsQueueCounts()
    const updates = await readPublishedUpdates(request, token, webhookId, interactionId)
    const idle = counts.waiting === 0 && counts.active === 0
    const signature = idle ? `${counts.failed}|${updates.map((update) => update.deliveryId).join(',')}` : null
    stablePolls = signature !== null && signature === previousSignature ? stablePolls + 1 : 0
    previousSignature = signature
    settled = { updates, eventsFailed: counts.failed }
    return stablePolls
  }, {
    message: 'the events queue must be idle and the interaction deliveries stable before the replay is asserted',
    intervals: [EVENTS_SETTLE_POLL_INTERVAL_MS],
    timeout: EVENTS_SETTLE_TIMEOUT_MS,
  }).toBeGreaterThanOrEqual(EVENTS_SETTLE_STABLE_POLLS)
  return settled
}

async function cleanupFixture(request: APIRequestContext, fixture: Fixture): Promise<void> {
  const { token } = fixture
  if (fixture.webhookId) {
    await apiRequest(request, 'DELETE', `${WEBHOOKS_PATH}/${fixture.webhookId}`, { token }).catch(() => undefined)
  }
  if (fixture.commentIds.length) {
    await withClient(async (client) => {
      await client.query('delete from customer_comments where id = any($1::uuid[])', [fixture.commentIds])
      await client.query(
        "delete from entity_indexes where entity_type = 'customers:customer_comment' and entity_id = any($1::text[])",
        [fixture.commentIds],
      )
    })
  }
  await deleteEntityIfExists(request, token, INTERACTIONS_PATH, fixture.interactionId)
  for (const id of fixture.dealIds) await deleteEntityIfExists(request, token, DEALS_PATH, id)
  await deleteEntityIfExists(request, token, '/api/customers/companies', fixture.companyId)
}

test.describe('TC-CRM-DEAL-MERGE-EVENT-ORDER: deferred effects skip links superseded before the worker reads them', () => {
  test('a delayed merge-effects job does not republish the interaction under the Deal it already left', async ({ request }) => {
    test.slow()
    const fixture: Fixture = {
      token: await getAuthToken(request, 'admin'),
      companyId: null,
      webhookId: null,
      interactionId: null,
      dealIds: new Set(),
      commentIds: [],
    }
    const { token } = fixture
    const { tenantId, organizationId } = getTokenContext(token)
    const stamp = randomUUID().slice(0, 8)
    try {
      const companyId = await createCompanyFixture(request, token, `QA merge event order company ${stamp}`)
      fixture.companyId = companyId
      const createDeal = async (label: string) => {
        const id = await createDealFixture(request, token, { title: `QA merge event order ${label} ${stamp}` })
        fixture.dealIds.add(id)
        return id
      }
      const dealA = await createDeal('A')
      const dealB = await createDeal('B')
      const dealC = await createDeal('C')
      const dealD = await createDeal('D')

      const interactionResponse = await apiRequest(request, 'POST', INTERACTIONS_PATH, {
        token,
        data: { entityId: companyId, interactionType: 'task', title: `QA merge event order ${stamp}`, status: 'planned', dealId: dealA },
      })
      expect(interactionResponse.status(), `POST ${INTERACTIONS_PATH} returned ${interactionResponse.status()}`).toBe(201)
      const interactionId = expectId((await readJsonSafe<{ id?: string }>(interactionResponse))?.id, 'interaction id')
      fixture.interactionId = interactionId
      const comments = await withClient((client) => client.query<{ id: string }>(
        `insert into customer_comments (tenant_id, organization_id, entity_id, deal_id, body, created_at, updated_at)
         select $1, $2, $3, $4, $5, now(), now() from generate_series(1, $6::integer)
         returning id`,
        [tenantId, organizationId, companyId, dealA, `QA merge event order comment ${stamp}`, DEFERRED_COMMENT_COUNT],
      ))
      fixture.commentIds = comments.rows.map((comment) => comment.id)

      fixture.webhookId = await createWebhook(request, token, stamp)
      const webhookId = fixture.webhookId

      await mergeDeals(request, token, dealB, dealA, `QA merge event order B ${stamp}`)
      fixture.dealIds.delete(dealA)
      const firstMergeVersion = await readInteractionVersion(interactionId)
      await drainIntegrationQueue(MERGE_EFFECTS_QUEUE, { appRoot: APP_ROOT })
      await waitForPublishedDeal(request, token, webhookId, interactionId, dealB)
      const firstMergeJob: DealMergeEffectsJob = {
        tenantId,
        organizationId,
        moved: {
          activities: [],
          comments: [],
          interactions: [{
            id: interactionId,
            payload: { entityId: companyId, interactionType: 'task', status: 'planned', source: null, dealId: dealB },
          }],
        },
        movedVersion: firstMergeVersion,
      }

      const relink = await apiRequest(request, 'PUT', INTERACTIONS_PATH, { token, data: { id: interactionId, dealId: dealD } })
      expect(relink.ok(), `relinking the interaction to D returned ${relink.status()}`).toBeTruthy()

      await mergeDeals(request, token, dealC, dealD, `QA merge event order C ${stamp}`)
      fixture.dealIds.delete(dealD)
      expect(await readInteractionVersion(interactionId)).not.toBe(firstMergeVersion)
      await waitForPublishedDeal(request, token, webhookId, interactionId, dealC)

      const deliveryIdsBeforeReplay = new Set(
        (await readPublishedUpdates(request, token, webhookId, interactionId)).map((update) => update.deliveryId),
      )
      const eventsFailedBeforeReplay = (await readEventsQueueCounts()).failed
      await replayFirstMergeJob(firstMergeJob)

      const { updates: finalUpdates, eventsFailed } = await readSettledPublishedUpdates(request, token, webhookId, interactionId)
      expect(eventsFailed, 'no event job may fail while the replay publishes').toBe(eventsFailedBeforeReplay)
      const lastWithDeal = finalUpdates.filter((update) => update.carriesDeal).at(-1)
      expect(lastWithDeal?.dealId, 'the last published Deal link for the interaction must be C').toBe(dealC)
      const afterC = finalUpdates.filter((update) => !deliveryIdsBeforeReplay.has(update.deliveryId) && update.carriesDeal)
      expect(afterC.map((update) => update.dealId).filter((dealId) => dealId !== dealC), 'no event may claim a superseded Deal after C').toEqual([])

      await expect.poll(() => readProjectionDealId(interactionId), {
        message: 'the interaction projection must point at C',
        timeout: 30_000,
      }).toBe(dealC)
      expect(await listInteractionIds(request, token, dealC)).toContain(interactionId)
      expect(await listInteractionIds(request, token, dealB)).not.toContain(interactionId)
    } finally {
      await cleanupFixture(request, fixture)
    }
  })
})
