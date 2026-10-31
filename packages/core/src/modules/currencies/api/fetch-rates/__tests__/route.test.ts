/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'

const fetchRatesForDate = jest.fn()
const find = jest.fn()
const flush = jest.fn()
const dispose = jest.fn()
const runAfterSuccess = jest.fn()
const runRouteMutationGuards = jest.fn()

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

  it('uses per-method manage metadata', () => {
    expect(metadata).toEqual({
      POST: { requireAuth: true, requireFeatures: ['currencies.fetch.manage'] },
    })
  })

  it('rejects malformed providers before creating a container or calling the service', async () => {
    const response = await POST(request({ providers: ['nbp_average', 'nbp_average'] }) as never)

    expect(response.status).toBe(400)
    expect(container.resolve).not.toHaveBeenCalled()
    expect(fetchRatesForDate).not.toHaveBeenCalled()
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
      { providers: ['nbp_average'] },
    )
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
      { providers: ['nbp_average'] },
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
