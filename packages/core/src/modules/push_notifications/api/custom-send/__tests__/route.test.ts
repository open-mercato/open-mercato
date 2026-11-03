/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const recipientUserId = '44444444-4444-4444-8444-444444444444'

const sendCustomPushMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'pushNotificationService') {
      return { sendCustomPush: sendCustomPushMock }
    }
    // The mutation-guard bridge and org-scope resolver both resolve optional services; return
    // undefined so the guard registry short-circuits (no legacy guard) and scope falls back to auth.
    return undefined
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: userId,
    tenantId,
    // Tenant-level admin: no org selected. This is the scenario that used to fan out {enqueued:0}
    // silently when the recipient's devices were registered under a specific org.
    orgId: null,
    features: ['push_notifications.send_custom'],
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard-registry', () => ({
  bridgeLegacyGuard: jest.fn(() => null),
  runMutationGuards: jest.fn(async () => ({ ok: true, afterSuccessCallbacks: [] })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    locale: 'en',
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

import { POST } from '../route'
import { CUSTOM_SEND_NO_DEVICES_WARNING } from '../../../data/validators'

function post(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request('http://localhost/api/push_notifications/custom-send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('push_notifications custom-send route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('surfaces an explicit warning (not a silent success) when nothing was enqueued in scope', async () => {
    sendCustomPushMock.mockResolvedValue({ enqueued: 0 })

    const response = await post({ recipientUserId, title: 'Hello' })

    // 200 (not 201) — nothing was created; the warning body conveys the no-op.
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.enqueued).toBe(0)
    expect(payload.warning).toBe(CUSTOM_SEND_NO_DEVICES_WARNING)
    expect(typeof payload.message).toBe('string')
    expect(payload.message.length).toBeGreaterThan(0)
  })

  it('returns a bare enqueued count with no warning when devices were reached', async () => {
    sendCustomPushMock.mockResolvedValue({ enqueued: 2 })

    const response = await post({ recipientUserId, title: 'Hello' })

    expect(response.status).toBe(201)
    const payload = await response.json()
    expect(payload.enqueued).toBe(2)
    expect(payload.warning).toBeUndefined()
    expect(payload.message).toBeUndefined()
  })
})
