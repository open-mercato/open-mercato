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

const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { checkPortalRateLimit, portalErrorResponse } from '../portalRoute'
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
  reportErrorMock.mockReset()
})

describe('portalErrorResponse', () => {
  it('reports unexpected errors with a stable code before returning 500', async () => {
    const failure = new Error('[internal] boom')
    const response = await portalErrorResponse(failure, 'staff portal support tickets POST failed')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, error: 'staff.errors.internal' })
    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(failure, {
      module: 'staff',
      code: 'staff.portal_support_route_failed',
      attributes: { operation: 'staff portal support tickets POST failed' },
    })
  })

  it('keeps domain errors as their own status without reporting', async () => {
    const response = await portalErrorResponse(
      new CrudHttpError(409, { error: 'staff.errors.conflict' }),
      'staff portal support message POST failed',
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'staff.errors.conflict' })
    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  it('keeps validation errors as 400 without reporting', async () => {
    const parsed = z.object({ subject: z.string() }).safeParse({})
    if (parsed.success) throw new Error('[internal] expected a validation failure')
    const response = await portalErrorResponse(parsed.error, 'staff portal support tickets POST failed')
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toMatchObject({ ok: false, error: 'Invalid request' })
    expect(reportErrorMock).not.toHaveBeenCalled()
  })
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
