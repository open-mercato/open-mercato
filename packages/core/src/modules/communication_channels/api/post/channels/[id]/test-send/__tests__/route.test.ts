/** @jest-environment node */

// #4976 moved recipient validation off the route's zod schema and onto the
// resolved adapter's `capabilities.recipientFormat`. The helper has its own unit
// tests, but the helper was never the bug — the route's schema was, so the wiring
// that replaced it is what needs pinning. The sibling integration cases in
// TC-CHANNEL-EMAIL-HUB-001 cover the same ground against a seeded channel, but
// they are gated on `OM_ENABLE_TEST_CHANNEL_SEEDING` and skip wherever it is
// unset, CI included. These run everywhere.

const getAuthFromRequestMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const loadAclMock = jest.fn()
const assertCanManageChannelMock = jest.fn()
const getChannelAdapterMock = jest.fn()
const validateRouteMutationGuardMock = jest.fn()
const refreshCredentialsIfNeededMock = jest.fn()
const afterSuccessMock = jest.fn()

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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('../../../../../../lib/access-control', () => ({
  ChannelAccessDeniedError: ChannelAccessDeniedErrorMock,
  assertCanManageChannel: (...args: unknown[]) => assertCanManageChannelMock(...args),
  channelOrgScopeWhere: () => ({}),
}))

jest.mock('../../../../../../lib/adapter-registry-singleton', () => ({
  getChannelAdapter: (...args: unknown[]) => getChannelAdapterMock(...args),
}))

jest.mock('../../../../../../lib/credential-refresh', () => ({
  refreshCredentialsIfNeeded: (...args: unknown[]) => refreshCredentialsIfNeededMock(...args),
}))

jest.mock('../../../../../../lib/route-mutation-guard', () => ({
  validateRouteMutationGuard: (...args: unknown[]) => validateRouteMutationGuardMock(...args),
}))

import { POST } from '../route'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const CHANNEL_ID = '44444444-4444-4444-8444-444444444444'
const DISCORD_SNOWFLAKE = '1534331920463433771'

function buildAdapter(recipientFormat: 'email' | 'provider-native' | undefined) {
  return {
    capabilities: recipientFormat ? { recipientFormat } : {},
    convertOutbound: jest.fn(async () => ({ content: 'converted' })),
    sendMessage: jest.fn(async () => ({ status: 'sent', externalMessageId: 'ext-1' })),
  }
}

function invoke(to: unknown) {
  const request = new Request(
    `http://localhost/api/communication_channels/channels/${CHANNEL_ID}/test-send`,
    { method: 'POST', body: JSON.stringify({ to }) },
  )
  return POST(request, { params: { id: CHANNEL_ID } })
}

describe('POST /api/communication_channels/channels/[id]/test-send — recipient validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue({
      sub: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
    })
    loadAclMock.mockResolvedValue({ isSuperAdmin: true, features: ['*'], organizations: null })
    assertCanManageChannelMock.mockImplementation(() => {})
    findOneWithDecryptionMock.mockResolvedValue({
      id: CHANNEL_ID,
      providerKey: 'imap',
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      isActive: true,
      status: 'connected',
      credentialsRef: null,
    })
    validateRouteMutationGuardMock.mockResolvedValue({ afterSuccess: afterSuccessMock })
    refreshCredentialsIfNeededMock.mockResolvedValue({ credentials: {} })
  })

  describe('an email-format provider', () => {
    it.each([
      ['declared explicitly', 'email' as const],
      ['left to the default', undefined],
    ])('rejects a provider-native id with 422 when recipientFormat is %s', async (_label, format) => {
      const adapter = buildAdapter(format)
      getChannelAdapterMock.mockReturnValue(adapter)

      const response = await invoke(DISCORD_SNOWFLAKE)

      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toEqual({
        error: 'Recipient must be a valid email address',
      })
      expect(adapter.sendMessage).not.toHaveBeenCalled()
      expect(afterSuccessMock).not.toHaveBeenCalled()
    })

    it('still sends to a valid address', async () => {
      const adapter = buildAdapter('email')
      getChannelAdapterMock.mockReturnValue(adapter)

      const response = await invoke('qa@example.com')

      expect(response.status).toBe(200)
      expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
      expect(adapter.sendMessage.mock.calls[0][0].metadata.to).toBe('qa@example.com')
    })
  })

  describe('a provider-native provider', () => {
    it('passes a Discord channel snowflake through to the adapter', async () => {
      const adapter = buildAdapter('provider-native')
      getChannelAdapterMock.mockReturnValue(adapter)

      const response = await invoke(DISCORD_SNOWFLAKE)

      expect(response.status).toBe(200)
      expect(adapter.sendMessage).toHaveBeenCalledTimes(1)
      expect(adapter.sendMessage.mock.calls[0][0].metadata.to).toBe(DISCORD_SNOWFLAKE)
    })

    it.each([
      ['a percent-encoded path separator', 'C123%2Fmessages'],
      ['a raw path separator', 'C123/messages'],
    ])('rejects %s with 422 before the adapter is called', async (_label, recipient) => {
      const adapter = buildAdapter('provider-native')
      getChannelAdapterMock.mockReturnValue(adapter)

      const response = await invoke(recipient)

      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toEqual({
        error: 'Recipient may only contain letters, digits, and the characters . _ : @ + -',
      })
      expect(adapter.sendMessage).not.toHaveBeenCalled()
      expect(afterSuccessMock).not.toHaveBeenCalled()
    })
  })

  it('refuses a CR/LF recipient at the schema, before the channel is looked up', async () => {
    getChannelAdapterMock.mockReturnValue(buildAdapter('provider-native'))

    const response = await invoke('qa@example.com\r\nBcc: attacker@example.com')

    expect(response.status).toBe(422)
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    expect(validateRouteMutationGuardMock).not.toHaveBeenCalled()
  })
})
