/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

const mockRetiredDealIds = new Set<string>()
const mockExtraEventTypes: unknown[] = []

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (
    em: TestEntityManager,
    entity: unknown,
    filters: Record<string, unknown>,
    options?: { refresh?: boolean },
  ) => em.findOne(entity, filters, options),
  findWithDecryption: async (_em: unknown, _entity: unknown, filters: { id?: { $in?: string[] } }) =>
    (filters.id?.$in ?? []).filter((id) => !mockRetiredDealIds.has(id)).map((id) => ({ id })),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots'),
  loadCustomFieldSnapshot: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  setCustomFieldsIfAny: jest.fn(async () => undefined),
  emitCrudSideEffects: jest.fn(async () => undefined),
  emitCrudUndoSideEffects: jest.fn(async () => undefined),
}))

jest.mock('../../lib/interactionProjection', () => ({
  recomputeNextInteraction: jest.fn(async () => ({ nextInteractionId: null })),
}))

jest.mock('../../lib/calendar/eventTypeResolver', () => ({
  resolveScopedCalendarEventTypes: jest.fn(async () => ({
    items: [...jest.requireActual('../../calendar-event-types').calendarEventTypes, ...mockExtraEventTypes],
  })),
  resolveCatalogEventType: (catalog: { items: Array<{ key: string }> }, key: string) =>
    catalog.items.find((item) => item.key === key),
}))

import { CommandBus } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { calendarEventTypes } from '../../calendar-event-types'
import { CustomerDeal, CustomerEntity, CustomerInteraction } from '../../data/entities'
import '../interactions'
import '../activities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const PERSON_ID = '33333333-3333-4333-8333-333333333333'
const INTERACTION_ID = '44444444-4444-4444-8444-444444444444'
const SOURCE_DEAL_ID = '55555555-5555-4555-8555-555555555555'
const TARGET_DEAL_ID = '66666666-6666-4666-8666-666666666666'
const LOADED_VERSION = new Date('2026-11-01T10:00:00.000Z')
const MERGED_VERSION = new Date('2026-11-01T10:00:05.123Z')

type TestEntityManager = {
  findOne: (entity: unknown, filters: Record<string, unknown>, options?: { refresh?: boolean }) => Promise<unknown>
}

type InteractionSnapshotShape = {
  interaction: { dealId: string | null; linkedEntities: unknown; title: string | null; interactionType: string }
}

type LoggedAction = {
  commandId: string
  commandPayload: unknown
  snapshotBefore: InteractionSnapshotShape
  undoToken: string
}

const RESOURCE_CHIP = { type: 'resource', id: 'room-1', label: 'Room' }
const MERGED_LINKS = [{ type: 'deal', id: TARGET_DEAL_ID, label: 'Survivor' }]
const MERGE_COMMITTED_BEFORE_LOCK = {
  dealId: TARGET_DEAL_ID,
  linkedEntities: MERGED_LINKS,
  updatedAt: MERGED_VERSION,
} as unknown as Partial<CustomerInteraction>

function createInteraction(): CustomerInteraction {
  return {
    id: INTERACTION_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    entity: { id: PERSON_ID, kind: 'person' },
    interactionType: 'task',
    authorUserId: null,
    ownerUserId: null,
    channelId: null,
    visibility: null,
    title: 'Loaded title',
    body: null,
    status: 'planned',
    scheduledAt: null,
    occurredAt: null,
    priority: null,
    dealId: SOURCE_DEAL_ID,
    source: null,
    appearanceIcon: null,
    appearanceColor: null,
    pinned: false,
    durationMinutes: null,
    timezone: null,
    location: null,
    allDay: null,
    recurrenceRule: null,
    recurrenceEnd: null,
    participants: null,
    reminderMinutes: null,
    linkedEntities: null,
    guestPermissions: null,
    createdAt: LOADED_VERSION,
    updatedAt: LOADED_VERSION,
    deletedAt: null,
  } as unknown as CustomerInteraction
}

type HarnessOptions = {
  lockedVersion?: Date | null
  token?: string | null
  initial?: Partial<CustomerInteraction>
  committedBeforeLock?: Partial<CustomerInteraction>
  deletedDealIds?: string[]
}

function createHarness(options: HarnessOptions = {}) {
  const interaction = Object.assign(createInteraction(), options.initial ?? {})
  mockRetiredDealIds.clear()
  for (const id of options.deletedDealIds ?? []) mockRetiredDealIds.add(id)
  let rowLocked = false
  const lockedVersion = options.lockedVersion === undefined ? LOADED_VERSION : options.lockedVersion
  const steps: string[] = []
  const storedRow = () => (rowLocked || !options.committedBeforeLock ? interaction : { ...interaction, ...options.committedBeforeLock })
  const execute = jest.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('pg_advisory_xact_lock')) {
      steps.push(`deal-lock:${String(params[0]).split(':').pop()}`)
      return []
    }
    if (sql.includes('from customer_interactions') && sql.includes('for update')) {
      steps.push('row-lock')
      rowLocked = true
      expect(params).toEqual([INTERACTION_ID, TENANT_ID, ORGANIZATION_ID])
      return lockedVersion ? [{ updated_at: lockedVersion }] : []
    }
    if (sql.includes('select deal_id, linked_entities from customer_interactions')) {
      const row = storedRow()
      return [{ deal_id: row.dealId ?? null, linked_entities: row.linkedEntities ?? null }]
    }
    return []
  })
  const em = {
    findOne: jest.fn(async (entity: unknown, filters: Record<string, unknown>, findOptions?: { refresh?: boolean }) => {
      if (entity === CustomerInteraction) {
        if (findOptions?.refresh && rowLocked && options.committedBeforeLock) {
          Object.assign(interaction, options.committedBeforeLock)
        }
        steps.push(findOptions?.refresh ? 'refresh' : 'load')
        return filters.id === interaction.id ? interaction : null
      }
      if (entity === CustomerDeal) {
        if (mockRetiredDealIds.has(String(filters.id))) return null
        return { id: filters.id, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, deletedAt: null }
      }
      if (entity === CustomerEntity) {
        return { id: filters.id, kind: 'person', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
      }
      return null
    }),
    find: jest.fn(async () => []),
    execute,
    flush: jest.fn(async () => { steps.push('flush') }),
    persist: jest.fn(),
    create: jest.fn((_entity: unknown, values: Record<string, unknown>) => values),
    isInTransaction: () => false,
    begin: jest.fn(async () => { steps.push('begin') }),
    commit: jest.fn(async () => { steps.push('commit') }),
    rollback: jest.fn(async () => { steps.push('rollback') }),
    fork: () => em,
  }
  const logs: LoggedAction[] = []
  const actionLogService = {
    log: jest.fn(async (input: Record<string, unknown>) => {
      const log = { ...input, id: `log-${logs.length + 1}` } as unknown as LoggedAction
      logs.push(log)
      return log
    }),
  }
  const token = options.token === undefined ? LOADED_VERSION.toISOString() : options.token
  const ctx = {
    auth: { sub: 'actor', tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
    selectedOrganizationId: ORGANIZATION_ID,
    organizationScope: null,
    organizationIds: [ORGANIZATION_ID],
    request: new Request('http://localhost/api/customers/interactions', {
      method: 'PUT',
      headers: token ? { [OPTIMISTIC_LOCK_HEADER_NAME]: token } : {},
    }),
    container: {
      resolve: (key: string) => {
        if (key === 'em') return em
        if (key === 'actionLogService') return actionLogService
        if (key === 'dataEngine') return { setCustomFields: jest.fn(async () => undefined) }
        if (key === 'eventBus') return { emitEvent: jest.fn(async () => undefined) }
        if (key === 'organizationHierarchyService') return { resolveAncestorIds: async () => [] }
        throw new Error(`[internal] Unexpected dependency: ${key}`)
      },
    },
  } as unknown as CommandRuntimeContext
  return { interaction, em, ctx, steps, logs }
}

function handler(commandId: string): CommandHandler {
  const command = commandRegistry.get(commandId)
  expect(command).toBeDefined()
  return command as CommandHandler
}

async function runThroughBus(commandId: string, input: unknown, harness: ReturnType<typeof createHarness>) {
  const bus = new CommandBus()
  const { logEntry } = await bus.execute(commandId, { input, ctx: harness.ctx, skipCacheInvalidation: true })
  expect(logEntry).toBeTruthy()
  return harness.logs[harness.logs.length - 1]
}

async function undoLogged(commandId: string, log: LoggedAction, harness: ReturnType<typeof createHarness>) {
  await handler(commandId).undo!({ input: log.commandPayload, ctx: harness.ctx, logEntry: log as never })
}

beforeEach(() => {
  mockExtraEventTypes.length = 0
})

describe('interaction writes check the version under the interaction row lock', () => {
  it('locks the row for a title-only edit and writes only after the version read under that lock', async () => {
    const harness = createHarness()
    await handler('customers.interactions.update').execute({ id: INTERACTION_ID, title: 'Edited' }, harness.ctx)
    expect(harness.steps).toEqual(['begin', 'load', 'row-lock', 'load', 'flush', 'commit'])
    expect(harness.steps.some((step) => step.startsWith('deal-lock:'))).toBe(false)
    expect(harness.interaction.title).toBe('Edited')
  })

  it('takes Deal locks before the interaction row lock when an edit changes Deal references', async () => {
    const harness = createHarness()
    await handler('customers.interactions.update').execute({
      id: INTERACTION_ID,
      dealId: TARGET_DEAL_ID,
      linkedEntities: [{ type: 'deal', id: SOURCE_DEAL_ID, label: 'Source' }],
    }, harness.ctx)
    const rowLock = harness.steps.indexOf('row-lock')
    const dealLocks = harness.steps.filter((step) => step.startsWith('deal-lock:'))
    expect(dealLocks.sort()).toEqual([`deal-lock:${SOURCE_DEAL_ID}`, `deal-lock:${TARGET_DEAL_ID}`])
    expect(harness.steps.findLastIndex((step) => step.startsWith('deal-lock:'))).toBeLessThan(rowLock)
    expect(rowLock).toBeLessThan(harness.steps.indexOf('flush'))
    expect(harness.interaction.dealId).toBe(TARGET_DEAL_ID)
  })

  it('rejects a newly linked retired Deal under the row lock', async () => {
    const harness = createHarness({ deletedDealIds: [TARGET_DEAL_ID] })
    await expect(handler('customers.interactions.update').execute({
      id: INTERACTION_ID,
      linkedEntities: [{ type: 'deal', id: TARGET_DEAL_ID, label: 'Retired' }],
    }, harness.ctx)).rejects.toMatchObject({ status: 400 })
    expect(harness.em.flush).not.toHaveBeenCalled()
  })

  it('returns the standard 409 when a merge committed after the edit loaded its version', async () => {
    const harness = createHarness({ lockedVersion: MERGED_VERSION })
    const error = await handler('customers.interactions.update')
      .execute({ id: INTERACTION_ID, title: 'Stale edit' }, harness.ctx)
      .catch((err: unknown) => err)
    expect(error).toBeInstanceOf(CrudHttpError)
    expect((error as CrudHttpError).status).toBe(409)
    expect((error as CrudHttpError).body).toEqual({
      error: expect.any(String),
      code: 'optimistic_lock_conflict',
      currentUpdatedAt: MERGED_VERSION.toISOString(),
      expectedUpdatedAt: LOADED_VERSION.toISOString(),
    })
    expect(harness.steps).toEqual(['begin', 'load', 'row-lock', 'rollback'])
    expect(harness.em.flush).not.toHaveBeenCalled()
  })

  it('keeps a client without a version token on last-writer-wins under the row lock', async () => {
    const harness = createHarness({ lockedVersion: MERGED_VERSION, token: null })
    await handler('customers.interactions.update').execute({ id: INTERACTION_ID, title: 'No token' }, harness.ctx)
    expect(harness.steps).toEqual(['begin', 'load', 'row-lock', 'refresh', 'load', 'flush', 'commit'])
  })

  it('treats a row deleted before the lock as a conflict for a versioned edit', async () => {
    const harness = createHarness({ lockedVersion: null })
    await expect(handler('customers.interactions.update').execute({ id: INTERACTION_ID, title: 'Gone' }, harness.ctx))
      .rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'optimistic_lock_conflict' }) })
    expect(harness.em.flush).not.toHaveBeenCalled()
  })

  it('returns 404 for a row deleted before the lock when the edit carries no version', async () => {
    const harness = createHarness({ lockedVersion: null, token: null })
    await expect(handler('customers.interactions.update').execute({ id: INTERACTION_ID, title: 'Gone' }, harness.ctx))
      .rejects.toMatchObject({ status: 404 })
    expect(harness.em.flush).not.toHaveBeenCalled()
  })

  it.each([
    ['customers.interactions.complete', { id: INTERACTION_ID }],
    ['customers.interactions.cancel', { id: INTERACTION_ID }],
    ['customers.interactions.delete', { body: { id: INTERACTION_ID } }],
  ])('%s locks the row and rejects a stale version before writing', async (commandId, input) => {
    const fresh = createHarness()
    await handler(commandId).execute(input, fresh.ctx)
    expect(fresh.steps).toEqual(['begin', 'load', 'row-lock', 'load', 'flush', 'commit'])

    const stale = createHarness({ lockedVersion: MERGED_VERSION })
    await expect(handler(commandId).execute(input, stale.ctx)).rejects.toMatchObject({ status: 409 })
    expect(stale.steps).toEqual(['begin', 'load', 'row-lock', 'rollback'])
  })
})

describe('the undo snapshot of a tokenless write is taken under the interaction row lock (through the command bus)', () => {
  const mergeRacedBeforeLock = () => createHarness({
    lockedVersion: MERGED_VERSION,
    token: null,
    committedBeforeLock: MERGE_COMMITTED_BEFORE_LOCK,
    deletedDealIds: [SOURCE_DEAL_ID],
  })

  it('customers.interactions.update logs the survivor Deal as undo before and undo restores the post-merge state', async () => {
    const harness = mergeRacedBeforeLock()
    const log = await runThroughBus('customers.interactions.update', { id: INTERACTION_ID, title: 'Edited during merge' }, harness)

    expect(harness.steps.indexOf('refresh')).toBeGreaterThan(harness.steps.indexOf('row-lock'))
    expect(harness.interaction).toMatchObject({ dealId: TARGET_DEAL_ID, linkedEntities: MERGED_LINKS, title: 'Edited during merge' })
    expect(log.snapshotBefore.interaction).toMatchObject({ dealId: TARGET_DEAL_ID, linkedEntities: MERGED_LINKS, title: 'Loaded title' })
    expect(log.commandPayload).toMatchObject({
      undo: { before: { interaction: { dealId: TARGET_DEAL_ID, linkedEntities: MERGED_LINKS, title: 'Loaded title' } } },
    })

    await undoLogged('customers.interactions.update', log, harness)
    expect(harness.interaction).toMatchObject({ dealId: TARGET_DEAL_ID, linkedEntities: MERGED_LINKS, title: 'Loaded title' })
  })

  it('customers.activities.update (the AI activities tool path) logs the survivor Deal and undo restores the post-merge state', async () => {
    const harness = mergeRacedBeforeLock()
    const log = await runThroughBus('customers.activities.update', { id: INTERACTION_ID, subject: 'AI edit during merge' }, harness)

    expect(harness.interaction).toMatchObject({ dealId: TARGET_DEAL_ID, linkedEntities: MERGED_LINKS, title: 'AI edit during merge' })
    expect(log.commandId).toBe('customers.activities.update')
    expect(log.snapshotBefore.interaction).toMatchObject({ dealId: TARGET_DEAL_ID, linkedEntities: MERGED_LINKS, title: 'Loaded title' })
    expect(log.commandPayload).toMatchObject({
      undo: { before: { interaction: { dealId: TARGET_DEAL_ID, linkedEntities: MERGED_LINKS } } },
    })

    await undoLogged('customers.activities.update', log, harness)
    expect(harness.interaction).toMatchObject({ dealId: TARGET_DEAL_ID, linkedEntities: MERGED_LINKS, title: 'Loaded title' })
  })

  it.each([
    ['customers.interactions.complete', { id: INTERACTION_ID }],
    ['customers.interactions.cancel', { id: INTERACTION_ID }],
    ['customers.interactions.delete', { body: { id: INTERACTION_ID } }],
    ['customers.activities.delete', { body: { id: INTERACTION_ID } }],
  ])('%s logs the row read under the lock after a merge committed', async (commandId, input) => {
    const harness = mergeRacedBeforeLock()
    const log = await runThroughBus(commandId, input, harness)
    expect(log.snapshotBefore.interaction).toMatchObject({ dealId: TARGET_DEAL_ID, linkedEntities: MERGED_LINKS })
    expect(log.commandPayload).toMatchObject({ undo: { before: { interaction: { dealId: TARGET_DEAL_ID } } } })
  })

  it('logs the prepared row unchanged when no write raced the lock', async () => {
    const harness = createHarness({ token: null })
    const log = await runThroughBus('customers.interactions.update', { id: INTERACTION_ID, title: 'Plain edit' }, harness)
    expect(log.snapshotBefore.interaction).toMatchObject({ dealId: SOURCE_DEAL_ID, title: 'Loaded title' })
  })
})

describe('a tokenless update derives every stored value after the interaction row lock', () => {
  it('applies a discarding type change raced by a merge and keeps the survivor chip', async () => {
    const note = calendarEventTypes.find((type) => type.key === 'note')!
    mockExtraEventTypes.push({
      ...note,
      key: 'quick_note',
      behavior: { ...note.behavior, fields: { ...note.behavior.fields, resources: false } },
    })
    const sourceChip = { type: 'deal', id: SOURCE_DEAL_ID, label: 'Source' }
    const survivorChip = { type: 'deal', id: TARGET_DEAL_ID, label: 'Survivor' }
    const harness = createHarness({
      lockedVersion: MERGED_VERSION,
      token: null,
      initial: { linkedEntities: [sourceChip, RESOURCE_CHIP] } as unknown as Partial<CustomerInteraction>,
      committedBeforeLock: {
        dealId: TARGET_DEAL_ID,
        linkedEntities: [survivorChip, RESOURCE_CHIP],
        updatedAt: MERGED_VERSION,
      } as unknown as Partial<CustomerInteraction>,
      deletedDealIds: [SOURCE_DEAL_ID],
    })

    const log = await runThroughBus('customers.interactions.update', {
      id: INTERACTION_ID,
      interactionType: 'quick_note',
      confirmDiscardInapplicableValues: true,
    }, harness)

    expect(harness.interaction).toMatchObject({
      interactionType: 'quick_note',
      dealId: TARGET_DEAL_ID,
      linkedEntities: [survivorChip],
    })
    expect(harness.steps.filter((step) => step.startsWith('deal-lock:'))).toEqual([`deal-lock:${SOURCE_DEAL_ID}`])
    expect(harness.steps.findLastIndex((step) => step.startsWith('deal-lock:'))).toBeLessThan(harness.steps.indexOf('row-lock'))
    expect(log.snapshotBefore.interaction).toMatchObject({
      interactionType: 'task',
      dealId: TARGET_DEAL_ID,
      linkedEntities: [survivorChip, RESOURCE_CHIP],
    })
  })
})
