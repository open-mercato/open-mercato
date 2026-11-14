// #8268 review Minor / #8820: a reused idempotency key — same account with a different
// amount/relatedEntry, or any OTHER account (the ledger's unique constraint is
// `(tenant_id, idempotency_key)` only, G2) — makes `adjustCredit` throw a typed
// `CustomerCreditServiceError`. This route never mapped it, so it fell through to the
// generic 500 handler at the bottom of the `catch` block. This test proves the route now
// maps it to a typed 409/422 instead.

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444'

const reportErrorMock = jest.fn()
const runRouteMutationGuardsMock = jest.fn()
const commandBusExecuteMock = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => null),
}))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

import { POST } from '../route'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerCreditServiceError } from '../../../../../../services/customerCreditService'

const mockAuth = getAuthFromRequest as jest.MockedFunction<typeof getAuthFromRequest>
const mockContainer = createRequestContainer as jest.MockedFunction<typeof createRequestContainer>

function routeCtx() {
  return { params: Promise.resolve({ id: ACCOUNT_ID }) } as never
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/customer-groups/credit-accounts/x/adjust', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID } as never)
  mockContainer.mockResolvedValue({
    resolve: (name: string) => {
      if (name === 'commandBus') return { execute: commandBusExecuteMock }
      throw new Error(`unexpected resolve: ${name}`)
    },
  } as never)
  runRouteMutationGuardsMock.mockResolvedValue({ ok: true, runAfterSuccess: async () => {} })
})

describe('POST /customer-groups/credit-accounts/[id]/adjust', () => {
  it('returns 409 when the idempotency key was reused for a different amount or account', async () => {
    commandBusExecuteMock.mockRejectedValue(
      new CustomerCreditServiceError(
        'idempotency_key_mismatch',
        '[internal] idempotency key reused with a different (amount, currency, sourceType, sourceId)',
      ),
    )

    const res = await POST(jsonRequest({ amount: '10.00', note: 'manual correction', idempotencyKey: 'K1' }), routeCtx())

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('idempotency_key_mismatch')
  })

  it('returns 422, not 500, for a typed invalid-amount/no-account error', async () => {
    commandBusExecuteMock.mockRejectedValue(
      new CustomerCreditServiceError('invalid_amount', '[internal] adjustCredit: amount must not be zero'),
    )

    const res = await POST(jsonRequest({ amount: '10.00', note: 'manual correction' }), routeCtx())

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('invalid_amount')
  })

  it('still returns 500 for a genuinely unexpected error, and reports it', async () => {
    commandBusExecuteMock.mockRejectedValue(new Error('database connection lost'))

    const res = await POST(jsonRequest({ amount: '10.00', note: 'manual correction' }), routeCtx())

    expect(res.status).toBe(500)
    expect(reportErrorMock).toHaveBeenCalledTimes(1)
  })

  it('returns 200 on a successful adjustment', async () => {
    commandBusExecuteMock.mockResolvedValue({
      result: {
        entry: {
          entryId: 'entry-1',
          creditAccountId: ACCOUNT_ID,
          entryType: 'adjust',
          amount: '10.00',
          balanceAfter: '10.00',
          idempotencyKey: 'K1',
          relatedEntryId: null,
          linkedOrderId: null,
        },
      },
      logEntry: null,
    })

    const res = await POST(jsonRequest({ amount: '10.00', note: 'manual correction', idempotencyKey: 'K1' }), routeCtx())

    expect(res.status).toBe(200)
  })
})
