/** @jest-environment node */

const mockEm = { fork: jest.fn(() => mockEm) }
const mockSendAsUser = jest.fn<Promise<Record<string, unknown>>, unknown[]>()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'em') return mockEm
      if (token === 'communicationChannelsSendAsUser') return mockSendAsUser
      return null
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: false })),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => {}),
}))

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { POST } from '../route'

const PERSON_ID = '44444444-4444-4444-8444-444444444444'
const CHANNEL_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const SCHEDULED_AT = '2099-01-01T10:00:00.000Z'

function request(extra: Record<string, unknown>) {
  return new Request(`http://localhost/api/customers/people/${PERSON_ID}/emails`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userChannelId: CHANNEL_ID, to: ['x@y.io'], subject: 'hi', body: 'hello', ...extra }),
  })
}

describe('POST person emails — bcc and send later', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-9' })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: 'org-9', filterIds: ['org-9'], allowedIds: ['org-9'], tenantId: 'tenant-1',
    })
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue({ id: PERSON_ID, organizationId: 'org-9' })
  })

  it('passes bcc and scheduledAt to the facade and answers with the scheduled instant', async () => {
    mockSendAsUser.mockResolvedValue({ ok: true, messageId: 'm1', threadId: 't1', scheduledAt: SCHEDULED_AT })

    const response = await POST(
      request({ bcc: ['hidden@y.io'], visibility: 'shared', scheduledAt: SCHEDULED_AT }),
      { params: { id: PERSON_ID } },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ messageId: 'm1', threadId: 't1', scheduledAt: SCHEDULED_AT })
    const facadeInput = mockSendAsUser.mock.calls[0][2] as Record<string, unknown>
    expect(facadeInput).toEqual(expect.objectContaining({
      bcc: ['hidden@y.io'],
      scheduledAt: new Date(SCHEDULED_AT),
      channelMetadata: { crmVisibility: 'shared', crmPersonId: PERSON_ID },
    }))
  })

  it('keeps the immediate-send response without scheduledAt', async () => {
    mockSendAsUser.mockResolvedValue({ ok: true, messageId: 'm1', threadId: 't1' })

    const response = await POST(request({}), { params: { id: PERSON_ID } })

    const payload = await response.json()
    expect(payload).toEqual(expect.objectContaining({ messageId: 'm1', threadId: 't1', queuedAt: expect.any(String) }))
    expect(payload).not.toHaveProperty('scheduledAt')
    expect((mockSendAsUser.mock.calls[0][2] as Record<string, unknown>).scheduledAt).toBeUndefined()
  })

  it('rejects an unparseable scheduledAt before sending', async () => {
    const response = await POST(request({ scheduledAt: 'not-a-date' }), { params: { id: PERSON_ID } })

    expect(response.status).toBe(422)
    expect(mockSendAsUser).not.toHaveBeenCalled()
  })

  it('forwards the facade field error for a rejected send time', async () => {
    mockSendAsUser.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'Pick a send time in the future.',
      fieldErrors: { scheduledAt: 'Pick a send time in the future.' },
    })

    const response = await POST(request({ scheduledAt: SCHEDULED_AT }), { params: { id: PERSON_ID } })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Pick a send time in the future.',
      fieldErrors: { scheduledAt: 'Pick a send time in the future.' },
    })
  })
})
