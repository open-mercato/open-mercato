/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'

const fetchRatesForDate = jest.fn()
const find = jest.fn()
const flush = jest.fn()
const dispose = jest.fn()
const runMutationGuards = jest.fn()
const getAllMutationGuardInstances = jest.fn()
const bridgeLegacyGuard = jest.fn()

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
    features: ['currencies.fetch.manage'],
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard-store', () => ({
  getAllMutationGuardInstances: () => getAllMutationGuardInstances(),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard-registry', () => ({
  bridgeLegacyGuard: () => bridgeLegacyGuard(),
  runMutationGuards: (...args: unknown[]) => runMutationGuards(...args),
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
    getAllMutationGuardInstances.mockReturnValue([])
    bridgeLegacyGuard.mockReturnValue(null)
    runMutationGuards.mockImplementation(async (_guards, context) => ({
      ok: true,
      modifiedPayload: context.mutationPayload,
      afterSuccessCallbacks: [],
    }))
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
    expect(runMutationGuards).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        operation: 'update',
        resourceKind: 'currencies.fetch_rates',
        mutationPayload: { date: '2026-08-24T00:00:00.000Z', providers: ['nbp_average'] },
      }),
      { userFeatures: ['currencies.fetch.manage'] },
    )
    expect(fetchRatesForDate).toHaveBeenCalledWith(
      new Date('2026-08-24T00:00:00.000Z'),
      { tenantId, organizationId: orgId },
      { providers: ['nbp_average'] },
    )
  })

  it('uses the mutation guard payload after it changes the selected provider', async () => {
    runMutationGuards.mockResolvedValue({
      ok: true,
      modifiedPayload: { providers: ['nbp_average'] },
      afterSuccessCallbacks: [],
    })

    const response = await POST(request({ providers: ['NBP'] }) as never)

    expect(response.status).toBe(200)
    expect(fetchRatesForDate).toHaveBeenCalledWith(
      expect.any(Date),
      { tenantId, organizationId: orgId },
      { providers: ['nbp_average'] },
    )
  })

  it('runs after-success callbacks only after the committed flush', async () => {
    const afterSuccess = jest.fn()
    runMutationGuards.mockResolvedValue({
      ok: true,
      modifiedPayload: { providers: ['nbp_average'] },
      afterSuccessCallbacks: [{ guard: { afterSuccess }, metadata: { source: 'test' } }],
    })

    const response = await POST(request({ providers: ['nbp_average'] }) as never)

    expect(response.status).toBe(200)
    expect(flush).toHaveBeenCalled()
    expect(afterSuccess).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: 'currencies.fetch_rates',
      operation: 'update',
    }))
  })
})
