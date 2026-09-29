import { evaluateVisitAvailability, visitAvailabilityInputSchema } from '../visitAvailability'
import { visitAvailabilityInterceptors } from '../visitAvailabilityGuard'
import { getEnabledModuleIds } from '@open-mercato/shared/security/enabledModulesRegistry'
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
  inactive?: boolean; noRules?: boolean; denied?: boolean; gap?: boolean; nonUtc?: boolean
  behavior?: CalendarEventTypeBehavior
  existingParticipants?: unknown[]
  existingLinks?: unknown[]
} = {}) {
  const query = jest.fn(async (entity: string, options: { tenantId: string; organizationId: string }) => {
    expect(options.tenantId).toBe(scope.tenantId)
    expect(options.organizationId).toBe(scope.organizationId)
    if (entity === 'staff:staff_team_member') return { items: overrides.inactive ? [] : [{ id: MEMBER_ID, user_id: USER_ID, is_active: true, availability_rule_set_id: RULE_ID }], total: overrides.inactive ? 0 : 1 }
    if (entity === 'resources:resources_resource') return { items: [{ id: RESOURCE_ID, is_active: true }], total: 1 }
    if (entity === 'planner:planner_availability_rule_set') return { items: [{ id: RULE_ID }], total: 1 }
    if (entity === 'planner:planner_availability_rule') return { items: overrides.noRules ? [] : [{ id: RULE_ID, rrule: 'DTSTART:20261005T090000Z\nRRULE:FREQ=WEEKLY\nDURATION:PT2H', kind: 'availability', timezone: overrides.nonUtc ? 'Europe/Warsaw' : 'UTC' }], total: overrides.noRules ? 0 : 1 }
    if (entity === 'customers:customer_interaction') return { items: [{ id: RULE_ID, interaction_type: 'visit', scheduled_at: input.startAt, duration_minutes: 60, participants: overrides.existingParticipants ?? [{ userId: USER_ID }], linked_entities: overrides.existingLinks ?? [], updated_at: '2026-09-29T12:00:00.000Z' }], total: 1 }
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
  })
  it('maps users to active member IDs and checks a complete half-open interval', async () => {
    const { container, query, planner } = setup()
    const subjects = await evaluateVisitAvailability({ container: container as never, actorUserId: USER_ID, scope, input })
    expect(subjects.map((subject) => subject.status)).toEqual(['available', 'available'])
    expect(query).toHaveBeenCalledWith('staff:staff_team_member', expect.objectContaining({ filters: { user_id: { $in: [USER_ID] }, is_active: true } }))
    expect(query).toHaveBeenCalledWith('planner:planner_availability_rule', expect.objectContaining({ filters: { $or: expect.arrayContaining([{ subject_type: 'member', subject_id: MEMBER_ID }, { subject_type: 'ruleset', subject_id: RULE_ID }]) } }))
    expect(planner.getMergedAvailabilityWindows).toHaveBeenCalledWith(expect.objectContaining({ range: { start: new Date(input.startAt), end: new Date(input.endAt) } }))
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
      { type: 'staff', id: USER_ID, status: 'unknown', reasonKey: 'example.calendar.visitAvailability.unknown' },
      { type: 'resource', id: RESOURCE_ID, status: 'available', reasonKey: null },
    ])
  })

  it('does not require a staff schedule for a customer recipient', async () => {
    const { container, query } = setup({ inactive: true })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.create')!
    const result = await interceptor.beforeExecute!({
      interactionType: 'visit', scheduledAt: input.startAt, durationMinutes: 60,
      participants: [{ userId: USER_ID, isCustomer: true }],
    }, {
      commandId: 'customers.interactions.create', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId, container: container as never,
    })
    expect(result).toMatchObject({ ok: true })
    expect(query).not.toHaveBeenCalled()
  })

  it('returns unknown when source permissions are absent', async () => {
    const { container, query } = setup({ denied: true })
    const subjects = await evaluateVisitAvailability({ container: container as never, actorUserId: USER_ID, scope, input })
    expect(subjects.map((subject) => subject.status)).toEqual(['unknown', 'unknown'])
    expect(query).not.toHaveBeenCalled()
  })

  it('does not claim availability for rules requiring unsupported zone expansion', async () => {
    const { container, planner } = setup({ nonUtc: true })
    const subjects = await evaluateVisitAvailability({ container: container as never, actorUserId: USER_ID, scope, input })
    expect(subjects.map((subject) => subject.status)).toEqual(['unknown', 'unknown'])
    expect(planner.getMergedAvailabilityWindows).not.toHaveBeenCalled()
  })

  it('validates bounded IDs and interval', () => {
    expect(visitAvailabilityInputSchema.safeParse({ ...input, endAt: input.startAt }).success).toBe(false)
    expect(visitAvailabilityInputSchema.safeParse({ ...input, staffUserIds: [USER_ID, USER_ID] }).success).toBe(false)
    expect(visitAvailabilityInputSchema.safeParse({ ...input, resourceIds: Array(21).fill(RESOURCE_ID) }).success).toBe(false)
  })

  it('blocks direct create writes when a selected resource is unavailable', async () => {
    const { container } = setup({ gap: true })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.create')!
    const result = await interceptor.beforeExecute!({ interactionType: 'visit', scheduledAt: input.startAt, durationMinutes: 60, linkedEntities: [{ type: 'resource', id: RESOURCE_ID }] }, {
      commandId: 'customers.interactions.create', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId, container: container as never,
    })
    expect(result).toMatchObject({ ok: false, status: 422 })
  })

  it('checks persisted selections on a direct update', async () => {
    const { container, query, catalog } = setup({ gap: true })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.update')!
    const result = await interceptor.beforeExecute!({ id: RULE_ID, title: 'Updated' }, {
      commandId: 'customers.interactions.update', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId, container: container as never,
    })
    expect(result).toMatchObject({ ok: false, status: 422 })
    expect(query).toHaveBeenCalledWith('customers:customer_interaction', expect.objectContaining({ tenantId: scope.tenantId, organizationId: scope.organizationId }))
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
    expect(query).toHaveBeenCalledTimes(1)
    expect(planner.getMergedAvailabilityWindows).not.toHaveBeenCalled()
  })

  it('skips saved assignments when peers are absent but rejects new applicable resources', async () => {
    jest.mocked(getEnabledModuleIds).mockReturnValue(['customers', 'example'])
    const { container, query } = setup({ gap: true, existingLinks: [{ type: 'resource', id: RESOURCE_ID }] })
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.update')!
    const context = {
      commandId: 'customers.interactions.update', auth: { sub: USER_ID, tenantId: scope.tenantId } as never,
      selectedOrganizationId: scope.organizationId, container: container as never,
    }
    expect(await interceptor.beforeExecute!({ id: RULE_ID, title: 'Rename only' }, context)).toMatchObject({ ok: true })
    expect(query).toHaveBeenCalledTimes(1)
    const extraResourceId = '55555555-5555-4555-8555-555555555555'
    expect(await interceptor.beforeExecute!({ id: RULE_ID, linkedEntities: [
      { type: 'resource', id: RESOURCE_ID }, { type: 'resource', id: extraResourceId },
    ] }, context)).toMatchObject({ ok: false, status: 503, body: { fields: ['linkedEntities'] } })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('returns an optimistic-lock conflict before looking up availability on a stale update', async () => {
    const { container, query, planner } = setup()
    const interceptor = visitAvailabilityInterceptors.find((item) => item.targetCommand === 'customers.interactions.update')!
    await expect(interceptor.beforeExecute!({ id: RULE_ID, title: 'Stale update' }, {
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
