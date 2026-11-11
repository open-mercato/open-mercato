/** @jest-environment node */

const mockFindByEmail = jest.fn()
const mockCreateToken = jest.fn()
const mockSendEmail = jest.fn()
const mockEmit = jest.fn()
const mockLoggerError = jest.fn()
const mockReportError = jest.fn()

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'customerUserService') return { findByEmail: mockFindByEmail }
    if (token === 'customerTokenService') return { createPasswordReset: mockCreateToken }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/authLinkEmails', () => ({
  sendCustomerPasswordResetEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: (...args: unknown[]) => mockEmit(...args),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ error: (...args: unknown[]) => mockLoggerError(...args) }) }),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

import handle from '@open-mercato/core/modules/customer_accounts/workers/passwordResetDelivery'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '33333333-3333-4333-8333-333333333333'
const userId = '22222222-2222-4222-8222-222222222222'

function makeJob(email: string, locale = 'en') {
  return { id: 'job-1', payload: { email, tenantId, locale }, createdAt: new Date().toISOString() }
}

const ctx = { jobId: 'job-1', attemptNumber: 1, queueName: 'customer-accounts-password-reset-delivery', resolve: jest.fn() }

describe('customer_accounts:password-reset-delivery worker (#8889)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindByEmail.mockResolvedValue({ id: userId, tenantId, organizationId: orgId, email: 'buyer@example.com' })
    mockCreateToken.mockResolvedValue('raw-one-time-token')
    mockSendEmail.mockResolvedValue(undefined)
    mockEmit.mockResolvedValue(undefined)
  })

  it('mints the token and delivers the email for a known account', async () => {
    await handle(makeJob('buyer@example.com'), ctx)

    expect(mockCreateToken).toHaveBeenCalledWith(userId, tenantId)
    expect(mockSendEmail).toHaveBeenCalledWith({
      container: mockContainer,
      tenantId,
      organizationId: orgId,
      email: 'buyer@example.com',
      rawToken: 'raw-one-time-token',
      locale: 'en',
    })
  })

  it('renders the delivery email in the locale captured on the request', async () => {
    await handle(makeJob('buyer@example.com', 'pl'), ctx)

    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ locale: 'pl' }))
  })

  it('never puts the raw token on the event bus', async () => {
    await handle(makeJob('buyer@example.com'), ctx)
    await new Promise((resolve) => setImmediate(resolve))

    for (const call of mockEmit.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('raw-one-time-token')
    }
  })

  it('no-ops silently for an unknown account', async () => {
    mockFindByEmail.mockResolvedValue(null)

    await expect(handle(makeJob('nobody@example.com'), ctx)).resolves.toBeUndefined()

    expect(mockCreateToken).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('rethrows on delivery failure so the queue retries, after reporting it', async () => {
    mockSendEmail.mockRejectedValue(new Error('smtp down'))

    await expect(handle(makeJob('buyer@example.com'), ctx)).rejects.toThrow('smtp down')

    expect(mockLoggerError).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
      module: 'customer_accounts',
      code: 'customer_accounts.password_reset_email_failed',
    })
  })
})
