/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const customerId = '44444444-4444-4444-8444-444444444444'

const findOneMock = jest.fn()
const recordConsentMock = jest.fn()
const loadConsentStateMock = jest.fn()
const runMutationGuardsMock = jest.fn(async () => ({ ok: true, afterSuccessCallbacks: [] }))

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return { findOne: findOneMock }
    // The mutation-guard bridge resolves an optional service; undefined short-circuits the
    // guard (no legacy guard registered), matching how `bridgeLegacyGuard` degrades in prod
    // when nothing has registered one.
    return undefined
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: userId, tenantId, orgId: organizationId, features: [] })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard-registry', () => ({
  bridgeLegacyGuard: jest.fn(() => ({ id: 'test-guard' })),
  runMutationGuards: (...args: unknown[]) => runMutationGuardsMock(...args),
}))

jest.mock('../../../../../lib/consent.js', () => ({
  loadConsentState: (...a: unknown[]) => loadConsentStateMock(...a),
  recordConsent: (...a: unknown[]) => recordConsentMock(...a),
}))

jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({ CustomerEntity: class {} }))

import { PUT } from '../route'

function put(body: Record<string, unknown>): Promise<Response> {
  return PUT(
    new Request(`http://localhost/api/marketing_automation/customers/${customerId}/consent`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('marketing_automation operator consent route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    runMutationGuardsMock.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
    findOneMock.mockResolvedValue({ id: customerId })
    loadConsentStateMock.mockResolvedValue({ state: 'unsubscribed' })
  })

  it('records the decision and goes through the mutation-guard registry', async () => {
    const response = await put({ channel: 'email', state: 'unsubscribed', reason: 'asked on the phone' })

    expect(response.status).toBe(200)
    expect(recordConsentMock).toHaveBeenCalledTimes(1)
    expect(runMutationGuardsMock).toHaveBeenCalledTimes(1)
    const [, guardInput] = runMutationGuardsMock.mock.calls[0]
    expect(guardInput).toMatchObject({
      resourceKind: 'marketing_automation.consent',
      resourceId: customerId,
      operation: 'update',
    })
    // The guard must run BEFORE the write — a blocked guard must never have let `recordConsent`
    // fire first.
    expect(recordConsentMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      runMutationGuardsMock.mock.invocationCallOrder[0],
    )
  })

  it('is blocked by a guard rejection, and never writes the consent row', async () => {
    runMutationGuardsMock.mockResolvedValue({
      ok: false,
      errorBody: { error: 'blocked', guardId: 'test-guard' },
      errorStatus: 422,
      afterSuccessCallbacks: [],
    })

    const response = await put({ channel: 'email', state: 'unsubscribed', reason: 'asked on the phone' })

    expect(response.status).toBe(422)
    expect(recordConsentMock).not.toHaveBeenCalled()
  })

  it('answers 400 on an unusable payload before any guard or write runs', async () => {
    const response = await put({ channel: 'email', state: 'maybe', reason: '' })

    expect(response.status).toBe(400)
    expect(runMutationGuardsMock).not.toHaveBeenCalled()
    expect(recordConsentMock).not.toHaveBeenCalled()
  })
})
