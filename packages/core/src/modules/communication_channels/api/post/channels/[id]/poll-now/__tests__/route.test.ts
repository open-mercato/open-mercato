/** @jest-environment node */

// Regression for https://github.com/open-mercato/open-mercato/issues/4980 — the
// route used to enqueue a poll job for every connected channel and answer
// `202 { ok: true }`, including for channels the poll worker skips by definition
// (`capabilities.realtimePush !== false`). The UI turned that into a toast
// promising messages "in a few seconds" that could never arrive.

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const channelId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const findOneWithDecryptionMock = jest.fn()
const getAuthFromRequestMock = jest.fn()
const loadAclMock = jest.fn()
const assertCanManageChannelMock = jest.fn()
const enqueueMock = jest.fn()
const validateRouteMutationGuardMock = jest.fn()
const afterSuccessMock = jest.fn()
const translateMock = jest.fn((key: string, fallback?: string) => fallback ?? key)

class ChannelAccessDeniedErrorMock extends Error {}

const em = { fork: () => em }

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return { loadAcl: loadAclMock }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

// Without this the route's `resolveTranslations()` throws on an unregistered
// module registry — the exact gap that made the app-level storage_s3 suite red
// in #4926. Mocking it also lets the tests assert the locale key, not the copy.
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => translateMock(key, fallback),
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('../../../../../../lib/access-control', () => ({
  ChannelAccessDeniedError: ChannelAccessDeniedErrorMock,
  assertCanManageChannel: (...args: unknown[]) => assertCanManageChannelMock(...args),
}))

jest.mock('../../../../../../lib/queue', () => ({
  COMMUNICATION_CHANNELS_QUEUES: { poll: 'communication-channels-poll' },
  getCommunicationChannelsQueue: () => ({ enqueue: (...args: unknown[]) => enqueueMock(...args) }),
}))

jest.mock('../../../../../../lib/route-mutation-guard', () => ({
  validateRouteMutationGuard: (...args: unknown[]) => validateRouteMutationGuardMock(...args),
}))

import { POST } from '../route'

function invoke() {
  return POST(
    new Request(`http://localhost/api/communication_channels/channels/${channelId}/poll-now`, {
      method: 'POST',
    }),
    { params: { id: channelId } },
  )
}

function channel(capabilities: Record<string, unknown> | null) {
  return {
    id: channelId,
    userId,
    providerKey: capabilities?.realtimePush === false ? 'imap' : 'discord',
    isActive: true,
    status: 'connected',
    capabilities,
  }
}

describe('communication_channels poll-now route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
    loadAclMock.mockResolvedValue({ isSuperAdmin: true, features: ['*'], organizations: null })
    assertCanManageChannelMock.mockImplementation(() => {})
    validateRouteMutationGuardMock.mockResolvedValue({ afterSuccess: afterSuccessMock })
  })

  it('enqueues a poll job for a hub-polled channel', async () => {
    findOneWithDecryptionMock.mockResolvedValue(channel({ realtimePush: false }))

    const response = await invoke()

    expect(response.status).toBe(202)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock.mock.calls[0][0]).toMatchObject({ channelId })
  })

  it('refuses a push-driven channel instead of queueing work the worker skips', async () => {
    findOneWithDecryptionMock.mockResolvedValue(channel({ realtimePush: true }))

    const response = await invoke()

    expect(response.status).toBe(409)
    expect(enqueueMock).not.toHaveBeenCalled()
    const body = (await response.json()) as { error: string }
    expect(body.error).toMatch(/push-driven/i)
    expect(translateMock).toHaveBeenCalledWith(
      'communication_channels.errors.pollNowPushDriven',
      expect.any(String),
    )
  })

  it('refuses a channel with no declared capabilities, matching the poll worker default', async () => {
    findOneWithDecryptionMock.mockResolvedValue(channel(null))

    const response = await invoke()

    expect(response.status).toBe(409)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('still refuses a disabled channel before the capability check', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      ...channel({ realtimePush: false }),
      isActive: false,
    })

    const response = await invoke()

    expect(response.status).toBe(409)
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})
