import { randomUUID } from 'node:crypto'
import {
  createCampaignCommand,
  saveCampaignGraphCommand,
  setCampaignEnabledCommand,
  deleteCampaignCommand,
} from '../campaigns'
import { MarketingCampaign, MarketingCampaignTrigger } from '../../data/entities'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'

/**
 * M8: every command here used to provide only `execute`. None had `buildLog`/`undo`, so a created,
 * deleted, enabled/disabled or rewritten campaign could not be undone through the platform's command
 * audit log — the best-effort revisions table covers graph edits only, and it has no restore entrypoint.
 *
 * A compact in-memory store drives the real handlers end to end: create a row, find it, write it back —
 * everything these commands actually call, without a database.
 */
type Row = Record<string, unknown>

function fakeEm() {
  const campaigns = new Map<string, Row>()
  const triggers = new Map<string, Row>()
  const tables = new Map<unknown, Map<string, Row>>([
    [MarketingCampaign, campaigns],
    [MarketingCampaignTrigger, triggers],
  ])

  // Anything this file does not care about (revisions, runs, …) gets its own table rather than
  // falling into `triggers` by accident, which silently inflated that count in an earlier draft.
  const tableFor = (Entity: unknown): Map<string, Row> => {
    let table = tables.get(Entity)
    if (!table) { table = new Map<string, Row>(); tables.set(Entity, table) }
    return table
  }

  function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === null) return row[key] == null
      if (value && typeof value === 'object' && 'getTime' in (value as object)) return row[key] === value
      return row[key] === value
    })
  }

  const em: Record<string, unknown> = {
    fork: () => em,
    create: (Entity: unknown, data: Row) => {
      const id = (data.id as string | undefined) ?? randomUUID()
      const row: Row = { id, ...data }
      tableFor(Entity).set(id, row)
      return row
    },
    persist: () => {},
    remove: (row: Row & { id: string }) => { campaigns.delete(row.id) },
    findOne: async (Entity: unknown, where: Row) => {
      for (const row of tableFor(Entity).values()) if (matches(row, where)) return row
      return null
    },
    find: async (Entity: unknown, where: Row) => [...tableFor(Entity).values()].filter((row) => matches(row, where)),
    count: async (Entity: unknown, where: Row) => [...tableFor(Entity).values()].filter((row) => matches(row, where)).length,
    nativeUpdate: async (Entity: unknown, where: Row, data: Row) => {
      let count = 0
      for (const row of tableFor(Entity).values()) {
        if (matches(row, where)) { Object.assign(row, data); count += 1 }
      }
      return count
    },
    nativeDelete: async (Entity: unknown, where: Row) => {
      let count = 0
      for (const [id, row] of [...tableFor(Entity).entries()]) {
        if (matches(row, where)) { tableFor(Entity).delete(id); count += 1 }
      }
      return count
    },
    transactional: async (cb: (tx: unknown) => Promise<void>) => { await cb(em) },
    flush: async () => {},
  }
  return { em, campaigns, triggers }
}

function fakeCtx(em: unknown): CommandRuntimeContext {
  const container = {
    resolve: (key: string) => {
      if (key === 'em') return em
      throw new Error(`no such service: ${key}`)
    },
  }
  return {
    auth: { tenantId: 't1', orgId: 'o1' },
    container,
    request: null,
  } as unknown as CommandRuntimeContext
}

async function buildLogFor(
  handler: { buildLog?: (args: unknown) => unknown },
  args: { input: unknown; result: unknown; ctx: CommandRuntimeContext; snapshots: { before?: unknown; after?: unknown } },
) {
  return handler.buildLog!(args) as Promise<{ payload: { undo: unknown }; resourceId: string } | null>
}

describe('create_campaign undo/redo', () => {
  it('undo soft-deletes the created campaign, redo restores it live', async () => {
    const { em, campaigns } = fakeEm()
    const ctx = fakeCtx(em)
    const result = await createCampaignCommand.execute({ name: 'Welcome series' }, ctx)

    const after = await createCampaignCommand.captureAfter!({ name: 'Welcome series' }, result, ctx)
    const logEntry = await buildLogFor(createCampaignCommand, {
      input: { name: 'Welcome series' }, result, ctx, snapshots: { after },
    })
    expect(logEntry?.resourceId).toBe(result.id)

    await createCampaignCommand.undo!({ input: { name: 'Welcome series' }, ctx, logEntry: { ...logEntry, resourceId: result.id } as never })
    expect(campaigns.get(result.id)).toMatchObject({ deletedAt: expect.any(Date), isEnabled: false })

    const redone = await createCampaignCommand.redo!({ input: { name: 'Welcome series' }, ctx, logEntry: logEntry as never })
    expect(redone).toEqual({ id: result.id })
    expect(campaigns.get(result.id)).toMatchObject({ deletedAt: null, name: 'Welcome series' })
  })
})

describe('delete_campaign undo', () => {
  it('restores the campaign and its triggers exactly as they were', async () => {
    const { em, campaigns, triggers } = fakeEm()
    const ctx = fakeCtx(em)
    const campaign = em.create(MarketingCampaign, {
      tenantId: 't1', organizationId: 'o1', name: 'Win-back', description: null,
      isEnabled: true, definition: { version: 1, steps: [] }, breakerResetAt: null, breakerTrippedAt: null,
      createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
    }) as Row
    em.create(MarketingCampaignTrigger, {
      campaignId: campaign.id, tenantId: 't1', organizationId: 'o1', kind: 'event',
      eventId: 'sales.order.created', scheduleValue: null, reentryAfterDays: null,
      sweepSource: null, sweepParams: null, lastSweptAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    })

    const before = await deleteCampaignCommand.prepare!({ id: campaign.id as string }, ctx)
    const result = await deleteCampaignCommand.execute({ id: campaign.id as string }, ctx)
    expect(triggers.size).toBe(0)
    expect(campaigns.get(result.id)).toMatchObject({ deletedAt: expect.any(Date) })

    const logEntry = await buildLogFor(deleteCampaignCommand, {
      input: { id: campaign.id }, result, ctx, snapshots: before as { before?: unknown },
    })

    await deleteCampaignCommand.undo!({ input: { id: campaign.id as string }, ctx, logEntry: logEntry as never })
    expect(campaigns.get(result.id)).toMatchObject({ deletedAt: null, name: 'Win-back', isEnabled: true })
    expect(triggers.size).toBe(1)
    expect([...triggers.values()][0]).toMatchObject({ campaignId: campaign.id, eventId: 'sales.order.created' })
  })
})

describe('set_campaign_enabled undo', () => {
  it('flips isEnabled and the breaker reset stamp back', async () => {
    const { em, campaigns } = fakeEm()
    const ctx = fakeCtx(em)
    const campaign = em.create(MarketingCampaign, {
      tenantId: 't1', organizationId: 'o1', name: 'Reminder', description: null,
      isEnabled: false, definition: { version: 1, steps: [{ id: 's1', type: 'wait', params: { days: 1 } }] },
      breakerResetAt: null, breakerTrippedAt: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
    }) as Row
    em.create(MarketingCampaignTrigger, {
      campaignId: campaign.id, tenantId: 't1', organizationId: 'o1', kind: 'event', eventId: 'sales.order.created',
      scheduleValue: null, reentryAfterDays: null, sweepSource: null, sweepParams: null, lastSweptAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    })

    const before = await setCampaignEnabledCommand.prepare!({ id: campaign.id as string, isEnabled: true }, ctx)
    const result = await setCampaignEnabledCommand.execute({ id: campaign.id as string, isEnabled: true }, ctx)
    expect(campaigns.get(result.id)).toMatchObject({ isEnabled: true, breakerResetAt: expect.any(Date) })

    const logEntry = await buildLogFor(setCampaignEnabledCommand, {
      input: { id: campaign.id, isEnabled: true }, result, ctx, snapshots: before as { before?: unknown },
    })

    await setCampaignEnabledCommand.undo!({ input: { id: campaign.id as string, isEnabled: true }, ctx, logEntry: logEntry as never })
    expect(campaigns.get(result.id)).toMatchObject({ isEnabled: false, breakerResetAt: null })
  })
})

describe('save_campaign_graph undo', () => {
  it('restores the previous definition and triggers', async () => {
    const { em, campaigns, triggers } = fakeEm()
    const ctx = fakeCtx(em)
    const campaign = em.create(MarketingCampaign, {
      tenantId: 't1', organizationId: 'o1', name: 'Original name', description: null, isEnabled: false,
      definition: { version: 1, steps: [] }, breakerResetAt: null, breakerTrippedAt: null,
      createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
    }) as Row
    em.create(MarketingCampaignTrigger, {
      campaignId: campaign.id, tenantId: 't1', organizationId: 'o1', kind: 'event', eventId: 'sales.order.created',
      scheduleValue: null, reentryAfterDays: null, sweepSource: null, sweepParams: null, lastSweptAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    })

    const saveInput = {
      id: campaign.id as string,
      name: 'Renamed campaign',
      triggers: [],
      definition: { version: 1, steps: [] },
    }
    const before = await saveCampaignGraphCommand.prepare!(saveInput, ctx)
    const result = await saveCampaignGraphCommand.execute(saveInput, ctx)
    expect(campaigns.get(result.id)).toMatchObject({ name: 'Renamed campaign' })
    expect(triggers.size).toBe(0)

    const logEntry = await buildLogFor(saveCampaignGraphCommand, {
      input: saveInput, result, ctx, snapshots: before as { before?: unknown },
    })

    await saveCampaignGraphCommand.undo!({ input: saveInput, ctx, logEntry: logEntry as never })
    expect(campaigns.get(result.id)).toMatchObject({ name: 'Original name' })
    expect(triggers.size).toBe(1)
  })
})
