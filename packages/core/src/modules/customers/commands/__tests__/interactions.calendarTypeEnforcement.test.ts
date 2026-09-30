const registeredCommands = new Map<string, { execute: (input: unknown, context: unknown) => Promise<unknown> }>()
jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: (command: { id: string; execute: (input: unknown, context: unknown) => Promise<unknown> }) => {
    registeredCommands.set(command.id, command)
  },
}))

const resolveScopedCalendarEventTypesMock = jest.fn()
jest.mock('../../lib/calendar/eventTypeResolver', () => ({
  resolveScopedCalendarEventTypes: (...args: unknown[]) => resolveScopedCalendarEventTypesMock(...args),
  resolveCatalogEventType: (catalog: { items: Array<{ key: string }> }, key: string) =>
    catalog.items.find((item) => item.key === key),
}))

const findOneWithDecryptionMock = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

const loadCustomFieldDefinitionIndexMock = jest.fn()
jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/custom-fields'),
  loadCustomFieldDefinitionIndex: (...args: unknown[]) => loadCustomFieldDefinitionIndexMock(...args),
}))

const loadCustomFieldSnapshotMock = jest.fn()
jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots'),
  loadCustomFieldSnapshot: (...args: unknown[]) => loadCustomFieldSnapshotMock(...args),
}))

const setCustomFieldsIfAnyMock = jest.fn()
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  setCustomFieldsIfAny: (...args: unknown[]) => setCustomFieldsIfAnyMock(...args),
  emitCrudSideEffects: jest.fn(),
}))

const lockMock = jest.fn()
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceRecordGoneIsConflict: jest.fn(),
  enforceCommandOptimisticLockWithGuards: (...args: unknown[]) => lockMock(...args),
}))

jest.mock('../shared', () => ({
  ensureOrganizationScope: jest.fn(),
  ensureTenantScope: jest.fn(),
  requireTimelineParentEntity: jest.fn(async () => ({ id: ENTITY, tenantId: TENANT, organizationId: ORG, kind: 'person' })),
  requireDealInScope: jest.fn(),
  extractUndoPayload: jest.fn(),
  emitQueryIndexUpsertEvents: jest.fn(),
  resolveParentResourceKind: jest.fn(),
}))

jest.mock('../../lib/interactionProjection', () => ({
  recomputeNextInteraction: jest.fn(async () => ({ nextInteractionId: null })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

import { calendarEventTypes } from '../../calendar-event-types'
import '../interactions'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ENTITY = '33333333-3333-4333-8333-333333333333'
const INTERACTION = '44444444-4444-4444-8444-444444444444'
const NEW_DEAL = '55555555-5555-4555-8555-555555555555'

const note = calendarEventTypes.find((type) => type.key === 'note')!
const noteBehavior = { ...note.behavior, customFieldsetIds: ['note-only'], fields: { ...note.behavior.fields, resources: false } }

function makeContext() {
  const interaction = {
    id: INTERACTION,
    tenantId: TENANT,
    organizationId: ORG,
    entity: { id: ENTITY },
    interactionType: 'meeting',
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    durationMinutes: 30,
    location: 'Office',
    linkedEntities: [{ type: 'resource', id: 'room', label: 'Room' }, { type: 'deal', id: 'deal', label: 'Deal' }],
    participants: null,
    priority: null,
    recurrenceRule: null,
    recurrenceEnd: null,
    allDay: null,
  }
  const em = { fork: () => em, flush: jest.fn(async () => {}), create: jest.fn((_entity: unknown, values: Record<string, unknown>) => ({ ...values, id: INTERACTION })), persist: jest.fn(), getReference: jest.fn((_entity: unknown, id: string) => ({ id })) }
  const context = {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'organizationHierarchyService') return { resolveAncestorIds: async () => [] }
        if (token === 'dataEngine') return { setCustomFields: jest.fn() }
        if (token === 'eventBus') return { emitEvent: async () => {} }
        throw new Error(`Unexpected dependency ${token}`)
      },
    },
    auth: { tenantId: TENANT, orgId: ORG, sub: 'actor' },
    selectedOrganizationId: ORG,
    request: new Request('http://localhost/api/customers/interactions'),
  }
  return { interaction, em, context }
}

beforeEach(() => {
  jest.clearAllMocks()
  resolveScopedCalendarEventTypesMock.mockResolvedValue({
    items: [{ key: 'meeting', selectable: true, behavior: calendarEventTypes[0]!.behavior }, { key: 'note', selectable: true, behavior: noteBehavior }],
  })
  loadCustomFieldDefinitionIndexMock.mockImplementation(async (options: { fieldset?: string[] }) =>
    options.fieldset ? new Map() : new Map([['outcome', []]]))
  loadCustomFieldSnapshotMock.mockResolvedValue({ outcome: 'Visited' })
  lockMock.mockResolvedValue(undefined)
})

describe('interaction calendar-type command enforcement', () => {
  it.each(['call', 'task'])('accepts legacy %s duration on create and same-type update', async (key) => {
    const type = calendarEventTypes.find((type) => type.key === key)!
    resolveScopedCalendarEventTypesMock.mockResolvedValue({ items: [{ ...type, selectable: true }] })
    const { interaction, context } = makeContext()
    const create = registeredCommands.get('customers.interactions.create')!
    await expect(create.execute({ tenantId: TENANT, organizationId: ORG, entityId: ENTITY, interactionType: key, durationMinutes: 45 }, context)).resolves.toMatchObject({ interactionId: INTERACTION })
    interaction.interactionType = key
    findOneWithDecryptionMock.mockResolvedValue(interaction)
    await registeredCommands.get('customers.interactions.update')!.execute({ id: INTERACTION, durationMinutes: 60 }, context)
    expect(interaction.durationMinutes).toBe(60)
  })

  it('keeps configured hidden task behavior and permits internal task writes', async () => {
    const task = calendarEventTypes.find((type) => type.key === 'task')!
    resolveScopedCalendarEventTypesMock.mockResolvedValue({ items: [{ ...task, selectable: false }] })
    const { interaction, context } = makeContext()
    const create = registeredCommands.get('customers.interactions.create')!
    const input = { tenantId: TENANT, organizationId: ORG, entityId: ENTITY, interactionType: 'task', priority: 90 }
    await expect(create.execute({ ...input, enforceSelectableType: true }, context)).rejects.toMatchObject({ status: 400, body: { code: 'activity_type_unavailable' } })
    await expect(create.execute(input, context)).resolves.toMatchObject({ interactionId: INTERACTION })
    interaction.interactionType = 'task'
    findOneWithDecryptionMock.mockResolvedValue(interaction)
    await registeredCommands.get('customers.interactions.update')!.execute({ id: INTERACTION, priority: 10, enforceSelectableType: true }, context)
    expect(interaction.priority).toBe(10)
  })

  it('keeps custom field writes unrestricted when no fieldsets are configured', async () => {
    const { interaction, context } = makeContext()
    await registeredCommands.get('customers.interactions.create')!.execute({ tenantId: TENANT, organizationId: ORG, entityId: ENTITY, interactionType: 'meeting', cf_outcome: 'Created' }, context)
    expect(setCustomFieldsIfAnyMock).toHaveBeenCalledWith(expect.objectContaining({ values: { outcome: 'Created' } }))
    findOneWithDecryptionMock.mockResolvedValue(interaction)
    await registeredCommands.get('customers.interactions.update')!.execute({ id: INTERACTION, cf_outcome: 'Updated' }, context)
    expect(setCustomFieldsIfAnyMock).toHaveBeenLastCalledWith(expect.objectContaining({ values: { outcome: 'Updated' } }))
  })

  it.each(['customers.interactions.create', 'customers.interactions.update'])('returns retryable 503 for catalog failures in %s', async (id) => {
    const { interaction, em, context } = makeContext()
    findOneWithDecryptionMock.mockResolvedValue(interaction)
    resolveScopedCalendarEventTypesMock.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(registeredCommands.get(id)!.execute({ id: INTERACTION, tenantId: TENANT, organizationId: ORG, entityId: ENTITY, interactionType: 'meeting' }, context)).rejects.toMatchObject({ status: 503, body: { code: 'activity_type_catalog_unavailable', retryable: true } })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects an inapplicable create field before persisting', async () => {
    const { em, context } = makeContext()
    const command = registeredCommands.get('customers.interactions.create')!
    await expect(command.execute({ tenantId: TENANT, organizationId: ORG, entityId: ENTITY, interactionType: 'note', location: 'Office' }, context))
      .rejects.toMatchObject({ status: 400, body: { code: 'activity_type_field_not_applicable', fields: ['location'] } })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('checks the optimistic lock before exposing discard fields', async () => {
    const { interaction, context } = makeContext()
    findOneWithDecryptionMock.mockResolvedValue(interaction)
    lockMock.mockRejectedValueOnce({ status: 409, body: { code: 'optimistic_lock_conflict' } })
    const command = registeredCommands.get('customers.interactions.update')!
    await expect(command.execute({ id: INTERACTION, interactionType: 'note' }, context))
      .rejects.toMatchObject({ body: { code: 'optimistic_lock_conflict' } })
    expect(resolveScopedCalendarEventTypesMock).not.toHaveBeenCalled()
  })

  it('rejects an unavailable new key but keeps hidden values on a same-type edit', async () => {
    const { interaction, context } = makeContext()
    interaction.interactionType = 'note'
    findOneWithDecryptionMock.mockResolvedValue(interaction)
    const command = registeredCommands.get('customers.interactions.update')!
    await expect(command.execute({ id: INTERACTION, interactionType: 'missing', enforceSelectableType: true }, context))
      .rejects.toMatchObject({ status: 400, body: { code: 'activity_type_unavailable' } })
    await command.execute({
      id: INTERACTION,
      title: 'Updated title',
      location: null,
      durationMinutes: null,
      linkedEntities: [{ type: 'deal', id: NEW_DEAL, label: 'New deal' }],
      cf_outcome: null,
    }, context)
    expect(interaction).toMatchObject({
      interactionType: 'note', location: 'Office', durationMinutes: 30,
      linkedEntities: [{ type: 'deal', id: NEW_DEAL, label: 'New deal' }, { type: 'resource', id: 'room', label: 'Room' }],
    })
    expect(loadCustomFieldSnapshotMock).not.toHaveBeenCalled()
    expect(setCustomFieldsIfAnyMock).not.toHaveBeenCalled()
  })

  it('requires confirmation, then atomically clears only inapplicable values', async () => {
    const { interaction, em, context } = makeContext()
    findOneWithDecryptionMock.mockResolvedValue(interaction)
    const command = registeredCommands.get('customers.interactions.update')!
    await expect(command.execute({ id: INTERACTION, interactionType: 'note' }, context))
      .rejects.toMatchObject({
        status: 409,
        body: { code: 'calendar_type_change_confirmation_required', fields: ['durationMinutes', 'location', 'linkedEntities', 'cf_outcome'] },
      })
    expect(em.flush).not.toHaveBeenCalled()
    await command.execute({ id: INTERACTION, interactionType: 'note', confirmDiscardInapplicableValues: true }, context)
    expect(interaction).toMatchObject({
      interactionType: 'note', durationMinutes: null, location: null,
      linkedEntities: [{ type: 'deal', id: 'deal', label: 'Deal' }],
    })
    expect(setCustomFieldsIfAnyMock).toHaveBeenCalledWith(expect.objectContaining({ values: { outcome: null } }))
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('rolls back a confirmed switch when custom-field clearing fails', async () => {
    const { interaction, em, context } = makeContext()
    findOneWithDecryptionMock.mockResolvedValue(interaction)
    const transactionalEm = em as typeof em & {
      begin: jest.Mock
      commit: jest.Mock
      rollback: jest.Mock
    }
    transactionalEm.begin = jest.fn(async () => {})
    transactionalEm.commit = jest.fn(async () => {})
    transactionalEm.rollback = jest.fn(async () => {})
    setCustomFieldsIfAnyMock.mockRejectedValueOnce(new Error('custom write failed'))
    const command = registeredCommands.get('customers.interactions.update')!
    await expect(command.execute({ id: INTERACTION, interactionType: 'note', confirmDiscardInapplicableValues: true }, context))
      .rejects.toThrow('custom write failed')
    expect(transactionalEm.rollback).toHaveBeenCalledTimes(1)
    expect(transactionalEm.commit).not.toHaveBeenCalled()
  })
})
