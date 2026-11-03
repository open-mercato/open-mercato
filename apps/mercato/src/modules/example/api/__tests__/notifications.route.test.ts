/** @jest-environment node */

const createNotification = jest.fn()

jest.mock('@open-mercato/core/modules/notifications/lib/routeHelpers', () => ({
  resolveNotificationContext: jest.fn(async () => ({
    service: { create: createNotification },
    scope: {
      userId: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      organizationId: '33333333-3333-4333-8333-333333333333',
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ t: (_key: string, fallback: string) => fallback })),
}))

import { POST } from '../notifications/route'

function post(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/example/notifications', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('example notification route', () => {
  beforeEach(() => {
    createNotification.mockReset()
    createNotification.mockResolvedValue({ id: '44444444-4444-4444-8444-444444444444' })
  })

  it.each([
    ['success', 'success'],
    ['failure', 'error'],
  ] as const)('emits a deduped %s outcome', async (outcome, severity) => {
    const response = await POST(post({
      outcome,
      dedupeKey: 'operation-42',
      linkHref: '/backend/umes-next-phases?allowed=1',
    }))

    expect(response.status).toBe(201)
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        severity,
        groupKey: `example.umes.actionable:${outcome}:operation-42`,
        bodyVariables: expect.objectContaining({ outcome }),
      }),
      expect.objectContaining({
        userId: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
      }),
    )
  })

  it('defaults legacy callers to a stable success group', async () => {
    await POST(post({ linkHref: '/backend/umes-next-phases?allowed=1' }))

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'success',
        groupKey: 'example.umes.actionable:success:/backend/umes-next-phases?allowed=1',
      }),
      expect.any(Object),
    )
  })
})
