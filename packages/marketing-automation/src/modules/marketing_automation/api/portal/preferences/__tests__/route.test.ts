/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const personEntityId = '55555555-5555-4555-8555-555555555555'

const loadConsentStateMock = jest.fn()
const loadPreferenceSummaryMock = jest.fn()
const saveContactPreferenceMock = jest.fn()
const recordConsentMock = jest.fn()
const getCustomerAuthFromRequestMock = jest.fn()

const container = { resolve: jest.fn(() => ({})) }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: (...a: unknown[]) => getCustomerAuthFromRequestMock(...a),
}))

jest.mock('../../../../lib/consent.js', () => ({
  loadConsentState: (...a: unknown[]) => loadConsentStateMock(...a),
  recordConsent: (...a: unknown[]) => recordConsentMock(...a),
}))

jest.mock('../../../../lib/preferences.js', () => {
  const actual = jest.requireActual('../../../../lib/preferences.js')
  return {
    ...actual,
    loadPreferenceSummary: (...a: unknown[]) => loadPreferenceSummaryMock(...a),
    saveContactPreference: (...a: unknown[]) => saveContactPreferenceMock(...a),
  }
})

import { GET, PUT } from '../route'

function get(): Promise<Response> {
  return GET(new Request('http://localhost/api/marketing_automation/portal/preferences'))
}

function put(body: Record<string, unknown>): Promise<Response> {
  return PUT(
    new Request('http://localhost/api/marketing_automation/portal/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('marketing_automation portal preferences route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getCustomerAuthFromRequestMock.mockResolvedValue({ personEntityId, tenantId, orgId: organizationId })
    loadConsentStateMock.mockResolvedValue({ state: 'subscribed' })
    loadPreferenceSummaryMock.mockResolvedValue({ maxPerWeek: null, pauseDays: null, locale: null })
    saveContactPreferenceMock.mockResolvedValue(undefined)
  })

  it('returns the signed-in customer own consent and preference, never a requested id', async () => {
    const response = await get()

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.ok).toBe(true)
    expect(loadConsentStateMock).toHaveBeenCalledWith(expect.anything(), personEntityId, { tenantId, organizationId }, 'email')
  })

  it('refuses an account with no portal session', async () => {
    getCustomerAuthFromRequestMock.mockResolvedValue(null)

    const response = await get()

    expect(response.status).toBe(401)
    expect(loadConsentStateMock).not.toHaveBeenCalled()
  })

  it('saves the frequency and pause preference for the session subject', async () => {
    const response = await put({ maxPerWeek: 3, pauseDays: 7 })

    expect(response.status).toBe(200)
    expect(saveContactPreferenceMock).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId, organizationId },
      personEntityId,
      expect.objectContaining({ maxPerWeek: 3, pauseDays: 7 }),
      expect.anything(),
    )
  })

  it('rejects a locale that is not a language tag before touching the database', async () => {
    const response = await put({ locale: 'english' })

    expect(response.status).toBe(400)
    expect(saveContactPreferenceMock).not.toHaveBeenCalled()
    expect(recordConsentMock).not.toHaveBeenCalled()
  })
})
