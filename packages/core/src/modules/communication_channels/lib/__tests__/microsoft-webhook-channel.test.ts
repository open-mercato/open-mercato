jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import { validateMicrosoftWebhookChannel } from '../microsoft-webhook-channel'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const CHANNEL = '33333333-3333-4333-8333-333333333333'
const SUBSCRIPTION = 'sub-123'
const CLIENT_STATE = 'secret-client-state'

function channel(overrides: Record<string, unknown> = {}) {
  return {
    id: CHANNEL,
    tenantId: TENANT,
    organizationId: ORG,
    providerKey: 'microsoft',
    isActive: true,
    channelState: { subscriptionId: SUBSCRIPTION },
    clientStateEncrypted: CLIENT_STATE,
    ...overrides,
  }
}

// The resolver narrows via a raw `SELECT id ...` (no more decrypt-all scan), so
// the em must expose `getConnection().execute`. Returns the matching channel id
// so resolution proceeds to the clientState/subscription checks under test.
function makeEm(matchedIds: Array<{ id: string }> = [{ id: CHANNEL }]) {
  return { getConnection: () => ({ execute: jest.fn(async () => matchedIds) }) }
}

describe('validateMicrosoftWebhookChannel', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('resolves Graph notifications when the callback path uses channel id', async () => {
    const row = channel()
    ;(findWithDecryption as jest.Mock).mockResolvedValue([row])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(row)

    const result = await validateMicrosoftWebhookChannel({
      em: makeEm() as never,
      pathToken: CHANNEL,
      events: [{ subscriptionId: SUBSCRIPTION, clientState: CLIENT_STATE }],
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.resolution.channel.id).toBe(CHANNEL)
      expect(result.resolution.expectedSubscriptionId).toBe(SUBSCRIPTION)
    }
  })

  it('also resolves legacy callbacks where the path token is the subscription id', async () => {
    const row = channel()
    ;(findWithDecryption as jest.Mock).mockResolvedValue([row])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(row)

    const result = await validateMicrosoftWebhookChannel({
      em: makeEm() as never,
      pathToken: SUBSCRIPTION,
      events: [{ subscriptionId: SUBSCRIPTION, clientState: CLIENT_STATE }],
    })

    expect(result.ok).toBe(true)
  })

  it('rejects mismatched clientState before enqueueing work', async () => {
    const row = channel()
    ;(findWithDecryption as jest.Mock).mockResolvedValue([row])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(row)

    const result = await validateMicrosoftWebhookChannel({
      em: makeEm() as never,
      pathToken: CHANNEL,
      events: [{ subscriptionId: SUBSCRIPTION, clientState: 'wrong' }],
    })

    expect(result).toEqual({ ok: false, status: 401, error: 'invalid_client_state' })
  })

  it('rejects a notification whose body subscription id belongs to a different subscription', async () => {
    const row = channel()
    ;(findWithDecryption as jest.Mock).mockResolvedValue([row])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(row)

    const result = await validateMicrosoftWebhookChannel({
      em: makeEm() as never,
      pathToken: CHANNEL,
      events: [{ subscriptionId: 'sub-other', clientState: CLIENT_STATE }],
    })

    expect(result).toEqual({ ok: false, status: 401, error: 'invalid_subscription' })
  })
})
