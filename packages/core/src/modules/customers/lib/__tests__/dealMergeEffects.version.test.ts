/** @jest-environment node */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob } from '@open-mercato/queue'
import { createEventBus } from '@open-mercato/events'
import { DefaultDataEngine } from '@open-mercato/shared/lib/data/engine'
import handle from '../../workers/deal-merge-effects'
import { markDealMergeEffects, type DealMergeEffectsJob } from '../dealMergeEffects'

const tenantId = 'tenant-1'
const organizationId = 'org-1'
const companyId = 'company-1'
const activityId = 'activity-1'
const interactionId = 'interaction-1'
const commentId = 'comment-1'
const dealA = 'deal-a'
const dealB = 'deal-b'
const dealC = 'deal-c'
const firstMergeVersion = '2026-11-26T10:00:00.123456Z'
const secondMoveVersion = '2026-11-26T10:00:05.654321Z'

type StoredRow = {
  table: string
  id: string
  entity_id: string
  deal_id: string
  interaction_type?: string
  status?: string
  source?: string | null
  updated_at: string
  deleted: boolean
}

function buildStore(rows: StoredRow[]) {
  const calls: string[] = []
  const execute = jest.fn(async (sql: string, params: unknown[]) => {
    calls.push(sql)
    const table = /from (customer_\w+)/.exec(sql)?.[1]
    const versioned = sql.includes('updated_at = ?::timestamptz')
    const version = versioned ? String(params[0]) : null
    const [scopeTenant, scopeOrganization, idsJson] = params.slice(versioned ? 1 : 0)
    expect(scopeTenant).toBe(tenantId)
    expect(scopeOrganization).toBe(organizationId)
    const ids = JSON.parse(String(idsJson)) as string[]
    return rows
      .filter((row) => row.table === table && ids.includes(row.id) && !(row.deleted && sql.includes('deleted_at is null')))
      .map((row) => ({
        id: row.id,
        entity_id: row.entity_id,
        deal_id: row.deal_id,
        ...(row.table === 'customer_interactions'
          ? { interaction_type: row.interaction_type, status: row.status, source: row.source ?? null }
          : {}),
        is_current: version === null ? true : row.updated_at === version,
      }))
  })
  const em = {
    fork: () => em,
    execute,
    begin: jest.fn(async () => { calls.push('begin') }),
    commit: jest.fn(async () => { calls.push('commit') }),
    rollback: jest.fn(async () => { calls.push('rollback') }),
  }
  return { em, execute, calls }
}

function buildEngine(order?: string[], eventError?: Error) {
  const emitEvent = jest.fn(async (name: string, _payload: unknown, options?: { persistent?: boolean }) => {
    order?.push(name)
    if (eventError && name.startsWith('customers.') && options?.persistent === true) throw eventError
  })
  const container = {
    resolve: (token: string) => {
      if (token === 'eventBus') return { emitEvent }
      throw new Error(`[internal] unexpected resolve(${token})`)
    },
  } as unknown as AwilixContainer
  const engine = new DefaultDataEngine({} as EntityManager, container)
  const calls = () => emitEvent.mock.calls.map(([name, payload, options]) => ({
    name: name as string,
    payload: payload as Record<string, unknown>,
    options: options as { persistent?: boolean },
  }))
  return { engine, calls }
}

function firstMergeJob(movedVersion?: string): DealMergeEffectsJob {
  return {
    tenantId,
    organizationId,
    moved: {
      activities: [],
      comments: [{ id: commentId, payload: { entityId: companyId, dealId: dealB } }],
      interactions: [{
        id: interactionId,
        payload: { entityId: companyId, interactionType: 'call', status: 'done', source: null, dealId: dealB },
      }],
    },
    ...(movedVersion === undefined ? {} : { movedVersion }),
  }
}

async function runWorker(engine: DefaultDataEngine, em: { fork: () => unknown }, payload: DealMergeEffectsJob) {
  const job = { id: 'job-1', payload, createdAt: new Date().toISOString() } as QueuedJob<DealMergeEffectsJob>
  const context = { jobId: 'job-1', attemptNumber: 1, queueName: 'customers-deal-merge-effects' } as JobContext
  const resolve = <T,>(name: string) => (name === 'em' ? em : engine) as T
  await handle(job, { ...context, resolve })
}

function interactionRow(dealId: string, updatedAt: string): StoredRow {
  return {
    table: 'customer_interactions',
    id: interactionId,
    entity_id: companyId,
    deal_id: dealId,
    interaction_type: 'call',
    status: 'done',
    source: null,
    updated_at: updatedAt,
    deleted: false,
  }
}

function commentRow(dealId: string, updatedAt: string): StoredRow {
  return { table: 'customer_comments', id: commentId, entity_id: companyId, deal_id: dealId, updated_at: updatedAt, deleted: false }
}

function interactionEvents(calls: Array<{ name: string; payload: Record<string, unknown>; options?: { persistent?: boolean } }>) {
  return calls.filter((call) => call.name === 'customers.interaction.updated'
    && call.payload.id === interactionId
    && call.options?.persistent === true)
}

function upsertsFor(calls: Array<{ name: string; payload: Record<string, unknown> }>, entityType: string, recordId: string) {
  return calls.filter((call) => call.name === 'query_index.upsert_one'
    && call.payload.entityType === entityType && call.payload.recordId === recordId)
}

describe('deferred deal merge effects carry the moved version', () => {
  let warnSpy: jest.SpyInstance
  beforeAll(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined) })
  afterAll(() => { warnSpy.mockRestore() })

  it('suppresses the superseded event when a later move published first, so the last published Deal is C', async () => {
    const { engine, calls } = buildEngine()
    const { em } = buildStore([interactionRow(dealC, secondMoveVersion), commentRow(dealB, firstMergeVersion)])

    markDealMergeEffects(engine, {
      tenantId,
      organizationId,
      moved: {
        activities: [],
        comments: [],
        interactions: [{ id: interactionId, payload: { entityId: companyId, interactionType: 'call', status: 'done', source: null, dealId: dealC } }],
      },
      movedVersion: secondMoveVersion,
    })
    await engine.flushOrmEntityChanges()
    await runWorker(engine, em, firstMergeJob(firstMergeVersion))

    const published = interactionEvents(calls())
    expect(published).toHaveLength(1)
    expect(published.at(-1)?.payload).toMatchObject({ id: interactionId, dealId: dealC })
    expect(published.some((call) => call.payload.dealId === dealB)).toBe(false)
    expect(upsertsFor(calls(), 'customers:customer_interaction', interactionId)).toHaveLength(2)
  })

  it('refreshes the query index for a superseded record without publishing its CRUD event', async () => {
    const { engine, calls } = buildEngine()
    const { em } = buildStore([interactionRow(dealC, secondMoveVersion), commentRow(dealB, firstMergeVersion)])

    await runWorker(engine, em, firstMergeJob(firstMergeVersion))

    expect(interactionEvents(calls())).toEqual([])
    expect(upsertsFor(calls(), 'customers:customer_interaction', interactionId)).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ tenantId, organizationId, crudAction: 'updated' }) }),
    ])
    const commentEvents = calls().filter((call) => call.name === 'customers.comment.updated' && call.options.persistent === true)
    expect(commentEvents).toHaveLength(1)
    expect(commentEvents[0].payload).toMatchObject({ id: commentId, dealId: dealB, entityId: companyId, tenantId, organizationId })
  })

  it('publishes the current row, not the queued snapshot, when the version still matches', async () => {
    const { engine, calls } = buildEngine()
    const current = { ...interactionRow(dealB, firstMergeVersion), status: 'planned', source: 'manual' }
    const { em, execute } = buildStore([current])

    await runWorker(engine, em, firstMergeJob(firstMergeVersion))

    const published = interactionEvents(calls())
    expect(published).toHaveLength(1)
    expect(published[0].payload).toMatchObject({
      id: interactionId,
      dealId: dealB,
      status: 'planned',
      source: 'manual',
      tenantId,
      organizationId,
    })
    expect(upsertsFor(calls(), 'customers:customer_interaction', interactionId)).toHaveLength(1)
    for (const [sql, params] of execute.mock.calls.filter(([sql]) => sql.includes('is_current'))) {
      expect(sql).toContain('tenant_id = ? and organization_id = ?')
      expect(params[0]).toBe(firstMergeVersion)
    }
  })

  it('locks moved rows in table and id order before publishing, then commits before reindexing', async () => {
    const activity = {
      table: 'customer_activities',
      id: activityId,
      entity_id: companyId,
      deal_id: dealB,
      updated_at: firstMergeVersion,
      deleted: false,
    }
    const { em, calls } = buildStore([interactionRow(dealB, firstMergeVersion), activity, commentRow(dealB, firstMergeVersion)])
    const { engine } = buildEngine(calls)

    const payload = firstMergeJob(firstMergeVersion)
    payload.moved.activities.push({ id: activityId, payload: { entityId: companyId, dealId: dealB } })
    await runWorker(engine, em, payload)

    const beginIndex = calls.indexOf('begin')
    const locks = calls.filter((call) => call.includes('for update'))
    expect(locks).toHaveLength(3)
    expect(locks[0]).toContain('from customer_interactions')
    expect(locks[1]).toContain('from customer_activities')
    expect(locks[2]).toContain('from customer_comments')
    for (const sql of locks) {
      expect(sql).toContain('tenant_id = ? and organization_id = ?')
      expect(sql).toContain('order by id for update')
    }
    const interactionLockIndex = calls.indexOf(locks[0])
    const activityLockIndex = calls.indexOf(locks[1])
    const commentLockIndex = calls.indexOf(locks[2])
    const versionReadIndex = calls.findIndex((call) => call.includes('is_current'))
    const emitIndex = calls.indexOf('customers.interaction.updated')
    const commitIndex = calls.indexOf('commit')
    const indexUpsertIndex = calls.indexOf('query_index.upsert_one')
    expect(beginIndex).toBeLessThan(interactionLockIndex)
    expect(interactionLockIndex).toBeLessThan(activityLockIndex)
    expect(activityLockIndex).toBeLessThan(commentLockIndex)
    expect(commentLockIndex).toBeLessThan(versionReadIndex)
    expect(versionReadIndex).toBeLessThan(emitIndex)
    expect(emitIndex).toBeLessThan(commitIndex)
    expect(commitIndex).toBeLessThan(indexUpsertIndex)
  })

  it('rolls back when publication fails while the row locks are held', async () => {
    const { engine } = buildEngine(undefined, new Error('publish failed'))
    const { em } = buildStore([interactionRow(dealB, firstMergeVersion)])

    await expect(runWorker(engine, em, firstMergeJob(firstMergeVersion))).rejects.toThrow('publish failed')

    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
  })

  it('durably enqueues before commit without awaiting inline subscribers under the row lock', async () => {
    const originalCwd = process.cwd()
    const originalSingleDelivery = process.env.OM_EVENTS_SINGLE_DELIVERY
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deal-merge-event-lock-'))
    process.chdir(tmp)
    process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'

    let releaseSubscriber!: () => void
    let reportSubscriberStarted!: () => void
    const subscriberRelease = new Promise<void>((resolve) => { releaseSubscriber = resolve })
    const subscriberStarted = new Promise<void>((resolve) => { reportSubscriberStarted = resolve })
    const bus = createEventBus({ resolve: ((name: string) => name) as never, queueStrategy: 'local' })
    bus.on('customers.interaction.updated', async () => {
      reportSubscriberStarted()
      await subscriberRelease
    }, { id: 'test:inline', persistent: false })
    const container = {
      resolve: (token: string) => {
        if (token === 'eventBus') return bus
        throw new Error(`[internal] unexpected resolve(${token})`)
      },
    } as unknown as AwilixContainer
    const engine = new DefaultDataEngine({} as EntityManager, container)
    const { em } = buildStore([interactionRow(dealB, firstMergeVersion)])
    let worker: Promise<void> | undefined

    try {
      worker = runWorker(engine, em, firstMergeJob(firstMergeVersion))
      await subscriberStarted

      expect(em.commit).toHaveBeenCalledTimes(1)
      const queuePath = path.join(tmp, '.mercato/queue/events/queue.json')
      const queued = JSON.parse(fs.readFileSync(queuePath, 'utf8')) as Array<{ payload?: { event?: string } }>
      expect(queued.some((entry) => entry.payload?.event === 'customers.interaction.updated')).toBe(true)
    } finally {
      releaseSubscriber()
      await worker
      process.chdir(originalCwd)
      if (originalSingleDelivery === undefined) delete process.env.OM_EVENTS_SINGLE_DELIVERY
      else process.env.OM_EVENTS_SINGLE_DELIVERY = originalSingleDelivery
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('bounds each locking transaction to one hundred records', async () => {
    const records = Array.from({ length: 250 }, (_, index) => ({
      id: `interaction-${index}`,
      payload: { entityId: companyId, interactionType: 'call', status: 'done', source: null, dealId: dealB },
    }))
    const rows = records.map((record) => ({ ...interactionRow(dealB, firstMergeVersion), id: record.id }))
    const { engine } = buildEngine()
    const { em, execute } = buildStore(rows)

    await runWorker(engine, em, {
      tenantId,
      organizationId,
      moved: { activities: [], comments: [], interactions: records },
      movedVersion: firstMergeVersion,
    })

    expect(em.begin).toHaveBeenCalledTimes(3)
    expect(em.commit).toHaveBeenCalledTimes(3)
    const lockCalls = execute.mock.calls.filter(([sql]) => sql.includes('for update'))
    expect(lockCalls).toHaveLength(3)
    expect(JSON.parse(String(lockCalls[0][1][2]))).toHaveLength(100)
    expect(JSON.parse(String(lockCalls[1][1][2]))).toHaveLength(100)
    expect(JSON.parse(String(lockCalls[2][1][2]))).toHaveLength(50)
  })

  it('never publishes the stale snapshot of a legacy job without a version', async () => {
    const { engine, calls } = buildEngine()
    const { em, execute } = buildStore([interactionRow(dealC, secondMoveVersion), commentRow(dealB, firstMergeVersion)])

    await runWorker(engine, em, firstMergeJob())

    const published = interactionEvents(calls())
    expect(published.every((call) => call.payload.dealId === dealC)).toBe(true)
    expect(published.some((call) => call.payload.dealId === dealB)).toBe(false)
    expect(upsertsFor(calls(), 'customers:customer_interaction', interactionId)).toHaveLength(1)
    for (const [sql] of execute.mock.calls) expect(sql).not.toContain('updated_at = ?')
  })

  it('skips records deleted after the merge and stays idempotent across a retried job', async () => {
    const { engine, calls } = buildEngine()
    const { em } = buildStore([{ ...interactionRow(dealB, firstMergeVersion), deleted: true }, commentRow(dealB, firstMergeVersion)])

    await runWorker(engine, em, firstMergeJob(firstMergeVersion))
    await runWorker(engine, em, firstMergeJob(firstMergeVersion))

    expect(interactionEvents(calls())).toEqual([])
    expect(upsertsFor(calls(), 'customers:customer_interaction', interactionId)).toEqual([])
    const commentEvents = calls().filter((call) => call.name === 'customers.comment.updated' && call.options.persistent === true)
    expect(commentEvents.map((call) => call.payload.dealId)).toEqual([dealB, dealB])
  })
})
