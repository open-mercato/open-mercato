jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (em: TestEntityManager, entity: unknown, filters: Record<string, unknown>) =>
    em.findOne(entity, filters),
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

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceRecordGoneIsConflict: jest.fn(),
  enforceCommandOptimisticLockWithGuards: jest.fn(async () => undefined),
}))

jest.mock('../../lib/interactionProjection', () => ({
  recomputeNextInteraction: jest.fn(async () => ({ nextInteractionId: null })),
}))

jest.mock('../../lib/calendar/eventTypeResolver', () => ({
  resolveScopedCalendarEventTypes: jest.fn(async () => ({
    items: jest.requireActual('../../calendar-event-types').calendarEventTypes,
  })),
  resolveCatalogEventType: (catalog: { items: Array<{ key: string }> }, key: string) =>
    catalog.items.find((item) => item.key === key),
}))

jest.mock('../../lib/conversationShares', () => ({
  listGrantsForViewerOnPerson: jest.fn(async () => []),
  listSharedChannelIds: jest.fn(async () => []),
}))

import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { CustomerEntity, CustomerInteraction } from '../../data/entities'
import { listGrantsForViewerOnPerson, listSharedChannelIds } from '../../lib/conversationShares'
import '../interactions'
import '../activities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const PERSON_ID = '33333333-3333-4333-8333-333333333333'
const INTERACTION_ID = '44444444-4444-4444-8444-444444444444'
const AUTHOR_ID = '55555555-5555-4555-8555-555555555555'
const VIEWER_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_PERSON_ID = '77777777-7777-4777-8777-777777777777'
const CHANNEL_ID = '88888888-8888-4888-8888-888888888888'
const DELETED_USER_ID = '99999999-9999-4999-8999-999999999999'
const MISSING_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

type TestEntityManager = {
  findOne: (entity: unknown, filters: Record<string, unknown>) => Promise<unknown>
}

function createInteraction(overrides: Partial<CustomerInteraction> = {}): CustomerInteraction {
  return {
    id: INTERACTION_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    entity: { id: PERSON_ID, kind: 'person' },
    interactionType: 'note',
    authorUserId: AUTHOR_ID,
    ownerUserId: AUTHOR_ID,
    channelId: null,
    visibility: null,
    title: 'Private message',
    body: 'Confidential content',
    status: 'planned',
    scheduledAt: null,
    occurredAt: null,
    priority: null,
    dealId: null,
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
    createdAt: new Date('2026-10-20T00:00:00.000Z'),
    updatedAt: new Date('2026-10-20T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as CustomerInteraction
}

function createHarness(interaction = createInteraction(), authOverrides: Record<string, unknown> | null = {}) {
  const users = [
    { id: AUTHOR_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, deletedAt: null },
    { id: VIEWER_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, deletedAt: null },
    { id: OTHER_PERSON_ID, tenantId: OTHER_PERSON_ID, organizationId: ORGANIZATION_ID, deletedAt: null },
    { id: CHANNEL_ID, tenantId: TENANT_ID, organizationId: CHANNEL_ID, deletedAt: null },
    { id: DELETED_USER_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, deletedAt: new Date() },
  ]
  const em = {
    findOne: jest.fn(async (entity: unknown, filters: Record<string, unknown>) => {
      if (entity === User) {
        const user = users.find((candidate) => candidate.id === filters.id && candidate.tenantId === filters.tenantId && (filters.organizationId === undefined || candidate.organizationId === filters.organizationId) && (filters.deletedAt === undefined || candidate.deletedAt === filters.deletedAt))
        return user ?? null
      }
      if (entity === CustomerInteraction) return filters.id === interaction.id ? interaction : null
      if (entity === CustomerEntity) {
        return { id: filters.id, kind: 'person', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
      }
      return null
    }),
    find: jest.fn(async () => []),
    flush: jest.fn(async () => undefined),
    persist: jest.fn(),
    remove: jest.fn(),
    create: jest.fn((_entity: unknown, values: Record<string, unknown>) => values),
    isInTransaction: () => false,
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    fork: (): TestEntityManager => em,
  }
  const emitEvent = jest.fn(async () => undefined)
  const dataEngine = { setCustomFields: jest.fn(async () => undefined) }
  const ctx = {
    auth: authOverrides === null ? null : {
      sub: VIEWER_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
      ...authOverrides,
    },
    selectedOrganizationId: ORGANIZATION_ID,
    organizationScope: null,
    organizationIds: [ORGANIZATION_ID],
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'dataEngine') return dataEngine
        if (token === 'eventBus') return { emitEvent }
        if (token === 'organizationHierarchyService') return { resolveAncestorIds: async () => [] }
        throw new Error(`[internal] Unexpected dependency: ${token}`)
      },
    },
  } as unknown as CommandRuntimeContext
  return { interaction, em, ctx, emitEvent, users }
}

function handler(operation: string): CommandHandler {
  const command = commandRegistry.get(`customers.${operation}`)
  expect(command).toBeDefined()
  return command as CommandHandler
}

function updateInput(changes: Record<string, unknown>): Record<string, unknown> {
  return { id: INTERACTION_ID, ...changes }
}

function historicalSnapshot(interaction: CustomerInteraction, overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    ...interaction,
    entityId: PERSON_ID,
    entityKind: 'person',
    ...overrides,
  }
  delete values.entity
  delete values.channelId
  return { interaction: values, custom: {} }
}

beforeEach(() => {
  jest.clearAllMocks()
})

const invalidUsers = [
  ['foreign tenant', OTHER_PERSON_ID],
  ['deleted', DELETED_USER_ID],
  ['missing', MISSING_USER_ID],
]

describe('interaction user reference scope (#7531)', () => {
  describe.each(['authorUserId', 'ownerUserId'])('%s', (field) => {
    it.each(invalidUsers)('rejects a %s user on create before persisting', async (_reason, userId) => {
      const { em, ctx } = createHarness()
      await expect(handler('interactions.create').execute({
        tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, entityId: PERSON_ID,
        interactionType: 'note', [field]: userId,
      }, ctx)).rejects.toMatchObject({ status: 400 })
      expect(em.persist).not.toHaveBeenCalled()
      expect(em.flush).not.toHaveBeenCalled()
      expect(emitCrudSideEffects).not.toHaveBeenCalled()
    })

    it.each(invalidUsers)('rejects a %s user on update before changing scalars', async (_reason, userId) => {
      const { interaction, em, ctx } = createHarness()
      const original = { ...interaction }
      await expect(handler('interactions.update').execute({
        id: INTERACTION_ID, title: 'Must not persist', [field]: userId,
      }, ctx)).rejects.toMatchObject({ status: 400 })
      expect(interaction).toEqual(original)
      expect(em.flush).not.toHaveBeenCalled()
      expect(emitCrudSideEffects).not.toHaveBeenCalled()
    })
  })

  it('accepts same-scope references and preserves explicit author delegation for superadmins', async () => {
    const { em, ctx } = createHarness(undefined, { isSuperAdmin: true })
    await handler('interactions.create').execute({
      tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, entityId: PERSON_ID,
      interactionType: 'note', authorUserId: AUTHOR_ID, ownerUserId: VIEWER_ID,
    }, ctx)
    expect(em.persist).toHaveBeenCalledWith(expect.objectContaining({ authorUserId: AUTHOR_ID, ownerUserId: VIEWER_ID }))
    expect(em.findOne).toHaveBeenCalledWith(User, {
      id: AUTHOR_ID, tenantId: TENANT_ID, deletedAt: null,
    })
  })


  it.each(['authorUserId', 'ownerUserId'])('accepts a same-tenant user from another organization as explicit %s', async (field) => {
    const { interaction, em, ctx } = createHarness(undefined, { isSuperAdmin: true })
    await handler('interactions.create').execute({
      tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, entityId: PERSON_ID,
      interactionType: 'note', [field]: CHANNEL_ID,
    }, ctx)
    expect(em.persist).toHaveBeenCalledWith(expect.objectContaining({ [field]: CHANNEL_ID }))
    await handler('interactions.update').execute({ id: INTERACTION_ID, [field]: CHANNEL_ID }, ctx)
    expect(interaction[field as 'authorUserId' | 'ownerUserId']).toBe(CHANNEL_ID)
  })

  it('keeps the implicit actor when their home organization differs from the selected record', async () => {
    const { em, ctx, users } = createHarness()
    users.find((user) => user.id === VIEWER_ID)!.organizationId = CHANNEL_ID
    await handler('interactions.create').execute({
      tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, entityId: PERSON_ID, interactionType: 'note',
    }, ctx)
    expect(em.persist).toHaveBeenCalledWith(expect.objectContaining({ authorUserId: VIEWER_ID }))
  })

  describe.each(['authorUserId', 'ownerUserId'])('historical %s', (field) => {
    it.each([['offboarded', DELETED_USER_ID], ['another organization', CHANNEL_ID]])('restores an author from %s through update undo, delete undo and create redo', async (_kind, userId) => {
      for (const operation of ['interactions.update', 'interactions.delete', 'interactions.create']) {
        const { interaction, em, ctx } = createHarness()
        const snapshot = historicalSnapshot(interaction, { [field]: userId })
        const command = handler(operation)
        if (operation === 'interactions.create') {
          interaction.deletedAt = new Date()
          await command.redo!({ input: {}, ctx, logEntry: { snapshotAfter: snapshot } as never })
          expect(interaction[field as 'authorUserId' | 'ownerUserId']).toBe(userId)
          expect(interaction.deletedAt).toBeNull()
        } else {
          await command.undo!({ input: {}, ctx, logEntry: { commandPayload: { undo: { before: snapshot } } } as never })
          expect(interaction[field as 'authorUserId' | 'ownerUserId']).toBe(userId)
        }
        expect(em.flush).toHaveBeenCalled()
      }
    })
  })

  it('keeps author normalization for ordinary users', async () => {
    const { em, ctx } = createHarness()
    await handler('interactions.create').execute({
      tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, entityId: PERSON_ID,
      interactionType: 'note', authorUserId: AUTHOR_ID,
    }, ctx)
    expect(em.persist).toHaveBeenCalledWith(expect.objectContaining({ authorUserId: VIEWER_ID }))
  })

  it('stores null for an implicit actor outside the selected record scope', async () => {
    const { em, ctx } = createHarness(undefined, { sub: OTHER_PERSON_ID, isSuperAdmin: true })
    await handler('interactions.create').execute({
      tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, entityId: PERSON_ID,
      interactionType: 'note',
    }, ctx)
    expect(em.persist).toHaveBeenCalledWith(expect.objectContaining({ authorUserId: null }))
  })

  it('preserves omitted references and allows explicit null clearing on update', async () => {
    const { interaction, ctx } = createHarness()
    await handler('interactions.update').execute({ id: INTERACTION_ID, title: 'Edited' }, ctx)
    expect(interaction).toMatchObject({ authorUserId: AUTHOR_ID, ownerUserId: AUTHOR_ID })
    await handler('interactions.update').execute({ id: INTERACTION_ID, authorUserId: null, ownerUserId: null }, ctx)
    expect(interaction).toMatchObject({ authorUserId: null, ownerUserId: null })
  })

  it.each(['create', 'update'])('protects legacy activity %s through the canonical command', async (operation) => {
    const { em, ctx } = createHarness()
    await expect(handler(`activities.${operation}`).execute({
      id: INTERACTION_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID,
      entityId: PERSON_ID, activityType: 'note', authorUserId: OTHER_PERSON_ID,
    }, ctx)).rejects.toMatchObject({ status: 400 })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it.each(['authorUserId', 'ownerUserId'])('rejects a poisoned %s in an undo snapshot', async (field) => {
    const { interaction, em, ctx } = createHarness()
    const snapshot = historicalSnapshot(interaction, { [field]: OTHER_PERSON_ID })
    await expect(handler('interactions.update').undo!({
      input: {}, ctx, logEntry: { commandPayload: { undo: { before: snapshot } } } as never,
    })).rejects.toMatchObject({ status: 400 })
    expect(em.flush).not.toHaveBeenCalled()
    expect(emitCrudUndoSideEffects).not.toHaveBeenCalled()
  })

  it('rejects a poisoned author in a create redo snapshot', async () => {
    const { interaction, em, ctx } = createHarness()
    const snapshot = historicalSnapshot(interaction, { authorUserId: OTHER_PERSON_ID })
    await expect(handler('interactions.create').redo!({
      input: {}, ctx, logEntry: { snapshotAfter: snapshot } as never,
    })).rejects.toMatchObject({ status: 400 })
    expect(em.flush).not.toHaveBeenCalled()
  })
})
