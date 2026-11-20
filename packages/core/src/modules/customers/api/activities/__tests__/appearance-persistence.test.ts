import { asValue, createContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { CrudMutationGuardValidateInput, CrudMutationGuardValidationResult } from '@open-mercato/shared/lib/crud/mutation-guard'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerInteraction } from '../../../data/entities'
import { calendarEventTypes } from '../../../calendar-event-types'
import { resolveCustomersRequestContext } from '../../../lib/interactionRequestContext'
import { recomputeNextInteraction } from '../../../lib/interactionProjection'
import '../../../commands/interactions'
import { PUT } from '../route'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: jest.fn(),
}))

jest.mock('../../../commands/shared', () => ({
  ...jest.requireActual('../../../commands/shared'),
  emitQueryIndexUpsertEvents: jest.fn(),
}))

jest.mock('../../../lib/interactionProjection', () => ({
  recomputeNextInteraction: jest.fn(async () => ({ nextInteractionId: null })),
}))

jest.mock('../../../lib/calendar/eventTypeResolver', () => ({
  resolveScopedCalendarEventTypes: jest.fn(async () => ({ items: calendarEventTypes })),
  resolveCatalogEventType: (catalog: { items: typeof calendarEventTypes }, key: string) =>
    catalog.items.find((item) => item.key === key),
}))

jest.mock('../../../lib/interactionFeatureFlags', () => ({
  resolveCustomerInteractionFeatureFlags: jest.fn(async () => ({ unified: true, legacyAdapters: true })),
}))

jest.mock('../../../lib/interactionRequestContext', () => ({
  resolveCustomersRequestContext: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => key === 'customers.activities.errors.timeRequiresDate'
      ? 'Podaj prawidłową datę przy zmianie godziny.'
      : fallback ?? key,
  }),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const ENTITY_ID = '33333333-3333-4333-8333-333333333333'
const INTERACTION_ID = '44444444-4444-4444-8444-444444444444'

function setupPersistence() {
  let stored = {
    id: INTERACTION_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    entity: { id: ENTITY_ID },
    interactionType: 'note',
    scheduledAt: new Date('2026-11-01T12:00:00Z') as Date | null,
    timezone: 'Europe/Warsaw',
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    appearanceIcon: 'lucide:phone' as string | null,
    appearanceColor: '#123456' as string | null,
  }
  const managed = { ...stored }
  const em = {
    flush: jest.fn(async () => { stored = { ...managed } }),
    find: jest.fn(async () => []),
  }
  const dataEngine = { setCustomFields: jest.fn(async () => {}) }
  const validateMutation = jest.fn(async (_input: CrudMutationGuardValidateInput): Promise<CrudMutationGuardValidationResult> => ({
    ok: true,
    shouldRunAfterSuccess: true,
  }))
  const afterMutationSuccess = jest.fn(async () => {})
  const emitEvent = jest.fn(async () => {})
  jest.mocked(findOneWithDecryption).mockResolvedValue(managed as unknown as CustomerInteraction)
  const container = createContainer()
  const execute = jest.fn(async (commandId: string, options: { input: unknown; ctx: CommandRuntimeContext }) => {
    const command = commandRegistry.get(commandId)
    if (!command) throw new Error('[internal] Missing interaction command')
    return { result: await command.execute(options.input, options.ctx), logEntry: null }
  })
  container.register({
    em: asValue({ fork: jest.fn(() => em) }),
    commandBus: asValue({ execute }),
    dataEngine: asValue(dataEngine),
    eventBus: asValue({ emitEvent }),
    crudMutationGuardService: asValue({ validateMutation, afterMutationSuccess }),
    organizationHierarchyService: asValue({ resolveAncestorIds: async () => [] }),
  })
  const auth = { sub: ENTITY_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID }
  const commandContext: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: null,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
  }
  jest.mocked(resolveCustomersRequestContext).mockImplementation(async (request) => ({
    commandContext: { ...commandContext, request },
    container,
    em: em as unknown as Awaited<ReturnType<typeof resolveCustomersRequestContext>>['em'],
    auth,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
    scope: { selectedId: ORGANIZATION_ID, filterIds: [ORGANIZATION_ID], allowedIds: [ORGANIZATION_ID], tenantId: TENANT_ID },
  }))
  return { em, execute, dataEngine, validateMutation, afterMutationSuccess, emitEvent, read: () => ({ ...stored }) }
}

describe('activity writes reach canonical interaction persistence', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each([
    { appearanceIcon: null, appearanceColor: null },
    { appearance_icon: null, appearance_color: null },
    { appearanceIcon: null },
    { appearance_icon: null },
    { appearanceColor: null },
    { appearance_color: null },
    { body: 'Appearance omitted' },
    { appearanceIcon: 'lucide:star', appearanceColor: '#654321' },
    { appearance_icon: 'lucide:star', appearance_color: '#654321' },
  ])('persists the supplied fields and retains omitted appearance: %j', async (fields) => {
    const { em, execute, read } = setupPersistence()
    const response = await PUT(new Request('http://localhost/api/customers/activities', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: INTERACTION_ID, ...fields }),
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(execute).toHaveBeenCalledWith('customers.interactions.update', expect.anything())
    expect(findOneWithDecryption).toHaveBeenCalledWith(em, CustomerInteraction, { id: INTERACTION_ID, deletedAt: null })
    expect(em.flush).toHaveBeenCalledTimes(1)
    const supplied = fields as Record<string, unknown>
    const expected = (camel: string, snake: string, previous: string) =>
      Object.hasOwn(supplied, camel) ? supplied[camel] : Object.hasOwn(supplied, snake) ? supplied[snake] : previous
    expect(read()).toMatchObject({
      appearanceIcon: expected('appearanceIcon', 'appearance_icon', 'lucide:phone'),
      appearanceColor: expected('appearanceColor', 'appearance_color', '#123456'),
    })
  })

  it.each([
    { time: '10:30' },
    { time: '10:30', date: null },
    { time: '10:30', date: 'not-a-date' },
  ])('rejects a time without usable incoming date context before dispatch: %j', async (fields) => {
    const persistence = setupPersistence()
    const before = persistence.read()
    const response = await PUT(new Request('http://localhost/api/customers/activities', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: INTERACTION_ID, ...fields }),
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Validation failed',
      fieldErrors: { time: 'Podaj prawidłową datę przy zmianie godziny.' },
    })
    expect(response.headers.get('Deprecation')).toBe('true')
    expect(persistence.execute).not.toHaveBeenCalled()
    expect(persistence.em.flush).not.toHaveBeenCalled()
    expect(persistence.dataEngine.setCustomFields).not.toHaveBeenCalled()
    expect(persistence.validateMutation).not.toHaveBeenCalled()
    expect(persistence.afterMutationSuccess).not.toHaveBeenCalled()
    expect(persistence.emitEvent).not.toHaveBeenCalled()
    expect(findOneWithDecryption).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
    expect(recomputeNextInteraction).not.toHaveBeenCalled()
    expect(persistence.read()).toEqual(before)
  })

  it.each([
    [{ date: '2026-11-20', time: '10:30' }, new Date(2026, 10, 20, 10, 30)],
    [{ date: '2026-11-20' }, new Date(2026, 10, 20)],
    [{ date: null }, null],
    [{ body: 'No schedule change' }, new Date('2026-11-01T12:00:00Z')],
  ] as const)('persists supported schedule updates through the real command: %j', async (fields, expected) => {
    const persistence = setupPersistence()
    const response = await PUT(new Request('http://localhost/api/customers/activities', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: INTERACTION_ID, ...fields }),
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(persistence.execute).toHaveBeenCalledTimes(1)
    expect(persistence.em.flush).toHaveBeenCalledTimes(1)
    expect(persistence.read()).toMatchObject({ scheduledAt: expected, timezone: 'Europe/Warsaw' })
    expect(persistence.validateMutation).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      resourceKind: 'customers.activity',
      resourceId: INTERACTION_ID,
      operation: 'update',
    }))
    expect(persistence.afterMutationSuccess).toHaveBeenCalledTimes(1)
    expect(emitCrudSideEffects).toHaveBeenCalledTimes(1)
    expect(recomputeNextInteraction).toHaveBeenCalledTimes(1)
  })

  it('retains mutation guard rejection for a valid date and time', async () => {
    const persistence = setupPersistence()
    persistence.validateMutation.mockResolvedValueOnce({ ok: false, status: 409, body: { error: 'Guard rejected' } })
    const before = persistence.read()
    const response = await PUT(new Request('http://localhost/api/customers/activities', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: INTERACTION_ID, date: '2026-11-20', time: '10:30' }),
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Guard rejected' })
    expect(persistence.execute).not.toHaveBeenCalled()
    expect(persistence.em.flush).not.toHaveBeenCalled()
    expect(persistence.afterMutationSuccess).not.toHaveBeenCalled()
    expect(persistence.read()).toEqual(before)
  })

  it.each([{ phoneNumber: '+48 123 456 789' }, { phone_number: '+48 123 456 789' }])(
    'retains phone writes while time is omitted: %j', async (fields) => {
      const persistence = setupPersistence()
      const response = await PUT(new Request('http://localhost/api/customers/activities', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: INTERACTION_ID, ...fields }),
      }))
      expect(response.status).toBe(200)
      expect(persistence.dataEngine.setCustomFields).toHaveBeenCalledWith(expect.objectContaining({
        recordId: INTERACTION_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        values: { callPhoneNumber: '+48 123 456 789' },
      }))
      expect(persistence.read().scheduledAt).toEqual(new Date('2026-11-01T12:00:00Z'))
    },
  )
})
