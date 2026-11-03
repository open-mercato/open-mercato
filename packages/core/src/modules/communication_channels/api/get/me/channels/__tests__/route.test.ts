/** @jest-environment node */

// Regression for https://github.com/open-mercato/open-mercato/issues/4980 — the
// profile grid had no capability information in its row payload, so it fell back
// to `providerKey === 'gmail'` and labelled every other provider "Polling only".
// The serializer now ships the two adapter facts the column actually needs.

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const findWithDecryptionMock = jest.fn()
const getAuthFromRequestMock = jest.fn()
const adapterGetMock = jest.fn()

const em = { fork: () => em }

function defaultResolve(name: string) {
  if (name === 'em') return em
  if (name === 'channelAdapterRegistry') return { get: adapterGetMock }
  throw new Error(`Unexpected container resolve: ${name}`)
}

const container = { resolve: jest.fn(defaultResolve) }

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

import { GET } from '../route'

type SerializedChannel = {
  providerKey: string
  supportsRealtimePush: boolean
  supportsPushRegistration: boolean
}

function channel(providerKey: string, capabilities: Record<string, unknown> | null) {
  return {
    id: `channel-${providerKey}`,
    providerKey,
    channelType: providerKey === 'discord' ? 'chat' : 'email',
    displayName: `${providerKey} channel`,
    externalIdentifier: null,
    isPrimary: false,
    isActive: true,
    status: 'connected',
    lastError: null,
    pollIntervalSeconds: capabilities?.realtimePush === false ? 300 : null,
    lastPolledAt: null,
    channelState: null,
    capabilities,
    createdAt: null,
  }
}

async function invoke(): Promise<SerializedChannel[]> {
  const response = await GET(new Request('http://localhost/api/communication_channels/me/channels'))
  expect(response.status).toBe(200)
  const body = (await response.json()) as { items: SerializedChannel[] }
  return body.items
}

describe('communication_channels me/channels route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    container.resolve.mockImplementation(defaultResolve)
    getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
    // Gmail is the one provider implementing `registerPush`; a gateway provider
    // such as Discord implements none but declares real-time push.
    adapterGetMock.mockImplementation((providerKey: string) =>
      providerKey === 'gmail' ? { registerPush: jest.fn() } : {},
    )
  })

  it('reports a realtimePush provider as push-driven and not push-registerable', async () => {
    findWithDecryptionMock.mockResolvedValue([channel('discord', { realtimePush: true })])

    const [row] = await invoke()

    expect(row.supportsRealtimePush).toBe(true)
    expect(row.supportsPushRegistration).toBe(false)
  })

  it('reports a polling provider as not push-driven', async () => {
    findWithDecryptionMock.mockResolvedValue([channel('imap', { realtimePush: false })])

    const [row] = await invoke()

    expect(row.supportsRealtimePush).toBe(false)
    expect(row.supportsPushRegistration).toBe(false)
  })

  it('keeps Gmail push-registerable while it stays hub-polled', async () => {
    findWithDecryptionMock.mockResolvedValue([channel('gmail', { realtimePush: false })])

    const [row] = await invoke()

    expect(row.supportsRealtimePush).toBe(false)
    expect(row.supportsPushRegistration).toBe(true)
  })

  it('defaults a channel with no stored capabilities to push-driven, matching the poll worker', async () => {
    findWithDecryptionMock.mockResolvedValue([channel('slack', null)])

    const [row] = await invoke()

    expect(row.supportsRealtimePush).toBe(true)
  })

  it('degrades to not-registerable when the adapter registry is unavailable', async () => {
    container.resolve.mockImplementation((name: string) => {
      if (name === 'em') return em
      throw new Error('registry missing')
    })
    findWithDecryptionMock.mockResolvedValue([channel('gmail', { realtimePush: false })])

    const [row] = await invoke()

    expect(row.supportsPushRegistration).toBe(false)
  })

  it('rejects an unauthenticated caller', async () => {
    getAuthFromRequestMock.mockResolvedValue(null)

    const response = await GET(new Request('http://localhost/api/communication_channels/me/channels'))

    expect(response.status).toBe(401)
  })
})
