import { evaluateVisitAvailability, visitAvailabilityInputSchema, visitAvailabilityWarnings } from '../visitAvailability'
import { visitAvailabilityInterceptors } from '../visitAvailabilityGuard'
import { getEnabledModuleIds, hasEnabledModulesRegistry } from '@open-mercato/shared/security/enabledModulesRegistry'
import type { CalendarEventTypeBehavior } from '@open-mercato/core/modules/customers/calendar-event-types'

jest.mock('@open-mercato/shared/security/enabledModulesRegistry', () => ({
  getEnabledModuleIds: jest.fn(() => ['customers', 'example', 'staff', 'resources', 'planner']),
  hasEnabledModulesRegistry: jest.fn(() => true),
}))

const USER_ID = '11111111-1111-4111-8111-111111111111'
const MEMBER_ID = '22222222-2222-4222-8222-222222222222'
const RESOURCE_ID = '33333333-3333-4333-8333-333333333333'
const RULE_ID = '44444444-4444-4444-8444-444444444444'
const scope = { tenantId: 'tenant', organizationId: 'organization' }
const input = {
  startAt: '2026-10-05T09:30:00.000Z',
  endAt: '2026-10-05T10:30:00.000Z',
  staffUserIds: [USER_ID],
  resourceIds: [RESOURCE_ID],
}

const visitBehavior: CalendarEventTypeBehavior = {
  schemaVersion: 1,
  baseKind: 'event',
  selectable: true,
  order: 450,
  fields: { endTime: true, allDay: false, recurrence: false, location: 'location', people: 'recipients', priority: false, resources: true },
  customFieldsetIds: [],
}

function setup(overrides: {
  inactive?: boolean; noRules?: boolean; denied?: boolean; gap?: boolean; nonUtc?: boolean; invalidZone?: boolean
  behavior?: CalendarEventTypeBehavior
  existingType?: string
  existingParticipants?: unknown[]
  existingLinks?: unknown[]
  recordOrganizationId?: string
  allowedOrganizationIds?: string[]
  missingRecord?: boolean
} = {}) {
  const query = jest.fn(async (entity: string, options: { tenantId: string; organizationId?: string; organizationIds?: string[] }) => {
    expect(options.tenantId).toBe(scope.tenantId)
    if (entity.startsWith('customers:')) expect(options.organizationIds).toEqual(overrides.allowedOrganizationIds ?? [scope.organizationId])
    else expect(options.organizationId).toBe(overrides.recordOrganizationId ?? scope.organizationId)
    if (entity === 'staff:staff_team_member') return { items: overrides.inactive ? [] : [{ id: MEMBER_ID, user_id: USER_ID, is_active: true, availability_rule_set_id: RULE_ID }], total: overrides.inactive ? 0 : 1 }
    if (entity === 'resources:resources_resource') return { items: [{ id: RESOURCE_ID, is_active: true }], total: 1 }
    if (entity === 'planner:planner_availability_rule_set') return { items: [{ id: RULE_ID }], total: 1 }
    if (entity === 'planner:planner_availability_rule') return { items: overrides.noRules ? [] : [{ id: RULE_ID, rrule: 'DTSTART:20261005T090000Z\nRRULE:FREQ=WEEKLY\nDURATION:PT2H', kind: 'availability', timezone: overrides.invalidZone ? 'Mars/Olympus' : overrides.nonUtc ? 'Europe/Warsaw' : 'UTC' }], total: overrides.noRules ? 0 : 1 }
    if (entity.startsWith('customers:') && (overrides.missingRecord || !options.organizationIds?.includes(overrides.recordOrganizationId ?? scope.organizationId))) return { items: [], total: 0 }
    if (entity === 'customers:customer_entity') return { items: [{ id: RULE_ID, organization_id: overrides.recordOrganizationId ?? scope.organizationId }], total: 1 }
    if (entity === 'customers:customer_interaction') return { items: [{ id: RULE_ID, organization_id: overrides.recordOrganizationId ?? scope.organizationId, interaction_type: overrides.existingType ?? 'visit', scheduled_at: input.startAt, duration_minutes: 60, participants: overrides.existingParticipants ?? [{ userId: USER_ID }], linked_entities: overrides.existingLinks ?? [], updated_at: '2026-09-29T12:00:00.000Z' }], total: 1 }
    throw new Error('unexpected entity')
  })
  const planner = { getMergedAvailabilityWindows: jest.fn(() => overrides.gap ? [] : [{ start: new Date('2026-10-05T09:00:00.000Z'), end: new Date('2026-10-05T11:00:00.000Z') }]) }
  const rbac = { userHasAllFeatures: jest.fn(async () => !overrides.denied) }
  const catalog = { resolveBehavior: jest.fn(async () => overrides.behavior ?? visitBehavior) }
  const services: Record<string, unknown> = { queryEngine: { query }, plannerAvailabilityService: planner, rbacService: rbac, calendarEventTypeCatalogService: catalog }
  const container = { hasRegistration: (name: string) => name in services, resolve: (name: string) => services[name] }
  return { container, query, planner, rbac, catalog }
}

describe('Visit availability', () => {
  beforeEach(() => {
    jest.mocked(getEnabledModuleIds).mockReturnValue(['customers', 'example', 'staff', 'resources', 'planner'])
    jest.mocked(hasEnabledModulesRegistry).mockReturnValue(true)
  })
  it('maps users to active member IDs and checks a complete half-open interval', async () => {
    const { container, query, planner } = setup()
    const subjects = await evaluateVisitAvailability({ container: container as never, actorUserId: USER_ID, scope, input })
    expect(subjects.map((subject) => subject.status)).toEqual(['available', 'available'])
    expect(query).toHaveBeenCalledWith('staff:staff_team_member', expect.objectContaining({ filters: { user_id: { $in: [USER_ID] }, is_active: true } }))
    expect(query).toHaveBeenCalledWith('planner:planner_availability_rule', expect.objectContaining({ filters: { $or: expect.arrayContaining([{ subject_type: 'member', subject_id: MEMBER_ID }, { subject_type: 'ruleset', subject_id: RULE_ID }]) } }))
    expect(planner.getMergedAvailabilityWindows).toHaveBeenCalledWith(expect.objectContaining({ range: { start: new Date(input.startAt), end: new Date(input.endAt) } }))
  })

  it('accepts a resolver-only worker container for a non-visit update', async () => {
    const { container, query } = setup({ existingType: 'task' })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.update')!
    const result = await interceptor.beforeExecute!({ id: RULE_ID, title: 'Synced task' }, {
      commandId: 'customers.interactions.update', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId, container: { resolve: container.resolve } as never,
    })
    expect(result).toMatchObject({ ok: true })
    expect(query).not.toHaveBeenCalled()
  })

  it('fails closed for uncovered intervals and missing rules', async () => {
    for (const mode of [{ gap: true }, { noRules: true }]) {
      const { container } = setup(mode)
      const subjects = await evaluateVisitAvailability({ container: container as never, actorUserId: USER_ID, scope, input })
      expect(subjects.some((subject) => subject.status !== 'available')).toBe(true)
    }
  })

  it('fails closed for a selected staff user without an active member mapping', async () => {
    const { container } = setup({ inactive: true })
    const subjects = await evaluateVisitAvailability({ container: container as never, actorUserId: USER_ID, scope, input })
    expect(subjects).toEqual([
      { type: 'staff', id: USER_ID, status: 'unavailable', reasonKey: 'example.calendar.visitAvailability.inactiveSubject' },
      { type: 'resource', id: RESOURCE_ID, status: 'available', reasonKey: null },
    ])
  })

  it('does not require a staff schedule for a customer recipient in editor or wire format', async () => {
    for (const participant of [{ userId: USER_ID, isCustomer: true }, { userId: USER_ID, status: 'customer' }]) {
      const { container, query } = setup({ inactive: true })
      const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.create')!
      const result = await interceptor.beforeExecute!({
        interactionType: 'visit', entityId: RULE_ID, scheduledAt: input.startAt, durationMinutes: 60,
        participants: [participant],
      }, {
        commandId: 'customers.interactions.create', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
        selectedOrganizationId: scope.organizationId, container: container as never,
      })
      expect(result).toMatchObject({ ok: true })
      expect(query).toHaveBeenCalledTimes(1)
      expect(query).toHaveBeenCalledWith('customers:customer_entity', expect.anything())
    }
  })

  it('returns unknown when source permissions are absent', async () => {
    const { container, query } = setup({ denied: true })
    const subjects = await evaluateVisitAvailability({ container: container as never, actorUserId: USER_ID, scope, input })
    expect(subjects.map((subject) => subject.status)).toEqual(['unknown', 'unknown'])
    expect(query).not.toHaveBeenCalled()
  })

  it('passes zoned rules to planner availability expansion', async () => {
    const { container, planner } = setup({ nonUtc: true })
    const subjects = await evaluateVisitAvailability({ container: container as never, actorUserId: USER_ID, scope, input })
    expect(subjects.map((subject) => subject.status)).toEqual(['available', 'available'])
    expect(planner.getMergedAvailabilityWindows).toHaveBeenCalledWith(expect.objectContaining({
      rules: expect.arrayContaining([expect.objectContaining({ timezone: 'Europe/Warsaw' })]),
    }))
  })

  it('returns unknown for an invalid rule timezone without invoking planner expansion', async () => {
    const { container, planner } = setup({ invalidZone: true })
    const subjects = await evaluateVisitAvailability({ container: container as never, actorUserId: USER_ID, scope, input })
    expect(subjects.map((subject) => subject.status)).toEqual(['unknown', 'unknown'])
    expect(planner.getMergedAvailabilityWindows).not.toHaveBeenCalled()
  })

  it.each([true, false])('fails closed for an unavailable service with registry present: %s', async (registryAvailable) => {
    jest.mocked(hasEnabledModulesRegistry).mockReturnValue(registryAvailable)
    const { container, query } = setup()
    const resolve = (name: string) => name === 'plannerAvailabilityService' ? undefined : container.resolve(name)
    const missingServiceContainer = { resolve } as never
    const subjects = await evaluateVisitAvailability({ container: missingServiceContainer, actorUserId: USER_ID, scope, input })
    expect(subjects.map((subject) => subject.status)).toEqual(['unknown', 'unknown'])
    expect(query).not.toHaveBeenCalled()
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.create')!
    expect(await interceptor.beforeExecute!({ interactionType: 'visit', entityId: RULE_ID, scheduledAt: input.startAt, durationMinutes: 60,
      participants: [{ userId: USER_ID }],
    }, { commandId: 'customers.interactions.create', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId, container: missingServiceContainer,
    })).toMatchObject({ ok: false, status: 503 })
  })

  it('validates bounded IDs and interval', () => {
    expect(visitAvailabilityInputSchema.safeParse({ ...input, endAt: input.startAt }).success).toBe(false)
    expect(visitAvailabilityInputSchema.safeParse({ ...input, staffUserIds: [USER_ID, USER_ID] }).success).toBe(false)
    expect(visitAvailabilityInputSchema.safeParse({ ...input, resourceIds: Array(21).fill(RESOURCE_ID) }).success).toBe(false)
  })

  it('blocks direct create writes when a selected resource is unavailable', async () => {
    const { container } = setup({ gap: true })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.create')!
    const result = await interceptor.beforeExecute!({ interactionType: 'visit', entityId: RULE_ID, scheduledAt: input.startAt, durationMinutes: 60, linkedEntities: [{ type: 'resource', id: RESOURCE_ID }] }, {
      commandId: 'customers.interactions.create', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId, container: container as never,
    })
    expect(result).toMatchObject({ ok: false, status: 422 })
  })

  it('checks persisted selections on a direct update', async () => {
    const { container, query, catalog } = setup({ gap: true })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.update')!
    const result = await interceptor.beforeExecute!({ id: RULE_ID, durationMinutes: 61 }, {
      commandId: 'customers.interactions.update', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId, container: container as never,
    })
    expect(result).toMatchObject({ ok: false, status: 422 })
    expect(query).toHaveBeenCalledWith('customers:customer_interaction', expect.objectContaining({ tenantId: scope.tenantId, organizationIds: [scope.organizationId] }))
    expect(catalog.resolveBehavior).toHaveBeenCalledWith({ tenantId: scope.tenantId, organizationId: scope.organizationId, key: 'visit' })
  })

  it('preserves hidden persisted assignments without availability lookups', async () => {
    const { container, query, planner } = setup({
      gap: true,
      existingLinks: [{ type: 'resource', id: RESOURCE_ID }],
      behavior: { ...visitBehavior, fields: { ...visitBehavior.fields, people: 'none', resources: false } },
    })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.update')!
    const result = await interceptor.beforeExecute!({ id: RULE_ID, title: 'Rename only' }, {
      commandId: 'customers.interactions.update', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId, container: container as never,
    })
    expect(result).toMatchObject({ ok: true })
    expect(query).not.toHaveBeenCalled()
    expect(planner.getMergedAvailabilityWindows).not.toHaveBeenCalled()
  })

  it('skips both saved and new assignments when optional peers are absent', async () => {
    jest.mocked(getEnabledModuleIds).mockReturnValue(['customers', 'example'])
    const { container, query } = setup({ gap: true, existingLinks: [{ type: 'resource', id: RESOURCE_ID }] })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.update')!
    const context = {
      commandId: 'customers.interactions.update', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId, container: container as never,
    }
    expect(await interceptor.beforeExecute!({ id: RULE_ID, title: 'Rename only' }, context)).toMatchObject({ ok: true })
    expect(query).not.toHaveBeenCalled()
    const extraResourceId = '55555555-5555-4555-8555-555555555555'
    expect(await interceptor.beforeExecute!({ id: RULE_ID, linkedEntities: [
      { type: 'resource', id: RESOURCE_ID }, { type: 'resource', id: extraResourceId },
    ] }, context)).toMatchObject({ ok: true })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['staff', ['customers', 'example', 'resources', 'planner'], 'resource'],
    ['resources', ['customers', 'example', 'staff', 'planner'], 'staff'],
    ['planner', ['customers', 'example', 'staff', 'resources'], null],
  ])('skips queries for absent %s while checking enabled sources', async (missing, enabled, expectedType) => {
    jest.mocked(getEnabledModuleIds).mockReturnValue(enabled as string[])
    const { container, query } = setup()
    const subjects = await evaluateVisitAvailability({ container: container as never, actorUserId: USER_ID, scope, input })
    expect(subjects.map((subject) => subject.type)).toEqual(expectedType ? [expectedType] : [])
    expect(visitAvailabilityWarnings()).toEqual([`example.calendar.visitAvailability.${missing}Disabled`])
    expect(query).not.toHaveBeenCalledWith(missing === 'staff' ? 'staff:staff_team_member' : 'resources:resources_resource', expect.anything())
  })

  it('permits creating a visit with optional modules absent', async () => {
    jest.mocked(getEnabledModuleIds).mockReturnValue(['customers', 'example'])
    const { container, query } = setup({ gap: true })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.create')!
    expect(await interceptor.beforeExecute!({ interactionType: 'visit', entityId: RULE_ID, scheduledAt: input.startAt, durationMinutes: 60,
      participants: [{ userId: USER_ID }], linkedEntities: [{ type: 'resource', id: RESOURCE_ID }],
    }, { commandId: 'customers.interactions.create', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId, container: container as never,
    })).toMatchObject({ ok: true })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('keeps availability failures blocking when an optional module is enabled', async () => {
    jest.mocked(getEnabledModuleIds).mockReturnValue(['customers', 'example', 'staff', 'planner'])
    const { container } = setup({ denied: true })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.create')!
    expect(await interceptor.beforeExecute!({ interactionType: 'visit', entityId: RULE_ID, scheduledAt: input.startAt, durationMinutes: 60,
      participants: [{ userId: USER_ID }],
    }, { commandId: 'customers.interactions.create', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId, container: container as never,
    })).toMatchObject({ ok: false, status: 503, body: { fields: ['participants'] } })
  })

  it.each(['customers.interactions.create', 'customers.interactions.update'])('checks the record organization for %s from an allowed parent selection', async (commandId) => {
    const childOrganizationId = 'child-organization'
    const allowedIds = [scope.organizationId, childOrganizationId]
    const { container, query, catalog } = setup({ recordOrganizationId: childOrganizationId, allowedOrganizationIds: allowedIds, gap: true })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === commandId)!
    const request = commandId.endsWith('update')
      ? { id: RULE_ID, durationMinutes: 61 }
      : { entityId: RULE_ID, interactionType: 'visit', scheduledAt: input.startAt, durationMinutes: 60, participants: [{ userId: USER_ID }] }
    expect(await interceptor.beforeExecute!(request, {
      commandId, auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId,
      organizationScope: { tenantId: scope.tenantId, selectedId: scope.organizationId, allowedIds, filterIds: allowedIds },
      container: container as never,
    })).toMatchObject({ ok: false, status: 422 })
    expect(catalog.resolveBehavior).toHaveBeenCalledWith({ tenantId: scope.tenantId, organizationId: childOrganizationId, key: 'visit' })
    expect(query).toHaveBeenCalledWith('staff:staff_team_member', expect.objectContaining({ tenantId: scope.tenantId, organizationId: childOrganizationId }))
  })

  it.each(['customers.interactions.create', 'customers.interactions.update'])('does not bypass unavailable records on %s', async (commandId) => {
    const { container, planner } = setup({ missingRecord: true })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === commandId)!
    expect(await interceptor.beforeExecute!({ id: RULE_ID, entityId: RULE_ID, interactionType: 'visit',
      scheduledAt: input.startAt, durationMinutes: 61, participants: [{ userId: USER_ID }],
    }, { commandId, auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId, container: container as never,
    })).toMatchObject({ ok: false, status: 404 })
    expect(planner.getMergedAvailabilityWindows).not.toHaveBeenCalled()
  })

  it('rejects a record outside the authorized organizations even if a query provider returns it', async () => {
    const { container, query, planner } = setup()
    query.mockResolvedValueOnce({ items: [{ id: RULE_ID, organization_id: 'forbidden-org', interaction_type: 'visit' }], total: 1 })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.update')!
    expect(await interceptor.beforeExecute!({ id: RULE_ID, durationMinutes: 61 }, {
      commandId: 'customers.interactions.update', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId,
      organizationScope: { tenantId: scope.tenantId, selectedId: scope.organizationId, allowedIds: [scope.organizationId], filterIds: [scope.organizationId] },
      container: container as never,
    })).toMatchObject({ ok: false, status: 403 })
    expect(planner.getMergedAvailabilityWindows).not.toHaveBeenCalled()
  })

  it('rejects a scope from a different tenant before querying', async () => {
    const { container, query } = setup()
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.update')!
    expect(await interceptor.beforeExecute!({ id: RULE_ID, durationMinutes: 61 }, {
      commandId: 'customers.interactions.update', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId,
      organizationScope: { tenantId: 'other-tenant', selectedId: scope.organizationId, allowedIds: [scope.organizationId], filterIds: [scope.organizationId] },
      container: container as never,
    })).toMatchObject({ ok: false, status: 403 })
    expect(query).not.toHaveBeenCalled()
  })

  it('skips title-only Visit edits even when the staff mapping was removed', async () => {
    const { container, query } = setup({ inactive: true })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.update')!
    expect(await interceptor.beforeExecute!({ id: RULE_ID, title: 'Updated title' }, {
      commandId: 'customers.interactions.update', auth: null, selectedOrganizationId: null, container: container as never,
    })).toEqual({ ok: true })
    expect(query).not.toHaveBeenCalled()
  })

  it.each(['customers.interactions.create', 'customers.interactions.update'])('skips explicit non-Visit %s before scope and broken services', async (commandId) => {
    const resolve = jest.fn(() => { throw new Error('unavailable') })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === commandId)!
    expect(await interceptor.beforeExecute!({ interactionType: 'task', scheduledAt: input.startAt, durationMinutes: 60 }, {
      commandId, auth: null, selectedOrganizationId: null, container: { resolve } as never,
    })).toEqual({ ok: true })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('skips unchanged scheduling fields in an existing Visit', async () => {
    const { container, query, planner } = setup({ inactive: true })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.update')!
    expect(await interceptor.beforeExecute!({ id: RULE_ID, scheduledAt: input.startAt, durationMinutes: 60,
      participants: [{ userId: USER_ID, name: 'Updated name' }], linkedEntities: [],
    }, { commandId: 'customers.interactions.update', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId, container: container as never,
    })).toEqual({ ok: true })
    expect(query).toHaveBeenCalledTimes(1)
    expect(planner.getMergedAvailabilityWindows).not.toHaveBeenCalled()
  })

  it('returns an optimistic-lock conflict before looking up availability on a stale update', async () => {
    const { container, query, planner } = setup()
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.update')!
    await expect(interceptor.beforeExecute!({ id: RULE_ID, durationMinutes: 61 }, {
      commandId: 'customers.interactions.update', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId, container: container as never,
      request: new Request('http://localhost/api/customers/interactions', {
        headers: { 'x-om-ext-optimistic-lock-expected-updated-at': '2026-09-29T11:00:00.000Z' },
      }),
    })).rejects.toMatchObject({ status: 409, body: { code: 'optimistic_lock_conflict' } })
    expect(query).toHaveBeenCalledTimes(1)
    expect(planner.getMergedAvailabilityWindows).not.toHaveBeenCalled()
  })
})
