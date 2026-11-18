/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const channelId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const getAuthFromRequestMock = jest.fn()
const validateRouteMutationGuardMock = jest.fn()
const afterSuccessMock = jest.fn()
const commandExecuteMock = jest.fn()
const translateMock = jest.fn((key: string, fallback?: string) => fallback ?? key)

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'commandBus') return { execute: commandExecuteMock }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => translateMock(key, fallback),
  }),
}))

jest.mock('../../../../../../lib/route-mutation-guard', () => ({
  validateRouteMutationGuard: (...args: unknown[]) => validateRouteMutationGuardMock(...args),
}))

import { POST } from '../route'

function invoke() {
  return POST(
    new Request(`http://localhost/api/communication_channels/channels/${channelId}/set-primary`, {
      method: 'POST',
    }),
    { params: { id: channelId } },
  )
}

describe('communication_channels set-primary route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
    validateRouteMutationGuardMock.mockResolvedValue({ afterSuccess: afterSuccessMock })
  })

  it('refuses a disconnected channel with a localized 409', async () => {
    commandExecuteMock.mockResolvedValue({
      result: { status: 'disconnected', reason: 'channel is disconnected' },
    })

    const response = await invoke()

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('channel_disconnected')
    expect(translateMock).toHaveBeenCalledWith(
      'communication_channels.errors.setPrimaryDisconnected',
      expect.any(String),
    )
    expect(body.error).toBe(translateMock.mock.results[0].value)
    expect(afterSuccessMock).not.toHaveBeenCalled()
  })

  it('marks a connected channel as primary', async () => {
    commandExecuteMock.mockResolvedValue({
      result: { status: 'set', channelId, previousPrimaryChannelId: null },
    })

    const response = await invoke()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ channelId, isPrimary: true, previousPrimaryChannelId: null })
    expect(afterSuccessMock).toHaveBeenCalledTimes(1)
  })
})
