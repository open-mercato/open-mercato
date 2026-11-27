import path from 'node:path'
import { readFile } from 'node:fs/promises'
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
import { withClient, type IntegrationDbClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import type { DealMergeEffectsJob } from '@open-mercato/core/modules/customers/lib/dealMergeEffects'

export const integrationMeta = { dependsOnModules: ['customers', 'auth', 'directory', 'query_index', 'webhooks'] }

/**
 * TC-CRM-DEAL-MERGE-EVENT-ORDER: a merge that moves more than INLINE_MOVED_EFFECT_LIMIT (32) records
 * hands its moved-record CRUD events to the `customers-deal-merge-effects` worker. When the same
 * interaction moves again while that worker drains, publication must preserve per-record write order.
 *
 * Scenario: merge A into B (32 comments + 1 interaction, deferred) and observe B from the original
 * job. Hold an ACCESS EXCLUSIVE lock on comments, replay the first job, and wait until the worker
 * has locked the interaction row before it blocks on comments. A relink to D must then wait for the
 * worker to publish B and release its row lock.
 *
 * Publication order is the order of jobs in the durable `events` queue. The worker enqueues B while
 * it holds the interaction row lock and runs no persistent subscriber in that window, so B must be
 * queued before the edit can enqueue its own event. The integration runtime delivers persistent
 * subscribers inline in the emitting request (`OM_EVENTS_SINGLE_DELIVERY=false`), so the edit's
 * webhook delivery is written by the API request while B's is written by the events worker; webhook
 * delivery timestamps therefore do not reflect publication order. Before the comments lock is
 * released the test takes a SHARE lock on `webhook_deliveries`. Every persistent webhook dispatch,
 * inline or queued, then waits on that lock, so neither B's queued job nor a not-yet-dispatched edit
 * event can leave or bypass the queue while it is inspected. With the lock held the merge-effects job
 * must still complete (no persistent subscriber may be awaited under its row locks), B must be in
 * the queue, and an edit event, if already queued, must follow it. A worker that publishes only after
 * commit, or that awaits inline persistent subscribers under its row locks, cannot queue B there.
 *
 * Webhook deliveries are asserted only once publishing has settled: the `events` queue holds no
 * waiting or active job, its failed count did not grow, and the interaction's deliveries stayed
 * identical over EVENTS_SETTLE_STABLE_POLLS consecutive polls. Both the replayed B delivery and the
 * edit delivery must then be recorded.
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
const DATABASE_WAIT_TIMEOUT_MS = 15_000
const DATABASE_POLL_INTERVAL_MS = 100
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
type QueuedUpdate = { jobId: string; carriesDeal: boolean; dealId: string | null }
type StoredEventJob = { id: string; payload?: { event?: string; payload?: Record<string, unknown> } }

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

async function enqueueFirstMergeJob(job: DealMergeEffectsJob): Promise<{ completed: number; failed: number }> {
  const queue = openIntegrationQueue<DealMergeEffectsJob>(MERGE_EFFECTS_QUEUE)
  try {
    const { completed, failed } = await queue.getJobCounts()
    await queue.enqueue(job)
    return { completed: completed + 1, failed }
  } finally {
    await queue.close()
  }
}

async function waitForMergeEffectsCompletion(expected: { completed: number; failed: number }): Promise<void> {
  const queue = openIntegrationQueue<DealMergeEffectsJob>(MERGE_EFFECTS_QUEUE)
  try {
    await expect.poll(() => queue.getJobCounts(), {
      message: 'the delayed first-merge job must complete successfully',
    }).toMatchObject({ ...expected, waiting: 0, active: 0 })
  } finally {
    await queue.close()
  }
}

async function waitUntil<T>(description: string, probe: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + DATABASE_WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const result = await probe()
    if (result !== null) return result
    await new Promise((resolve) => setTimeout(resolve, DATABASE_POLL_INTERVAL_MS))
  }
  throw new Error(`[internal] Timed out waiting until ${description}`)
}

async function waitForWorkerBlockedByComments(blockerPid: number): Promise<number> {
  return waitUntil('the merge-effects worker waits for comments after reading the interaction', () =>
    withClient(async (client) => {
      const result = await client.query<{ pid: number }>(
        `select activity.pid
           from pg_stat_activity activity
          where $1 = any(pg_blocking_pids(activity.pid))
            and activity.query like '%customer_comments%'`,
        [blockerPid],
      )
      return result.rows[0]?.pid ?? null
    }))
}

async function waitForEditBlockedByWorker(workerPid: number): Promise<number> {
  return waitUntil('the interaction edit waits for the merge-effects worker', () =>
    withClient(async (client) => {
      const result = await client.query<{ pid: number; waits_for_comments: boolean }>(
        `select activity.pid,
                exists (
                  select 1 from pg_locks waiting
                   where waiting.pid = activity.pid
                     and not waiting.granted
                     and waiting.relation = 'customer_comments'::regclass
                ) as waits_for_comments
           from pg_stat_activity activity
          where $1 = any(pg_blocking_pids(activity.pid))`,
        [workerPid],
      )
      const row = result.rows[0]
      if (row) {
        expect(row.waits_for_comments, 'the edit must wait on the worker row lock, not the comments table').toBe(false)
      }
      return row?.pid ?? null
    }))
}

async function releasePause(blocker: IntegrationDbClient, paused: boolean): Promise<void> {
  if (paused) await blocker.query('rollback')
}

async function readEventsQueueCounts(): Promise<QueueCounts> {
  const queue = openIntegrationQueue<unknown>(EVENTS_QUEUE)
  try {
    return await queue.getJobCounts()
  } finally {
    await queue.close()
  }
}

async function readQueuedInteractionUpdates(interactionId: string): Promise<QueuedUpdate[]> {
  const baseDir = process.env.QUEUE_BASE_DIR?.trim() || path.resolve(APP_ROOT, '.mercato/queue')
  const raw = await readFile(path.join(baseDir, EVENTS_QUEUE, 'queue.json'), 'utf8')
  const jobs = JSON.parse(raw) as StoredEventJob[]
  return jobs.flatMap((job) => {
    const data = job.payload?.payload
    if (job.payload?.event !== INTERACTION_UPDATED || !data || data.id !== interactionId) return []
    return [{
      jobId: job.id,
      carriesDeal: Object.prototype.hasOwnProperty.call(data, 'dealId'),
      dealId: typeof data.dealId === 'string' ? data.dealId : null,
    }]
  })
}

async function countDeliveryInsertsWaiting(deliveryBlockerPid: number): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ waiting: string }>(
      `select count(*) as waiting
         from pg_stat_activity activity
        where $1 = any(pg_blocking_pids(activity.pid))`,
      [deliveryBlockerPid],
    )
    return Number(result.rows[0]?.waiting ?? 0)
  })
}

async function readDurablePublicationOrder(
  deliveryBlockerPid: number,
  interactionId: string,
): Promise<QueuedUpdate[]> {
  return waitUntil('the replayed event is queued and the edit has queued or awaits webhook dispatch', async () => {
    const queued = await readQueuedInteractionUpdates(interactionId)
    const editQueued = queued.some((update) => !update.carriesDeal)
    const editAwaitsDispatch = (await countDeliveryInsertsWaiting(deliveryBlockerPid)) >= 2
    return editQueued || editAwaitsDispatch ? queued : null
  })
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

test.describe('TC-CRM-DEAL-MERGE-EVENT-ORDER: deferred effects preserve per-record publication order', () => {
  test.describe.configure({ mode: 'serial' })

  test('an edit waits while the worker validates and publishes the preceding merge', async ({ request }, testInfo) => {
    expect(
      testInfo.config.workers,
      'customer_comments is locked table-wide, so this spec requires a single Playwright worker',
    ).toBe(1)
    test.skip(resolveQueueStrategy() === 'async', 'publication order is read from the local events queue file')
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
          comments: fixture.commentIds.map((id) => ({ id, payload: { entityId: companyId, dealId: dealB } })),
          interactions: [{
            id: interactionId,
            payload: { entityId: companyId, interactionType: 'task', status: 'planned', source: null, dealId: dealB },
          }],
        },
        movedVersion: firstMergeVersion,
      }

      const deliveryIdsBeforeReplay = new Set(
        (await readPublishedUpdates(request, token, webhookId, interactionId)).map((update) => update.deliveryId),
      )
      const eventsFailedBeforeReplay = (await readEventsQueueCounts()).failed
      let editSettled = false
      const editResponse = await withClient(async (blocker) => {
        await blocker.query('begin')
        let paused = true
        const inFlight: Promise<unknown>[] = []
        try {
          await blocker.query("set local lock_timeout = '10s'")
          const blockerPid = (await blocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid
          await blocker.query('lock table customer_comments in access exclusive mode')
          const expectedCounts = await enqueueFirstMergeJob(firstMergeJob)
          const drain = drainIntegrationQueue(MERGE_EFFECTS_QUEUE, { appRoot: APP_ROOT })
          inFlight.push(drain)
          const workerPid = await waitForWorkerBlockedByComments(blockerPid)

          const edit = apiRequest(request, 'PUT', INTERACTIONS_PATH, {
            token,
            data: { id: interactionId, dealId: dealD },
          }).finally(() => { editSettled = true })
          inFlight.push(edit)
          await waitForEditBlockedByWorker(workerPid)
          expect(editSettled, 'the edit must remain in flight while the worker owns the interaction row').toBe(false)

          await withClient(async (deliveryBlocker) => {
            await deliveryBlocker.query('begin')
            try {
              await deliveryBlocker.query("set local lock_timeout = '10s'")
              const deliveryBlockerPid = (await deliveryBlocker.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid
              await deliveryBlocker.query('lock table webhook_deliveries in share mode')
              await releasePause(blocker, paused)
              paused = false
              await drain
              await waitForMergeEffectsCompletion(expectedCounts)
              const queued = await readDurablePublicationOrder(deliveryBlockerPid, interactionId)
              const queuedMergeIndex = queued.findIndex((update) => update.carriesDeal && update.dealId === dealB)
              const queuedEditIndex = queued.findIndex((update) => !update.carriesDeal)
              expect(queuedMergeIndex, 'the replayed B event must be durably queued before any webhook dispatch runs').toBeGreaterThanOrEqual(0)
              if (queuedEditIndex >= 0) {
                expect(queuedEditIndex, 'the edit event must be queued after the replayed B event').toBeGreaterThan(queuedMergeIndex)
              }
              expect(
                queued.slice(queuedMergeIndex + 1).some((update) => update.carriesDeal && update.dealId === dealB),
                'no superseded B event may be queued after the replayed one',
              ).toBe(false)
            } finally {
              await deliveryBlocker.query('rollback')
            }
          })
          return await edit
        } finally {
          await releasePause(blocker, paused)
          await Promise.allSettled(inFlight)
        }
      })
      expect(editResponse.status(), `relinking the interaction to D returned ${editResponse.status()}`).toBe(200)
      expect(await readInteractionVersion(interactionId)).not.toBe(firstMergeVersion)

      const { updates: finalUpdates, eventsFailed } = await readSettledPublishedUpdates(request, token, webhookId, interactionId)
      expect(eventsFailed, 'no event job may fail while the replay publishes').toBe(eventsFailedBeforeReplay)
      const replayUpdates = finalUpdates.filter((update) => !deliveryIdsBeforeReplay.has(update.deliveryId))
      const replayedMergeIndex = replayUpdates.findIndex((update) => update.carriesDeal && update.dealId === dealB)
      const editIndex = replayUpdates.findIndex((update) => !update.carriesDeal)
      expect(replayedMergeIndex, 'the replayed B delivery must be recorded').toBeGreaterThanOrEqual(0)
      expect(editIndex, 'the later edit delivery must be recorded').toBeGreaterThanOrEqual(0)
      expect(
        replayUpdates.filter((update) => update.carriesDeal && update.dealId === dealB),
        'the replay must publish B exactly once',
      ).toHaveLength(1)

      await expect.poll(() => readProjectionDealId(interactionId), {
        message: 'the interaction projection must point at D',
        timeout: 30_000,
      }).toBe(dealD)
      expect(await listInteractionIds(request, token, dealD)).toContain(interactionId)
      expect(await listInteractionIds(request, token, dealB)).not.toContain(interactionId)
    } finally {
      await cleanupFixture(request, fixture)
    }
  })
})
