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

type TestEntityManager = {
  findOne: (entity: unknown, filters: Record<string, unknown>) => Promise<unknown>
}

function createInteraction(overrides: Partial<CustomerInteraction> = {}): CustomerInteraction {
  return {
    id: INTERACTION_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    entity: { id: PERSON_ID, kind: 'person' },
    interactionType: 'email',
    authorUserId: AUTHOR_ID,
    ownerUserId: AUTHOR_ID,
    channelId: CHANNEL_ID,
    visibility: 'private',
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
  const em = {
    findOne: jest.fn(async (entity: unknown, filters: Record<string, unknown>) => {
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
  return { interaction, em, ctx, emitEvent }
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
  jest.mocked(listGrantsForViewerOnPerson).mockResolvedValue([])
  jest.mocked(listSharedChannelIds).mockResolvedValue([])
})

describe('private email command authorization', () => {
  it.each([
    ['author takeover', { authorUserId: VIEWER_ID }],
    ['author clearing', { authorUserId: null }],
    ['type conversion', { interactionType: 'note' }],
    ['body edit', { body: 'Changed private content' }],
    ['status edit', { status: 'done' }],
    ['person relink', { entityId: OTHER_PERSON_ID }],
    ['sharing', { visibility: 'shared' }],
  ])('rejects %s against the original hidden row without writing', async (_name, changes) => {
    const { interaction, em, ctx, emitEvent } = createHarness()
    const original = { ...interaction }
    await expect(handler('interactions.update').execute(updateInput(changes), ctx)).rejects.toMatchObject({ status: 404 })
    expect(interaction).toEqual(original)
    expect(em.flush).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
    expect(enforceCommandOptimisticLockWithGuards).not.toHaveBeenCalled()
  })

  it.each(['complete', 'cancel', 'delete'])('rejects %s on a hidden private email', async (operation) => {
    const { interaction, em, ctx } = createHarness()
    const original = { ...interaction }
    const input = operation === 'delete' ? { body: { id: INTERACTION_ID } } : { id: INTERACTION_ID }
    await expect(handler(`interactions.${operation}`).execute(input, ctx)).rejects.toMatchObject({ status: 404 })
    expect(interaction).toEqual(original)
    expect(em.flush).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
  })

  it.each(['update', 'complete', 'cancel', 'delete'])('blocks hidden-email snapshots during %s preparation', async (operation) => {
    const { ctx } = createHarness()
    const input = operation === 'delete' ? { body: { id: INTERACTION_ID } } : { id: INTERACTION_ID }
    await expect(handler(`interactions.${operation}`).prepare!(input, ctx)).rejects.toMatchObject({ status: 404 })
  })

  it.each(['complete', 'cancel', 'delete'])('allows the author to %s a private email', async (operation) => {
    const { em, ctx } = createHarness(createInteraction(), { sub: AUTHOR_ID })
    const input = operation === 'delete' ? { body: { id: INTERACTION_ID } } : { id: INTERACTION_ID }
    await handler(`interactions.${operation}`).execute(input, ctx)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['wildcard administrator', { features: ['*'], roles: ['admin'] }],
    ['customer administrator', { features: ['customers.*', 'customers.email.view_private'] }],
    ['API key', { sub: AUTHOR_ID, isApiKey: true }],
    ['missing subject', { sub: null }],
    ['missing authentication', null],
  ])('gives no privacy bypass to %s', async (_name, auth) => {
    const { em, ctx } = createHarness(createInteraction(), auth)
    await expect(handler('interactions.update').execute(updateInput({ authorUserId: VIEWER_ID }), ctx)).rejects.toMatchObject({ status: 404 })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it.each([
    ['author change', { authorUserId: VIEWER_ID }],
    ['type conversion', { interactionType: 'note' }],
    ['body change', { body: 'Owner edited' }],
    ['sharing', { visibility: 'shared' }],
  ])('allows the original author to make an %s', async (_name, changes) => {
    const { interaction, em, ctx } = createHarness(createInteraction(), { sub: AUTHOR_ID })
    await handler('interactions.update').execute(updateInput(changes), ctx)
    expect(interaction).toMatchObject(changes)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['shared email', { visibility: 'shared' }],
    ['legacy email', { visibility: null }],
    ['non-email', { interactionType: 'note' }],
  ])('preserves ordinary body editing for a %s', async (_name, overrides) => {
    const { interaction, ctx } = createHarness(createInteraction(overrides))
    await handler('interactions.update').execute(updateInput({ body: 'Team edited' }), ctx)
    expect(interaction.body).toBe('Team edited')
  })

  it.each(['conversation', 'channel'])('allows body edits through an explicit %s grant', async (grant) => {
    const { interaction, ctx } = createHarness()
    if (grant === 'conversation') {
      jest.mocked(listGrantsForViewerOnPerson).mockResolvedValue([{ personEntityId: PERSON_ID, ownerUserId: AUTHOR_ID }])
    } else {
      jest.mocked(listSharedChannelIds).mockResolvedValue([CHANNEL_ID])
    }
    await handler('interactions.update').execute(updateInput({ body: 'Team edited' }), ctx)
    expect(interaction.body).toBe('Team edited')
  })

  it.each(['other person', 'other owner', 'other channel'])('rejects an unrelated sharing grant for %s', async (grant) => {
    const { em, ctx } = createHarness()
    if (grant === 'other channel') {
      jest.mocked(listSharedChannelIds).mockResolvedValue([OTHER_PERSON_ID])
    } else {
      jest.mocked(listGrantsForViewerOnPerson).mockResolvedValue([{
        personEntityId: grant === 'other person' ? OTHER_PERSON_ID : PERSON_ID,
        ownerUserId: grant === 'other owner' ? VIEWER_ID : AUTHOR_ID,
      }])
    }
    await expect(handler('interactions.update').execute(updateInput({ body: 'Attempted edit' }), ctx)).rejects.toMatchObject({ status: 404 })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('allows unchanged privacy fields in a shared-email edit', async () => {
    const { interaction, ctx } = createHarness(createInteraction({ visibility: 'shared' }))
    await handler('interactions.update').execute(updateInput({
      body: 'Team edited',
      authorUserId: AUTHOR_ID,
      interactionType: 'email',
      visibility: 'shared',
    }), ctx)
    expect(interaction.body).toBe('Team edited')
  })

  it.each([
    ['conversation', { authorUserId: VIEWER_ID }],
    ['conversation', { interactionType: 'note' }],
    ['conversation', { visibility: 'shared' }],
    ['channel', { authorUserId: VIEWER_ID }],
    ['channel', { interactionType: 'note' }],
    ['channel', { visibility: 'shared' }],
    ['shared', { authorUserId: VIEWER_ID }],
    ['shared', { interactionType: 'note' }],
    ['shared', { visibility: 'private' }],
  ])('keeps privacy controls owner-only for %s-shared email (%j)', async (grant, changes) => {
    const { interaction, em, ctx } = createHarness(createInteraction(grant === 'shared' ? { visibility: 'shared' } : {}))
    if (grant === 'conversation') {
      jest.mocked(listGrantsForViewerOnPerson).mockResolvedValue([{ personEntityId: PERSON_ID, ownerUserId: AUTHOR_ID }])
    } else if (grant === 'channel') {
      jest.mocked(listSharedChannelIds).mockResolvedValue([CHANNEL_ID])
    }
    const original = { ...interaction }
    await expect(handler('interactions.update').execute(updateInput(changes), ctx)).rejects.toMatchObject({ status: 404 })
    expect(interaction).toEqual(original)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it.each([
    ['takeover', { authorUserId: VIEWER_ID }],
    ['conversion', { activityType: 'note' }],
  ])('blocks the legacy activity command %s payload', async (_name, changes) => {
    const { interaction, em, ctx } = createHarness()
    const original = { ...interaction }
    await expect(handler('activities.update').execute(updateInput(changes), ctx)).rejects.toMatchObject({ status: 404 })
    expect(interaction).toEqual(original)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it.each(['update', 'complete', 'cancel', 'delete'])('blocks undo of %s after an email becomes inaccessible', async (operation) => {
    const { interaction, em, ctx } = createHarness()
    const original = { ...interaction }
    const snapshot = {
      interaction: { ...interaction, entityId: PERSON_ID, entityKind: 'person', visibility: 'shared' },
      custom: {},
    }
    await expect(handler(`interactions.${operation}`).undo!({
      input: {},
      ctx,
      logEntry: { commandPayload: { undo: { before: snapshot, after: snapshot } } } as never,
    })).rejects.toMatchObject({ status: 404 })
    expect(interaction).toEqual(original)
    expect(em.flush).not.toHaveBeenCalled()
    expect(emitCrudUndoSideEffects).not.toHaveBeenCalled()
  })

  it('blocks create undo after the email becomes inaccessible', async () => {
    const { em, ctx } = createHarness()
    await expect(handler('interactions.create').undo!({
      input: {},
      ctx,
      logEntry: { resourceId: INTERACTION_ID } as never,
    })).rejects.toMatchObject({ status: 404 })
    expect(em.remove).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('allows the original author to undo create', async () => {
    const { interaction, em, ctx } = createHarness(createInteraction(), { sub: AUTHOR_ID })
    await handler('interactions.create').undo!({
      input: {},
      ctx,
      logEntry: { resourceId: INTERACTION_ID } as never,
    })
    expect(em.remove).toHaveBeenCalledWith(interaction)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it.each(['undo delete', 'redo create'])('rejects %s restoring a historical private snapshot owned by someone else', async (operation) => {
    const { interaction, em, ctx } = createHarness()
    em.findOne.mockImplementation(async (entity, filters) => entity === CustomerInteraction
      ? null
      : { id: filters.id, kind: 'person', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID })
    const snapshot = historicalSnapshot(interaction)
    const command = handler(operation === 'undo delete' ? 'interactions.delete' : 'interactions.create')
    const replay = operation === 'undo delete' ? command.undo! : command.redo!
    await expect(replay({
      input: {},
      ctx,
      logEntry: { snapshotAfter: snapshot, commandPayload: { undo: { before: snapshot, after: snapshot } } } as never,
    })).rejects.toMatchObject({ status: 404 })
    expect(em.create).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('allows the author to redo create from a historical snapshot without channelId', async () => {
    const { interaction, em, ctx } = createHarness(createInteraction(), { sub: AUTHOR_ID })
    em.findOne.mockImplementation(async (entity, filters) => entity === CustomerInteraction
      ? null
      : { id: filters.id, kind: 'person', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID })
    const snapshot = historicalSnapshot(interaction)
    await handler('interactions.create').redo!({
      input: {},
      ctx,
      logEntry: { snapshotAfter: snapshot } as never,
    })
    expect(em.create).toHaveBeenCalledWith(CustomerInteraction, expect.objectContaining({
      id: INTERACTION_ID,
      body: 'Confidential content',
      authorUserId: AUTHOR_ID,
      visibility: 'private',
    }))
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['author', { authorUserId: VIEWER_ID }],
    ['type', { interactionType: 'note' }],
    ['visibility', { visibility: 'private' }],
  ])('keeps %s changes owner-only during shared-email restore', async (_name, changes) => {
    const { interaction, em, ctx } = createHarness(createInteraction({ visibility: 'shared' }))
    const snapshot = historicalSnapshot(interaction, changes)
    await expect(handler('interactions.update').undo!({
      input: {},
      ctx,
      logEntry: { commandPayload: { undo: { before: snapshot } } } as never,
    })).rejects.toMatchObject({ status: 404 })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects restoring a private email over a currently readable note', async () => {
    const { interaction, em, ctx } = createHarness(createInteraction({ interactionType: 'note' }))
    const snapshot = historicalSnapshot(interaction, { interactionType: 'email' })
    await expect(handler('interactions.update').undo!({
      input: {},
      ctx,
      logEntry: { commandPayload: { undo: { before: snapshot } } } as never,
    })).rejects.toMatchObject({ status: 404 })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it.each(['shared', 'conversation'])('keeps a historical visibility restore owner-only for %s email', async (sharing) => {
    const visibility = sharing === 'shared' ? 'shared' : 'private'
    const { interaction, em, ctx } = createHarness(createInteraction({ visibility }))
    if (sharing === 'conversation') {
      jest.mocked(listGrantsForViewerOnPerson).mockResolvedValue([{ personEntityId: PERSON_ID, ownerUserId: AUTHOR_ID }])
    }
    const snapshot = historicalSnapshot(interaction)
    delete snapshot.interaction.visibility
    await expect(handler('interactions.update').undo!({
      input: {},
      ctx,
      logEntry: { commandPayload: { undo: { before: snapshot } } } as never,
    })).rejects.toMatchObject({ status: 404 })
    expect(interaction.visibility).toBe(visibility)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('allows the author to restore a historical snapshot without visibility', async () => {
    const { interaction, em, ctx } = createHarness(createInteraction(), { sub: AUTHOR_ID })
    const snapshot = historicalSnapshot(interaction)
    delete snapshot.interaction.visibility
    await handler('interactions.update').undo!({
      input: {},
      ctx,
      logEntry: { commandPayload: { undo: { before: snapshot } } } as never,
    })
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})
