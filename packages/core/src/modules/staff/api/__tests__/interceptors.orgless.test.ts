import { asValue, createContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { runApiInterceptorsBefore } from '@open-mercato/shared/lib/crud/interceptor-runner'
import type { InterceptorContext } from '@open-mercato/shared/lib/crud/api-interceptor'
import { interceptors } from '../interceptors'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const mockedFind = jest.mocked(findWithDecryption)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const tenantId = '123e4567-e89b-12d3-a456-426614174000'
const orgA = '00000000-0000-4000-8000-00000000000a'
const orgB = '00000000-0000-4000-8000-00000000000b'
const userId = '00000000-0000-4000-8000-000000000001'
const memberInOrgA = { id: '00000000-0000-4000-8000-0000000000aa', userId, tenantId, organizationId: orgA }
const memberInOrgB = { id: '00000000-0000-4000-8000-0000000000bb', userId, tenantId, organizationId: orgB }

type StaffRow = typeof memberInOrgA
type MemberFilter = { userId?: unknown; tenantId?: unknown; organizationId?: unknown }

function rejectNonUuidLikePostgres(filter: MemberFilter, scope: unknown) {
  const decryptScope = (scope ?? {}) as { tenantId?: unknown; organizationId?: unknown }
  const values = [filter.userId, filter.tenantId, filter.organizationId, decryptScope.tenantId, decryptScope.organizationId]
  for (const value of values) {
    if (value !== null && value !== undefined && !(typeof value === 'string' && UUID.test(value))) {
      throw new Error(`invalid input syntax for type uuid: "${String(value)}"`)
    }
  }
}

function useStaffRows(rows: StaffRow[]) {
  mockedFind.mockImplementation(async (_em, _entity, where, _options, scope) => {
    const filter = where as MemberFilter
    rejectNonUuidLikePostgres(filter, scope)
    return rows.filter((row) =>
      row.userId === filter.userId
      && row.tenantId === filter.tenantId
      && (filter.organizationId === undefined || row.organizationId === filter.organizationId),
    ) as never
  })
}

function buildContext(overrides: Partial<InterceptorContext> = {}) {
  const userHasAllFeatures = jest.fn(async () => false)
  const container = createContainer().register('rbacService', asValue({ userHasAllFeatures }))
  const context: Omit<InterceptorContext, 'metadata'> = {
    userId,
    organizationId: '',
    tenantId,
    em: {} as EntityManager,
    container,
    userFeatures: ['staff.timesheets.view'],
    ...overrides,
  }
  return { context, userHasAllFeatures }
}

function runTimeEntriesBefore(context: Omit<InterceptorContext, 'metadata'>, query: Record<string, unknown> = {}) {
  return runApiInterceptorsBefore({
    routePath: 'staff/timesheets/time-entries',
    method: 'GET',
    request: { method: 'GET', url: 'http://x/api/staff/timesheets/time-entries', query, headers: {} },
    context,
  })
}

function runWidgetDataBefore(context: Omit<InterceptorContext, 'metadata'>, filters: unknown[] = []) {
  return runApiInterceptorsBefore({
    routePath: 'dashboards/widgets/data',
    method: 'POST',
    request: {
      method: 'POST',
      url: 'http://x/api/dashboards/widgets/data',
      body: { entityType: 'staff:staff_time_entries', filters },
      headers: {},
    },
    context,
  })
}

describe('staff self-scope interceptors (#10188)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    registerApiInterceptors([{ moduleId: 'staff', interceptors }])
    useStaffRows([memberInOrgA])
  })

  afterAll(() => {
    registerApiInterceptors([])
  })

  describe('without an organization in scope', () => {
    it('scopes time entries for an org-less staff user with one membership instead of failing with 500', async () => {
      const { context, userHasAllFeatures } = buildContext()

      const result = await runTimeEntriesBefore(context)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.request.query).toMatchObject({ staffMemberId: memberInOrgA.id })
      expect(mockedFind).toHaveBeenCalledWith(
        context.em,
        expect.anything(),
        { userId, tenantId, deletedAt: null },
        expect.anything(),
        { tenantId, organizationId: null },
      )
      expect(userHasAllFeatures).toHaveBeenCalledWith(userId, ['staff.timesheets.manage_all'], {
        tenantId,
        organizationId: null,
      })
    })

    it('refuses time entries for a staff user with memberships in two organizations instead of picking one', async () => {
      useStaffRows([memberInOrgA, memberInOrgB])
      const { context } = buildContext()

      const result = await runTimeEntriesBefore(context, { staffMemberId: memberInOrgB.id })

      expect(result).toMatchObject({
        ok: false,
        statusCode: 403,
        body: { error: 'Select a single organization to view your own time entries.' },
      })
    })

    it('answers 403 for an org-less API key without manage_all instead of failing with 500', async () => {
      const { context } = buildContext({ userId: 'api_key:00000000-0000-4000-8000-0000000000cc' })

      const result = await runTimeEntriesBefore(context)

      expect(result).toMatchObject({ ok: false, statusCode: 403 })
      expect(mockedFind).not.toHaveBeenCalled()
    })

    it('answers 403 on dashboard widget data for an org-less API key instead of failing with 500', async () => {
      const { context } = buildContext({ userId: 'api_key:00000000-0000-4000-8000-0000000000cc', tenantId: '' })

      const result = await runWidgetDataBefore(context)

      expect(result).toMatchObject({ ok: false, statusCode: 403 })
      expect(mockedFind).not.toHaveBeenCalled()
    })

    it('never searches across tenants when the tenant is missing', async () => {
      const { context } = buildContext({ tenantId: '' })

      const result = await runTimeEntriesBefore(context)

      expect(result).toMatchObject({ ok: false, statusCode: 403 })
      expect(mockedFind).not.toHaveBeenCalled()
    })

    it('keeps the manage_all bypass for an org-less caller', async () => {
      const { context, userHasAllFeatures } = buildContext()
      userHasAllFeatures.mockResolvedValue(true)

      const result = await runTimeEntriesBefore(context)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.request.query).not.toHaveProperty('staffMemberId')
      expect(mockedFind).not.toHaveBeenCalled()
    })
  })

  describe('with an organization in scope', () => {
    it('scopes time entries to the staff member of that organization, never the other one', async () => {
      useStaffRows([memberInOrgA, memberInOrgB])
      const { context } = buildContext({ organizationId: orgB })

      const result = await runTimeEntriesBefore(context, { staffMemberId: memberInOrgA.id })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.request.query).toMatchObject({ staffMemberId: memberInOrgB.id })
      expect(mockedFind).toHaveBeenCalledWith(
        context.em,
        expect.anything(),
        { userId, tenantId, organizationId: orgB, deletedAt: null },
        expect.anything(),
        { tenantId, organizationId: orgB },
      )
    })

    it('answers 403 when the user is not staff in the selected organization', async () => {
      const { context } = buildContext({ organizationId: orgB })

      const result = await runTimeEntriesBefore(context)

      expect(result).toMatchObject({ ok: false, statusCode: 403, body: { error: 'User is not a staff member.' } })
    })
  })

  describe('dashboard widget data', () => {
    it('scopes to the only staff member with an eq filter', async () => {
      const { context } = buildContext({ organizationId: orgA })

      const result = await runWidgetDataBefore(context)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.request.body).toMatchObject({
        filters: [{ field: 'staffMemberId', operator: 'eq', value: memberInOrgA.id }],
      })
    })

    it('scopes a multi-organization staff user to all of their own staff members and drops a forged filter', async () => {
      useStaffRows([memberInOrgA, memberInOrgB])
      const { context } = buildContext({ organizationId: orgA })
      const forged = { field: 'staffMemberId', operator: 'eq', value: '00000000-0000-4000-8000-0000000000ff' }

      const result = await runWidgetDataBefore(context, [forged, { field: 'isBillable', operator: 'eq', value: true }])

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.request.body).toMatchObject({
        filters: [
          { field: 'isBillable', operator: 'eq', value: true },
          { field: 'staffMemberId', operator: 'in', value: [memberInOrgA.id, memberInOrgB.id] },
        ],
      })
      expect(mockedFind).toHaveBeenCalledWith(
        context.em,
        expect.anything(),
        { userId, tenantId, deletedAt: null },
        expect.anything(),
        { tenantId, organizationId: null },
      )
    })

    it('answers 403 for a user with no staff member in the tenant', async () => {
      useStaffRows([])
      const { context } = buildContext()

      const result = await runWidgetDataBefore(context)

      expect(result).toMatchObject({ ok: false, statusCode: 403 })
    })
  })
})
