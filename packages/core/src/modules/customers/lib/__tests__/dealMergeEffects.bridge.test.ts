/** @jest-environment node */

import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob } from '@open-mercato/queue'
import { DefaultDataEngine } from '@open-mercato/shared/lib/data/engine'
import handle from '../../workers/deal-merge-effects'
import { markDealMergeEffects, type DealMergeEffectsJob } from '../dealMergeEffects'

const tenantId = 'tenant-1'
const organizationId = 'org-1'
const bridgedId = 'bridged-activity-id'
const survivorId = 'survivor-deal'

function buildJob(): DealMergeEffectsJob {
  return {
    tenantId,
    organizationId,
    moved: {
      activities: [{ id: bridgedId, payload: { dealId: survivorId } }],
      comments: [],
      interactions: [{ id: bridgedId, payload: { dealId: survivorId } }],
    },
  }
}

function buildEngine() {
  const emitEvent = jest.fn().mockResolvedValue(undefined)
  const container = {
    resolve: (token: string) => {
      if (token === 'eventBus') return { emitEvent }
      throw new Error(`[internal] unexpected resolve(${token})`)
    },
  } as unknown as AwilixContainer
  const engine = new DefaultDataEngine({} as EntityManager, container)
  const calls = () => emitEvent.mock.calls.map(([name, payload]) => ({ name: name as string, payload: payload as Record<string, unknown> }))
  return { engine, calls }
}

function expectBothRecordsUpdated(calls: Array<{ name: string; payload: Record<string, unknown> }>) {
  const activityEvents = calls.filter((call) => call.name === 'customers.activity.updated')
  const interactionEvents = calls.filter((call) => call.name === 'customers.interaction.updated')
  expect(activityEvents).toHaveLength(1)
  expect(interactionEvents).toHaveLength(1)
  expect(activityEvents[0].payload).toMatchObject({ id: bridgedId, dealId: survivorId, tenantId, organizationId })
  expect(interactionEvents[0].payload).toMatchObject({ id: bridgedId, dealId: survivorId, tenantId, organizationId })
  const upserts = calls.filter((call) => call.name === 'query_index.upsert_one').map((call) => call.payload)
  expect(upserts.map((payload) => payload.entityType).sort()).toEqual([
    'customers:customer_activity',
    'customers:customer_interaction',
  ])
  for (const payload of upserts) expect(payload).toMatchObject({ recordId: bridgedId, tenantId })
}

describe('deal merge effects for a bridged activity sharing its id with an interaction', () => {
  let warnSpy: jest.SpyInstance
  beforeAll(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined) })
  afterAll(() => { warnSpy.mockRestore() })

  it('updates both the activity and the interaction on the inline path', async () => {
    const { engine, calls } = buildEngine()

    markDealMergeEffects(engine, buildJob())
    await engine.flushOrmEntityChanges()

    expectBothRecordsUpdated(calls())
  })

  it('updates both the activity and the interaction on the worker path', async () => {
    const { engine, calls } = buildEngine()
    const job = { id: 'job-1', payload: buildJob(), createdAt: new Date().toISOString() } as QueuedJob<DealMergeEffectsJob>
    const context = { jobId: 'job-1', attemptNumber: 1, queueName: 'customers-deal-merge-effects' } as JobContext
    const em = {
      fork: () => em,
      execute: jest.fn(async (sql: string) => [{
        id: bridgedId,
        entity_id: null,
        deal_id: survivorId,
        ...(sql.includes('customer_interactions') ? { interaction_type: 'note', status: 'done', source: null } : {}),
        is_current: true,
      }]),
    }
    const resolve = <T,>(name: string) => (name === 'em' ? em : engine) as T

    await handle(job, { ...context, resolve })

    expectBothRecordsUpdated(calls())
  })
})
