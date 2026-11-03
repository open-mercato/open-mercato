const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const getRecordMock = jest.fn()
const setValueMock = jest.fn()
const userTimeZoneLookupMock = jest.fn()

const container = {
  hasRegistration: jest.fn((name: string) => name === 'userTimeZoneLookup'),
  resolve: jest.fn((name: string) => {
    if (name === 'moduleConfigService') {
      return {
        getRecord: (...args: unknown[]) => getRecordMock(...args),
        setValue: (...args: unknown[]) => setValueMock(...args),
      }
    }
    if (name === 'userTimeZoneLookup') return (...args: unknown[]) => userTimeZoneLookupMock(...args)
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

let authValue: Record<string, unknown> | null = { tenantId, sub: userId, orgId: organizationId }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
  getAuthFromCookies: jest.fn(async () => authValue),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string, fallback?: string) => fallback ?? key })),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

import { GET, PUT } from '../route'

const storedRecord = (value: unknown, updatedAt = '2026-11-01T10:00:00.000Z') => ({
  moduleId: 'configs',
  name: 'date_locale',
  value,
  tenantId,
  organizationId,
  source: 'tenant',
  createdAt: updatedAt,
  updatedAt,
})

const makePut = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/configs/date-locale', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

describe('configs date-locale route', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.OM_DEFAULT_TIMEZONE
    delete process.env.NEXT_PUBLIC_OM_DATE_FORMAT
    delete process.env.NEXT_PUBLIC_DATE_FORMAT
    authValue = { tenantId, sub: userId, orgId: organizationId }
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: null })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    getRecordMock.mockResolvedValue(null)
    setValueMock.mockResolvedValue(null)
    userTimeZoneLookupMock.mockResolvedValue(null)
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns empty settings and env defaults when nothing is stored', async () => {
    process.env.OM_DEFAULT_TIMEZONE = 'UTC'
    const response = await GET(new Request('http://localhost/api/configs/date-locale'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.settings).toEqual({
      locale: null,
      dateFormat: null,
      dateTimeFormat: null,
      timeFormat: null,
      timeZone: null,
      firstDayOfWeek: null,
    })
    expect(body.envDefaults.timeZone).toBe('UTC')
    expect(body.effective.timeZone).toBe('UTC')
    expect(body.sources.timeZone).toBe('env')
    expect(body.updatedAt).toBeNull()
    expect(getRecordMock).toHaveBeenCalledWith('configs', 'date_locale', { tenantId })
  })

  it('reports the tenant setting over env and the user timezone over both', async () => {
    process.env.OM_DEFAULT_TIMEZONE = 'UTC'
    getRecordMock.mockResolvedValue(storedRecord({ timeZone: 'Europe/Warsaw', dateFormat: 'dd.MM.yyyy' }))
    userTimeZoneLookupMock.mockResolvedValue('Asia/Tokyo')

    const body = await (await GET(new Request('http://localhost/api/configs/date-locale'))).json()

    expect(body.settings.timeZone).toBe('Europe/Warsaw')
    expect(body.effective.timeZone).toBe('Asia/Tokyo')
    expect(body.sources.timeZone).toBe('user')
    expect(body.effective.dateFormat).toBe('dd.MM.yyyy')
    expect(body.sources.dateFormat).toBe('tenant')
    expect(userTimeZoneLookupMock).toHaveBeenCalledWith({ userId, tenantId })
  })

  it('ignores the instance-level row so one tenant never inherits a global blob as its own', async () => {
    getRecordMock.mockResolvedValue({ ...storedRecord({ timeZone: 'Europe/Warsaw' }), source: 'instance' })
    const body = await (await GET(new Request('http://localhost/api/configs/date-locale'))).json()
    expect(body.settings.timeZone).toBeNull()
  })

  it('rejects unauthenticated requests', async () => {
    authValue = null
    const response = await GET(new Request('http://localhost/api/configs/date-locale'))
    expect(response.status).toBe(401)
  })

  it('normalizes and stores tenant-scoped settings through the mutation guard', async () => {
    const response = await PUT(makePut({ dateFormat: 'DD.MM.YYYY', timeZone: 'europe/warsaw', firstDayOfWeek: 1, locale: 'auto' }))

    expect(response.status).toBe(200)
    expect(setValueMock).toHaveBeenCalledWith(
      'configs',
      'date_locale',
      {
        locale: null,
        dateFormat: 'dd.MM.yyyy',
        dateTimeFormat: null,
        timeFormat: null,
        timeZone: 'Europe/Warsaw',
        firstDayOfWeek: 1,
      },
      { tenantId },
    )
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ tenantId, organizationId, resourceKind: 'configs.date_locale', operation: 'update' }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalled()
  })

  it('returns field errors for an invalid zone or pattern and does not write', async () => {
    const response = await PUT(makePut({ timeZone: 'Mars/Olympus', dateFormat: 'dd<MM' }))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(Object.keys(body.fieldErrors)).toEqual(expect.arrayContaining(['timeZone', 'dateFormat']))
    expect(setValueMock).not.toHaveBeenCalled()
  })

  it('rejects unknown fields', async () => {
    const response = await PUT(makePut({ currency: 'EUR' }))
    expect(response.status).toBe(400)
    expect(setValueMock).not.toHaveBeenCalled()
  })

  it('returns 409 when the settings changed since they were loaded', async () => {
    getRecordMock.mockResolvedValue(storedRecord({ timeZone: 'UTC' }, '2026-11-02T09:00:00.000Z'))
    const response = await PUT(
      makePut({ timeZone: 'Europe/Warsaw' }, { 'x-om-ext-optimistic-lock-expected-updated-at': '2026-11-01T10:00:00.000Z' }),
    )
    expect(response.status).toBe(409)
    expect(setValueMock).not.toHaveBeenCalled()
  })

  it('stops when a mutation guard blocks the write', async () => {
    validateCrudMutationGuardMock.mockResolvedValue({ ok: false, status: 423, body: { error: 'Locked' } })
    const response = await PUT(makePut({ timeZone: 'UTC' }))
    expect(response.status).toBe(423)
    expect(setValueMock).not.toHaveBeenCalled()
  })
})
