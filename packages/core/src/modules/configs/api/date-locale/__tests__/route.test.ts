const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const getRecordMock = jest.fn()
const setValueMock = jest.fn()
const userTimeZoneLookupMock = jest.fn()

const commandBusExecuteMock = jest.fn()
const reportErrorMock = jest.fn()

const container = {
  hasRegistration: jest.fn((name: string) => name === 'userTimeZoneLookup'),
  resolve: jest.fn((name: string) => {
    if (name === 'commandBus') return { execute: (...args: unknown[]) => commandBusExecuteMock(...args) }
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

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

import { commandRegistry, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { GET, PUT } from '../route'

const guardValidateMock = jest.fn()
const guardAfterSuccessMock = jest.fn()

const registryGuard: MutationGuard = {
  id: 'test.date-locale-guard',
  targetEntity: 'configs.date_locale',
  operations: ['update'],
  validate: (input) => guardValidateMock(input),
  afterSuccess: (input) => guardAfterSuccessMock(input),
}

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
    registerMutationGuards([{ moduleId: 'test', guards: [registryGuard] }])
    guardValidateMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true })
    guardAfterSuccessMock.mockResolvedValue(undefined)
    commandBusExecuteMock.mockImplementation(async (id: string, { input, ctx }: { input: unknown; ctx: CommandRuntimeContext }) => {
      const handler = commandRegistry.get(id)
      if (!handler) throw new Error(`Unknown command ${id}`)
      return { result: await handler.execute(input, ctx), logEntry: null }
    })
    getRecordMock.mockResolvedValue(null)
    setValueMock.mockResolvedValue(null)
    userTimeZoneLookupMock.mockResolvedValue(null)
  })

  afterAll(() => {
    process.env = originalEnv
    registerMutationGuards([])
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

  it('answers 500 and reports the error when the settings cannot be read', async () => {
    const failure = new Error('database unavailable')
    getRecordMock.mockRejectedValue(failure)
    const response = await GET(new Request('http://localhost/api/configs/date-locale'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal error' })
    expect(reportErrorMock).toHaveBeenCalledWith(failure, { module: 'configs', code: 'configs.date_locale.unexpected' })
  })

  it('does not report expected client errors', async () => {
    await PUT(makePut({ timeZone: 'Mars/Olympus' }))
    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated requests', async () => {
    authValue = null
    const response = await GET(new Request('http://localhost/api/configs/date-locale'))
    expect(response.status).toBe(401)
  })

  it('normalizes and stores tenant-scoped settings through the registry guards and the update command', async () => {
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
    expect(guardValidateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'configs.date_locale',
        resourceId: tenantId,
        operation: 'update',
      }),
    )
    expect(commandBusExecuteMock).toHaveBeenCalledWith(
      'configs.date_locale.update',
      expect.objectContaining({ input: expect.objectContaining({ tenantId }) }),
    )
    expect(guardAfterSuccessMock).toHaveBeenCalledWith(expect.objectContaining({ resourceKind: 'configs.date_locale' }))
  })

  it('stores the payload a registry guard rewrote, after validating it again', async () => {
    guardValidateMock.mockResolvedValue({ ok: true, modifiedPayload: { timeZone: 'asia/tokyo' } })
    const response = await PUT(makePut({ timeZone: 'UTC' }))
    expect(response.status).toBe(200)
    expect(setValueMock).toHaveBeenCalledWith('configs', 'date_locale', expect.objectContaining({ timeZone: 'Asia/Tokyo' }), { tenantId })
  })

  it('rejects a guard rewrite that no longer validates', async () => {
    guardValidateMock.mockResolvedValue({ ok: true, modifiedPayload: { dateFormat: 'dd<MM' } })
    const response = await PUT(makePut({ timeZone: 'UTC' }))
    expect(response.status).toBe(400)
    expect(setValueMock).not.toHaveBeenCalled()
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

  it('stops when a registered mutation guard blocks the write', async () => {
    guardValidateMock.mockResolvedValue({ ok: false, status: 423, body: { error: 'Locked' } })
    const response = await PUT(makePut({ timeZone: 'UTC' }))
    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({ error: 'Locked' })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(setValueMock).not.toHaveBeenCalled()
    expect(guardAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('answers with the status a command interceptor rejected the update with', async () => {
    commandBusExecuteMock.mockRejectedValue(
      new CommandInterceptorError('Blocked', { status: 422, body: { error: 'Settings are frozen' } }),
    )
    const response = await PUT(makePut({ timeZone: 'UTC' }))
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'Settings are frozen' })
    expect(guardAfterSuccessMock).not.toHaveBeenCalled()
  })
})
