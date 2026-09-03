import { getRecipientUserIdsForFeature } from '../../../notifications/lib/notificationRecipients'
import { MANAGE_PROJECTS_FEATURE } from '../../lib/time-tracking/access'
import type { TimeProjectBudgetState } from '../../lib/timesheets-projects/budgetThresholdState'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '99999999-9999-4999-8999-999999999999'
const organizationId = '22222222-2222-4222-8222-222222222222'
const timeEntryId = '55555555-5555-4555-8555-555555555555'
const timeProjectId = '44444444-4444-4444-8444-444444444444'
const ownerUserId = '66666666-6666-4666-8666-666666666666'

const createForFeature = jest.fn(async () => [] as Array<{ recipientUserId: string }>)
const create = jest.fn(async () => ({}))
const loadTimeProjectBudgetStateForEntry = jest.fn(async () => null as TimeProjectBudgetState | null)
const claimBudgetThresholdAlert = jest.fn(async () => true)
const computeProjectFinancials = jest.fn(async () => new Map())
const emitStaffEvent = jest.fn(async () => undefined)

jest.mock('../../../notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({
    createForFeature: (...args: unknown[]) => createForFeature(...(args as [])),
    create: (...args: unknown[]) => create(...(args as [])),
  }),
}))

jest.mock('../../lib/timesheets-projects/budgetThresholdState', () => ({
  loadTimeProjectBudgetStateForEntry: (...args: unknown[]) =>
    loadTimeProjectBudgetStateForEntry(...(args as [])),
  claimBudgetThresholdAlert: (...args: unknown[]) => claimBudgetThresholdAlert(...(args as [])),
}))

jest.mock('../../lib/timesheets-projects/computeProjectFinancials', () => ({
  computeProjectFinancials: (...args: unknown[]) => computeProjectFinancials(...(args as [])),
}))

jest.mock('../../events', () => ({
  emitStaffEvent: (...args: unknown[]) => emitStaffEvent(...(args as [])),
}))

import { staffTimeEntryCrudEvents } from '../../lib/crud'
import handle, {
  metadata,
  buildBudgetThresholdGroupKey,
  buildBudgetThresholdLinkHref,
} from '../time-project-budget-threshold-notification'

const em = { fork: () => ({ marker: 'forked-em' }) }
const ctx = { resolve: <T,>(_name: string) => em as unknown as T }

const payload = { id: timeEntryId, tenantId: tenantA, organizationId }

function hoursProject(overrides: Partial<TimeProjectBudgetState> = {}): TimeProjectBudgetState {
  return {
    timeProjectId,
    name: 'Nordvik portal',
    ownerUserId: null,
    budgetKind: 'hours',
    budgetValue: 100,
    budgetWarnAtPercent: 80,
    budgetAlertedAtPercent: null,
    hourlyRate: 200,
    currencyCode: 'PLN',
    ...overrides,
  }
}

function financials(totals: { totalMinutes: number; cost: number | null }) {
  return new Map([
    [timeProjectId, { totalMinutes: totals.totalMinutes, billableMinutes: totals.totalMinutes, cost: totals.cost }],
  ])
}

describe('staff time project budget threshold subscriber', () => {
  beforeEach(() => {
    createForFeature.mockReset()
    createForFeature.mockImplementation(async () => [])
    create.mockReset()
    create.mockImplementation(async () => ({}))
    loadTimeProjectBudgetStateForEntry.mockReset()
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () => null)
    claimBudgetThresholdAlert.mockReset()
    claimBudgetThresholdAlert.mockImplementation(async () => true)
    computeProjectFinancials.mockReset()
    computeProjectFinancials.mockImplementation(async () => new Map())
    emitStaffEvent.mockReset()
    emitStaffEvent.mockImplementation(async () => undefined)
  })

  it('subscribes persistently to every time entry write', () => {
    expect(metadata.event).toBe('staff.timesheets.time_entry.*')
    expect(metadata.persistent).toBe(true)
  })

  it('notifies the manage-feature holders when the warn threshold is crossed', async () => {
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () => hoursProject())
    computeProjectFinancials.mockImplementation(async () => financials({ totalMinutes: 80 * 60, cost: null }))

    await handle(payload, ctx)

    expect(claimBudgetThresholdAlert).toHaveBeenCalledTimes(1)
    expect(claimBudgetThresholdAlert.mock.calls[0][0]).toMatchObject({
      tenantId: tenantA,
      organizationId,
      timeProjectId,
      expectedAlertedAtPercent: null,
      nextAlertedAtPercent: 80,
    })

    expect(createForFeature).toHaveBeenCalledTimes(1)
    const [input, scope] = createForFeature.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(input).toMatchObject({
      type: 'staff.timesheets.time_project.budget_threshold_reached',
      requiredFeature: MANAGE_PROJECTS_FEATURE,
      restrictRecipientsToOrganization: true,
      severity: 'warning',
      sourceEntityType: 'staff:time_project',
      sourceEntityId: timeProjectId,
      titleKey: 'staff.notifications.timeProjectBudget.thresholdReached.title',
      bodyKey: 'staff.notifications.timeProjectBudget.thresholdReached.body',
      linkHref: buildBudgetThresholdLinkHref(timeProjectId),
      groupKey: buildBudgetThresholdGroupKey({ timeProjectId, thresholdPercent: 80 }),
    })
    expect(input.bodyVariables).toEqual({
      projectName: 'Nordvik portal',
      percent: '80',
      thresholdPercent: '80',
    })
    expect(scope).toEqual({ tenantId: tenantA, organizationId })

    expect(emitStaffEvent).toHaveBeenCalledWith(
      'staff.timesheets.time_project.budget_threshold_reached',
      expect.objectContaining({
        timeProjectId,
        tenantId: tenantA,
        organizationId,
        thresholdPercent: 80,
        percent: 80,
      }),
      { persistent: true },
    )
  })

  it('does not notify the same threshold twice', async () => {
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () =>
      hoursProject({ budgetAlertedAtPercent: 80 }),
    )
    computeProjectFinancials.mockImplementation(async () => financials({ totalMinutes: 92 * 60, cost: null }))

    await handle(payload, ctx)

    expect(claimBudgetThresholdAlert).not.toHaveBeenCalled()
    expect(createForFeature).not.toHaveBeenCalled()
    expect(emitStaffEvent).not.toHaveBeenCalled()
  })

  it('announces the full-budget crossing once, at error severity, when one write crosses both thresholds', async () => {
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () => hoursProject())
    computeProjectFinancials.mockImplementation(async () => financials({ totalMinutes: 130 * 60, cost: null }))

    await handle(payload, ctx)

    expect(createForFeature).toHaveBeenCalledTimes(1)
    const [input] = createForFeature.mock.calls[0] as [Record<string, unknown>]
    expect(input).toMatchObject({
      severity: 'error',
      groupKey: buildBudgetThresholdGroupKey({ timeProjectId, thresholdPercent: 100 }),
    })
    expect(input.bodyVariables).toMatchObject({ percent: '130', thresholdPercent: '100' })
    expect(claimBudgetThresholdAlert.mock.calls[0][0]).toMatchObject({ nextAlertedAtPercent: 100 })
  })

  it('stays silent for a project without a budget and never runs the aggregate query', async () => {
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () =>
      hoursProject({ budgetKind: 'none', budgetValue: null }),
    )

    await handle(payload, ctx)

    expect(computeProjectFinancials).not.toHaveBeenCalled()
    expect(claimBudgetThresholdAlert).not.toHaveBeenCalled()
    expect(createForFeature).not.toHaveBeenCalled()
  })

  it('resets the marker without notifying when usage drops back under the threshold', async () => {
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () =>
      hoursProject({ budgetAlertedAtPercent: 100 }),
    )
    computeProjectFinancials.mockImplementation(async () => financials({ totalMinutes: 30 * 60, cost: null }))

    await handle(payload, ctx)

    expect(claimBudgetThresholdAlert.mock.calls[0][0]).toMatchObject({
      expectedAlertedAtPercent: 100,
      nextAlertedAtPercent: null,
    })
    expect(createForFeature).not.toHaveBeenCalled()
    expect(emitStaffEvent).not.toHaveBeenCalled()
  })

  it('notifies again after a reset when the threshold is re-crossed', async () => {
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () => hoursProject({ budgetAlertedAtPercent: null }))
    computeProjectFinancials.mockImplementation(async () => financials({ totalMinutes: 85 * 60, cost: null }))

    await handle(payload, ctx)

    expect(createForFeature).toHaveBeenCalledTimes(1)
    const [input] = createForFeature.mock.calls[0] as [Record<string, unknown>]
    expect(input.groupKey).toBe(buildBudgetThresholdGroupKey({ timeProjectId, thresholdPercent: 80 }))
  })

  it('stops when a concurrent write already claimed the same threshold', async () => {
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () => hoursProject())
    computeProjectFinancials.mockImplementation(async () => financials({ totalMinutes: 90 * 60, cost: null }))
    claimBudgetThresholdAlert.mockImplementation(async () => false)

    await handle(payload, ctx)

    expect(createForFeature).not.toHaveBeenCalled()
    expect(emitStaffEvent).not.toHaveBeenCalled()
  })

  it('prices an amount budget from the project rate and the cost of rounded minutes', async () => {
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () =>
      hoursProject({ budgetKind: 'amount', budgetValue: 1000, hourlyRate: 200 }),
    )
    computeProjectFinancials.mockImplementation(async () => financials({ totalMinutes: 1, cost: 900 }))

    await handle(payload, ctx)

    const [financialsScope] = computeProjectFinancials.mock.calls[0] as [Record<string, unknown>]
    expect(financialsScope).toMatchObject({ tenantId: tenantA, organizationId, projectIds: [timeProjectId] })
    expect((financialsScope.hourlyRateByProjectId as Map<string, number | null>).get(timeProjectId)).toBe(200)

    const [input] = createForFeature.mock.calls[0] as [Record<string, unknown>]
    expect(input.bodyVariables).toMatchObject({ percent: '90', thresholdPercent: '80' })
  })

  it('degrades quietly when an amount budget has no rate to price hours with', async () => {
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () =>
      hoursProject({ budgetKind: 'amount', budgetValue: 1000, hourlyRate: null }),
    )
    computeProjectFinancials.mockImplementation(async () => financials({ totalMinutes: 10_000, cost: null }))

    await expect(handle(payload, ctx)).resolves.toBeUndefined()
    expect(claimBudgetThresholdAlert).not.toHaveBeenCalled()
    expect(createForFeature).not.toHaveBeenCalled()
  })

  it('notifies the project owner alongside the manage-feature holders', async () => {
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () => hoursProject({ ownerUserId }))
    computeProjectFinancials.mockImplementation(async () => financials({ totalMinutes: 80 * 60, cost: null }))
    createForFeature.mockImplementation(async () => [{ recipientUserId: 'some-manager' }])

    await handle(payload, ctx)

    expect(create).toHaveBeenCalledTimes(1)
    const [input, scope] = create.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(input).toMatchObject({
      recipientUserId: ownerUserId,
      type: 'staff.timesheets.time_project.budget_threshold_reached',
      severity: 'warning',
    })
    expect(scope).toEqual({ tenantId: tenantA, organizationId })
  })

  it('does not notify the owner twice when they already hold the manage feature', async () => {
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () => hoursProject({ ownerUserId }))
    computeProjectFinancials.mockImplementation(async () => financials({ totalMinutes: 80 * 60, cost: null }))
    createForFeature.mockImplementation(async () => [{ recipientUserId: ownerUserId }])

    await handle(payload, ctx)

    expect(create).not.toHaveBeenCalled()
  })

  it('does not throw when the project has no manage-feature holders and no owner', async () => {
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () => hoursProject())
    computeProjectFinancials.mockImplementation(async () => financials({ totalMinutes: 80 * 60, cost: null }))
    createForFeature.mockImplementation(async () => [])

    await expect(handle(payload, ctx)).resolves.toBeUndefined()
    expect(create).not.toHaveBeenCalled()
  })

  it('does not throw when the owner has left the notification scope', async () => {
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () => hoursProject({ ownerUserId }))
    computeProjectFinancials.mockImplementation(async () => financials({ totalMinutes: 80 * 60, cost: null }))
    create.mockImplementation(async () => {
      throw new Error('[internal] Notification recipient not found')
    })

    await expect(handle(payload, ctx)).resolves.toBeUndefined()
  })

  it('swallows a notification service failure instead of failing the subscriber', async () => {
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () => hoursProject())
    computeProjectFinancials.mockImplementation(async () => financials({ totalMinutes: 80 * 60, cost: null }))
    createForFeature.mockImplementation(async () => {
      throw new Error('[internal] notification service down')
    })

    await expect(handle(payload, ctx)).resolves.toBeUndefined()
  })

  it('ignores an entry whose project was deleted or never set', async () => {
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () => null)

    await handle(payload, ctx)

    expect(computeProjectFinancials).not.toHaveBeenCalled()
    expect(createForFeature).not.toHaveBeenCalled()
  })

  it('ignores a payload without an entry id, tenant or organization', async () => {
    await handle({ ...payload, id: null }, ctx)
    await handle({ ...payload, tenantId: null }, ctx)
    await handle({ ...payload, organizationId: null }, ctx)

    expect(loadTimeProjectBudgetStateForEntry).not.toHaveBeenCalled()
  })

  it('scopes every lookup to the tenant and organization the write happened in', async () => {
    loadTimeProjectBudgetStateForEntry.mockImplementation(async () => hoursProject())
    computeProjectFinancials.mockImplementation(async () => financials({ totalMinutes: 80 * 60, cost: null }))

    await handle({ id: timeEntryId, tenantId: tenantB, organizationId }, ctx)

    expect(loadTimeProjectBudgetStateForEntry.mock.calls[0][0]).toMatchObject({
      tenantId: tenantB,
      organizationId,
      timeEntryId,
    })
    expect(computeProjectFinancials.mock.calls[0][0]).toMatchObject({ tenantId: tenantB, organizationId })
    expect(claimBudgetThresholdAlert.mock.calls[0][0]).toMatchObject({ tenantId: tenantB, organizationId })
    const [, scope] = createForFeature.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(scope).toEqual({ tenantId: tenantB, organizationId })
  })

  /**
   * A manual entry write reaches this handler through the time-entry commands, a
   * grid save through the `/bulk` route's own `emitCrudSideEffects` call — two code
   * paths, but one `staffTimeEntryCrudEvents` config, so both build the payload with
   * the same `buildPayload`. Driving the handler with the payload that config really
   * produces is what stops a future change to either path from silently starving the
   * budget alert (the defect the module comment used to describe).
   */
  describe.each([
    ['a manual create through the CRUD route', 'created' as const],
    ['a grid save through /bulk', 'updated' as const],
  ])('%s', (_label, action) => {
    it('reaches the handler with a payload it can act on', async () => {
      loadTimeProjectBudgetStateForEntry.mockImplementation(async () => hoursProject())
      computeProjectFinancials.mockImplementation(async () => financials({ totalMinutes: 85 * 60, cost: null }))

      const emitted = staffTimeEntryCrudEvents.buildPayload!({
        identifiers: { id: timeEntryId, organizationId, tenantId: tenantA },
      } as never) as Record<string, unknown>

      expect(`${staffTimeEntryCrudEvents.module}.${staffTimeEntryCrudEvents.entity}.${action}`).toBe(
        `staff.timesheets.time_entry.${action}`,
      )

      await handle(emitted, ctx)

      expect(createForFeature).toHaveBeenCalledTimes(1)
      const [input] = createForFeature.mock.calls[0] as [Record<string, unknown>]
      expect(input).toMatchObject({
        type: 'staff.timesheets.time_project.budget_threshold_reached',
        sourceEntityId: timeProjectId,
      })
    })
  })
})

type AclFixture = {
  source: 'user' | 'role'
  user_id: string
  tenant_id: string
  features_json: unknown
  is_super_admin: boolean
}

/**
 * Minimal Kysely stand-in for the recipient resolver behind `createForFeature`.
 * It reproduces the two guarantees the budget fan-out depends on: a wildcard grant
 * counts as the manage feature, and the tenant filter never lets another tenant's
 * manager through.
 */
function createFakeDb(fixtures: AclFixture[]) {
  return {
    selectFrom(table: string) {
      const source: AclFixture['source'] = table === 'user_acls' ? 'user' : 'role'
      const filters: Array<{ column: string; value: unknown }> = []
      const chain = {
        innerJoin: () => chain,
        where: (column: string, _operator: string, value: unknown) => {
          filters.push({ column, value })
          return chain
        },
        select: () => chain,
        execute: async () => {
          const tenantFilter = filters.find((filter) => filter.column.endsWith('tenant_id'))
          return fixtures.filter(
            (row) => row.source === source && (!tenantFilter || row.tenant_id === tenantFilter.value),
          )
        },
      }
      return chain
    },
  }
}

describe('budget alert recipient resolution', () => {
  const fixtures: AclFixture[] = [
    {
      source: 'user',
      user_id: 'exact-grant-user',
      tenant_id: tenantA,
      features_json: [MANAGE_PROJECTS_FEATURE],
      is_super_admin: false,
    },
    {
      source: 'role',
      user_id: 'wildcard-grant-user',
      tenant_id: tenantA,
      features_json: ['staff.*'],
      is_super_admin: false,
    },
    {
      source: 'user',
      user_id: 'unrelated-user',
      tenant_id: tenantA,
      features_json: ['staff.timesheets.view'],
      is_super_admin: false,
    },
    {
      source: 'role',
      user_id: 'other-tenant-manager',
      tenant_id: tenantB,
      features_json: [MANAGE_PROJECTS_FEATURE],
      is_super_admin: false,
    },
  ]

  it('includes wildcard-granted managers and excludes everyone else in the tenant', async () => {
    const recipients = await getRecipientUserIdsForFeature(
      createFakeDb(fixtures) as never,
      tenantA,
      MANAGE_PROJECTS_FEATURE,
    )

    expect(recipients.sort()).toEqual(['exact-grant-user', 'wildcard-grant-user'])
  })

  it('never notifies a manage-feature holder from another tenant', async () => {
    const recipients = await getRecipientUserIdsForFeature(
      createFakeDb(fixtures) as never,
      tenantB,
      MANAGE_PROJECTS_FEATURE,
    )

    expect(recipients).toEqual(['other-tenant-manager'])
    expect(recipients).not.toContain('wildcard-grant-user')
  })
})
