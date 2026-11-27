/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'

const fetchRatesForDate = jest.fn()
const find = jest.fn()
const flush = jest.fn()
const dispose = jest.fn()
const runAfterSuccess = jest.fn()
const runRouteMutationGuards = jest.fn()
const reportError = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return { find, flush }
    if (name === 'rateFetchingService') return { fetchRatesForDate }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
  dispose,
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: 'user-1',
    tenantId,
    orgId,
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuards(...args),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    locale: 'en',
    dict: {},
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string, params?: Record<string, string | number>) => {
      const template = fallback ?? key
      if (!params) return template
      return template.replace(/\{\{(\w+)\}\}/g, (match, name) =>
        params[name] === undefined ? match : String(params[name])
      )
    },
  })),
}))

jest.mock('@open-mercato/core/modules/currencies/data/entities', () => ({
  CurrencyFetchConfig: class CurrencyFetchConfig {},
}))

import { POST, metadata } from '../route'

function request(body: unknown): Request {
  return new Request('http://localhost/api/currencies/fetch-rates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/currencies/fetch-rates', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    find.mockResolvedValue([])
    flush.mockResolvedValue(undefined)
    fetchRatesForDate.mockResolvedValue({
      totalFetched: 1,
      byProvider: { nbp_average: { count: 1 } },
      errors: [],
    })
    runAfterSuccess.mockResolvedValue(undefined)
    runRouteMutationGuards.mockResolvedValue({
      ok: true,
      runAfterSuccess,
    })
  })

  it('reports an unexpected fetch failure while preserving the error response', async () => {
    const error = new Error('[internal] provider failure')
    fetchRatesForDate.mockRejectedValueOnce(error)
    const response = await POST(request({}) as never)
    expect(response.status).toBe(500)
    expect(reportError).toHaveBeenCalledWith(error, { module: 'currencies', code: 'currencies.fetch_rates_failed' })
    await expect(response.json()).resolves.toMatchObject({ error: 'Failed to fetch currency rates', totalFetched: 0 })
  })

  it('uses per-method manage metadata', () => {
    expect(metadata).toEqual({
      POST: { requireAuth: true, requireFeatures: ['currencies.fetch.manage'] },
    })
  })

  it('rejects malformed providers before creating a container or calling the service', async () => {
    const response = await POST(request({ providers: [123] }) as never)

    expect(response.status).toBe(400)
    expect(container.resolve).not.toHaveBeenCalled()
    expect(fetchRatesForDate).not.toHaveBeenCalled()
  })

  it.each([
    ['repeated providers', ['NBP', 'NBP']],
    ['more than twenty providers', Array.from({ length: 21 }, (_, index) => `legacy-${index}`)],
    ['an empty provider string', ['']],
    ['a provider string longer than fifty characters', ['x'.repeat(51)]],
    ['provider whitespace without normalization', [' NBP ']],
  ])('accepts legacy %s through the actual handler', async (_label, providers) => {
    const response = await POST(request({ providers }) as never)

    expect(response.status).toBe(200)
    expect(fetchRatesForDate).toHaveBeenCalledWith(
      expect.any(Date),
      { tenantId, organizationId: orgId },
      { providers, translate: expect.any(Function) },
    )
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
  })

  it('accepts repeated and long provider lists supplied by a mutation guard', async () => {
    const providers = Array.from({ length: 21 }, () => 'NBP')
    runRouteMutationGuards.mockResolvedValue({ ok: true, modifiedPayload: { providers }, runAfterSuccess })

    const response = await POST(request({ providers: ['NBP'] }) as never)

    expect(response.status).toBe(200)
    expect(fetchRatesForDate).toHaveBeenCalledWith(
      expect.any(Date),
      { tenantId, organizationId: orgId },
      { providers, translate: expect.any(Function) },
    )
  })

  it.each([[''], ['x'.repeat(51)], [' NBP ']])('preserves arbitrary provider strings supplied by a guard: %j', async (provider) => {
    const providers = [provider]
    runRouteMutationGuards.mockResolvedValue({ ok: true, modifiedPayload: { providers }, runAfterSuccess })
    const response = await POST(request({ providers: ['NBP'] }) as never)
    expect(response.status).toBe(200)
    expect(fetchRatesForDate).toHaveBeenCalledWith(
      expect.any(Date),
      { tenantId, organizationId: orgId },
      { providers, translate: expect.any(Function) },
    )
  })

  it('forwards a selected NBP average provider through the guarded fetch', async () => {
    const response = await POST(request({
      date: '2026-08-24T00:00:00.000Z',
      providers: ['nbp_average'],
    }) as never)

    expect(response.status).toBe(200)
    expect(runRouteMutationGuards).toHaveBeenCalledWith({
      container,
      req: expect.any(Request),
      auth: { userId: 'user-1', tenantId, organizationId: orgId },
      input: expect.objectContaining({
        operation: 'custom',
        resourceKind: 'currencies.fetch_rates',
        mutationPayload: { date: '2026-08-24T00:00:00.000Z', providers: ['nbp_average'] },
      }),
    })
    expect(fetchRatesForDate).toHaveBeenCalledWith(
      new Date('2026-08-24T00:00:00.000Z'),
      { tenantId, organizationId: orgId },
      { providers: ['nbp_average'], translate: expect.any(Function) },
    )
  })

  it('keeps accepting a date-only legacy date during the bridge release', async () => {
    const response = await POST(request({ date: '2026-08-24' }) as never)

    expect(response.status).toBe(200)
    expect(fetchRatesForDate).toHaveBeenCalledWith(
      new Date('2026-08-24'),
      { tenantId, organizationId: orgId },
      { translate: expect.any(Function) },
    )
  })

  it('treats an empty provider list as the legacy default selection', async () => {
    const response = await POST(request({ providers: [] }) as never)

    expect(response.status).toBe(200)
    expect(fetchRatesForDate).toHaveBeenCalledWith(
      expect.any(Date),
      { tenantId, organizationId: orgId },
      { translate: expect.any(Function) },
    )
  })

  it.each(['', null, false, 0])('keeps the legacy falsy date sentinel %p on the default fetch', async (date) => {
    const now = new Date('2026-11-20T12:34:56.789Z')
    jest.useFakeTimers({ now })
    try {
      const response = await POST(request({ date, providers: [] }) as never)
      expect(response.status).toBe(200)
      expect(fetchRatesForDate).toHaveBeenCalledWith(
        now, { tenantId, organizationId: orgId }, { translate: expect.any(Function) },
      )
      expect(runAfterSuccess).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it.each(['', null, false, 0])('normalizes the legacy falsy date sentinel %p after a guard rewrite', async (date) => {
    const now = new Date('2026-11-20T12:34:56.789Z')
    jest.useFakeTimers({ now })
    runRouteMutationGuards.mockResolvedValue({ ok: true, modifiedPayload: { date, providers: [] }, runAfterSuccess })
    try {
      const response = await POST(request({ date: '2026-08-24', providers: ['nbp_average'] }) as never)
      expect(response.status).toBe(200)
      expect(fetchRatesForDate).toHaveBeenCalledWith(
        now, { tenantId, organizationId: orgId }, { translate: expect.any(Function) },
      )
      expect(runAfterSuccess).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('still rejects an invalid concrete date supplied by a mutation guard', async () => {
    runRouteMutationGuards.mockResolvedValue({ ok: true, modifiedPayload: { date: 'not-a-date' }, runAfterSuccess })
    const response = await POST(request({ date: '2026-08-24', providers: [] }) as never)
    expect(response.status).toBe(400)
    expect(fetchRatesForDate).not.toHaveBeenCalled()
    expect(runAfterSuccess).not.toHaveBeenCalled()
  })

  it('strips unknown request properties instead of rejecting them', async () => {
    const response = await POST(request({
      providers: ['nbp_average'],
      legacyFlag: true,
    }) as never)

    expect(response.status).toBe(200)
    expect(runRouteMutationGuards).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          mutationPayload: { providers: ['nbp_average'] },
        }),
      }),
    )
  })

  it('rejects an unparseable date with a localized message', async () => {
    const response = await POST(request({ date: 'not-a-date' }) as never)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid fetch-rates request' })
    expect(fetchRatesForDate).not.toHaveBeenCalled()
  })

  it('uses the mutation guard payload after it changes the selected provider', async () => {
    runRouteMutationGuards.mockResolvedValue({
      ok: true,
      modifiedPayload: { providers: ['nbp_average'], guardAuditId: 'ignored' },
      runAfterSuccess,
    })

    const response = await POST(request({ providers: ['NBP'] }) as never)

    expect(response.status).toBe(200)
    expect(fetchRatesForDate).toHaveBeenCalledWith(
      expect.any(Date),
      { tenantId, organizationId: orgId },
      { providers: ['nbp_average'], translate: expect.any(Function) },
    )
  })

  it('returns a guard rejection without calling the service', async () => {
    runRouteMutationGuards.mockResolvedValue({
      ok: false,
      errorStatus: 422,
      errorBody: { error: 'Blocked by policy' },
      response: Response.json({ error: 'Blocked by policy' }, { status: 422 }),
    })

    const response = await POST(request({ providers: ['nbp_average'] }) as never)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'Blocked by policy' })
    expect(fetchRatesForDate).not.toHaveBeenCalled()
  })

  it('runs after-success callbacks only after the committed flush', async () => {
    runRouteMutationGuards.mockResolvedValue({
      ok: true,
      modifiedPayload: { providers: ['nbp_average'] },
      runAfterSuccess,
    })

    const response = await POST(request({ providers: ['nbp_average'] }) as never)

    expect(response.status).toBe(200)
    expect(flush).toHaveBeenCalled()
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
    expect(flush.mock.invocationCallOrder[0])
      .toBeLessThan(runAfterSuccess.mock.invocationCallOrder[0])
  })
})
