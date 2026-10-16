const checkRateLimitMock = jest.fn()

jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
  RATE_LIMIT_ERROR_KEY: 'api.errors.rateLimit',
  RATE_LIMIT_ERROR_FALLBACK: 'Too many requests',
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
    t: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

import { checkPortalRateLimit } from '../portalRoute'
import { translateSupportUploadError } from '../attachments'

const TENANT = '11111111-1111-4111-8111-111111111111'

function scopeWith(resolve: (name: string) => unknown) {
  return {
    tenantId: TENANT,
    organizationId: 'org',
    customerId: 'customer',
    auth: { sub: 'customer-user-1' },
    container: { resolve },
  } as never
}

beforeEach(() => {
  checkRateLimitMock.mockReset()
})

describe('checkPortalRateLimit', () => {
  it('limits uploads per customer user with their own budget', async () => {
    const limiter = { consume: jest.fn() }
    const limited = new Response(null, { status: 429 })
    checkRateLimitMock.mockResolvedValue(limited)
    const result = await checkPortalRateLimit(scopeWith(() => limiter), 'upload')
    expect(result).toBe(limited)
    const [service, config, key] = checkRateLimitMock.mock.calls[0]
    expect(service).toBe(limiter)
    expect(config).toMatchObject({ points: 30, duration: 3600, keyPrefix: 'staff_support_ticket_upload' })
    expect(key).toBe(`${TENANT}:customer-user-1`)
  })

  it('keeps the create and message budgets separate from uploads', async () => {
    checkRateLimitMock.mockResolvedValue(null)
    await checkPortalRateLimit(scopeWith(() => ({})), 'create')
    await checkPortalRateLimit(scopeWith(() => ({})), 'message')
    expect(checkRateLimitMock.mock.calls.map((call) => call[1].keyPrefix)).toEqual([
      'staff_support_ticket_create',
      'staff_support_ticket_message',
    ])
  })

  it('lets the request through when no rate limiter is registered', async () => {
    const result = await checkPortalRateLimit(
      scopeWith(() => {
        throw new Error('[internal] not registered')
      }),
      'upload',
    )
    expect(result).toBeNull()
    expect(checkRateLimitMock).not.toHaveBeenCalled()
  })
})

describe('translateSupportUploadError', () => {
  const translate = (key: string, fallback: string) => `${key}|${fallback}`

  it('maps upload service codes to the attachments module messages', () => {
    expect(translateSupportUploadError('dangerous_executable', translate)).toBe(
      'attachments.errors.dangerousExecutable|Executable file types are not allowed as attachments.',
    )
    expect(translateSupportUploadError('quota_exceeded', translate)).toBe(
      'attachments.errors.quotaExceeded|Attachment storage quota exceeded for this tenant.',
    )
  })

  it('falls back to a generic upload failure for unknown codes', () => {
    expect(translateSupportUploadError('something_new', translate)).toBe('attachments.errors.uploadFailed|Attachment upload failed.')
  })
})
