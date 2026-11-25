import { asValue, createContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { registerApiInterceptors } from '@open-mercato/shared/lib/crud/interceptor-registry'
import { runApiInterceptorsBefore } from '@open-mercato/shared/lib/crud/interceptor-runner'
import type { InterceptorContext } from '@open-mercato/shared/lib/crud/api-interceptor'
import { interceptors } from '../interceptors'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

const mockedFindOne = jest.mocked(findOneWithDecryption)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const tenantId = '123e4567-e89b-12d3-a456-426614174000'
const userId = '00000000-0000-4000-8000-000000000001'
const staffMemberId = '00000000-0000-4000-8000-0000000000aa'

function rejectNonUuidLikePostgres(where: unknown, scope: unknown) {
  const filter = where as { userId?: unknown }
  const decryptScope = (scope ?? {}) as { tenantId?: unknown; organizationId?: unknown }
  for (const value of [filter.userId, decryptScope.tenantId, decryptScope.organizationId]) {
    if (value !== null && value !== undefined && !(typeof value === 'string' && UUID.test(value))) {
      throw new Error(`invalid input syntax for type uuid: "${String(value)}"`)
    }
  }
}

function orglessContext(overrides: Partial<InterceptorContext> = {}) {
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

function runTimeEntriesBefore(context: Omit<InterceptorContext, 'metadata'>) {
  return runApiInterceptorsBefore({
    routePath: 'staff/timesheets/time-entries',
    method: 'GET',
    request: { method: 'GET', url: 'http://x/api/staff/timesheets/time-entries', query: {}, headers: {} },
    context,
  })
}

function runWidgetDataBefore(context: Omit<InterceptorContext, 'metadata'>) {
  return runApiInterceptorsBefore({
    routePath: 'dashboards/widgets/data',
    method: 'POST',
    request: {
      method: 'POST',
      url: 'http://x/api/dashboards/widgets/data',
      body: { entityType: 'staff:staff_time_entries', filters: [] },
      headers: {},
    },
    context,
  })
}

describe('staff self-scope interceptors without an organization (#10188)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    registerApiInterceptors([{ moduleId: 'staff', interceptors }])
    mockedFindOne.mockImplementation(async (_em, _entity, where, _options, scope) => {
      rejectNonUuidLikePostgres(where, scope)
      return { id: staffMemberId } as never
    })
  })

  afterAll(() => {
    registerApiInterceptors([])
  })

  it('scopes time entries for an org-less staff user instead of failing with 500', async () => {
    const { context, userHasAllFeatures } = orglessContext()

    const result = await runTimeEntriesBefore(context)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.query).toMatchObject({ staffMemberId })
    expect(mockedFindOne).toHaveBeenCalledWith(
      context.em,
      expect.anything(),
      { userId, deletedAt: null },
      undefined,
      { tenantId, organizationId: null },
    )
    expect(userHasAllFeatures).toHaveBeenCalledWith(userId, ['staff.timesheets.manage_all'], {
      tenantId,
      organizationId: null,
    })
  })

  it('answers 403 for an org-less API key without manage_all instead of failing with 500', async () => {
    const { context } = orglessContext({ userId: 'api_key:00000000-0000-4000-8000-0000000000bb' })

    const result = await runTimeEntriesBefore(context)

    expect(result).toMatchObject({ ok: false, statusCode: 403 })
    expect(mockedFindOne).not.toHaveBeenCalled()
  })

  it('answers 403 on dashboard widget data for an org-less API key instead of failing with 500', async () => {
    const { context } = orglessContext({ userId: 'api_key:00000000-0000-4000-8000-0000000000bb', tenantId: '' })

    const result = await runWidgetDataBefore(context)

    expect(result).toMatchObject({ ok: false, statusCode: 403 })
    expect(mockedFindOne).not.toHaveBeenCalled()
  })

  it('scopes dashboard widget data for an org-less staff user', async () => {
    const { context } = orglessContext()

    const result = await runWidgetDataBefore(context)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.body).toMatchObject({
      filters: [{ field: 'staffMemberId', operator: 'eq', value: staffMemberId }],
    })
  })

  it('keeps the manage_all bypass for an org-less caller', async () => {
    const { context, userHasAllFeatures } = orglessContext()
    userHasAllFeatures.mockResolvedValue(true)

    const result = await runTimeEntriesBefore(context)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request.query).not.toHaveProperty('staffMemberId')
    expect(mockedFindOne).not.toHaveBeenCalled()
  })
})
