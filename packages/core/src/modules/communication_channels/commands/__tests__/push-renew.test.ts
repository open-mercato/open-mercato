// Spec C § Phase C4 — push-renew is a thin facade over push-register.

jest.mock('../push-register', () => ({
  pushRegister: jest.fn(),
}))

import { pushRegister } from '../push-register'
import { pushRenew, pushRenewSchema } from '../push-renew'

const CHANNEL = '44444444-4444-4444-8444-444444444444'

afterEach(() => {
  jest.clearAllMocks()
})

describe('pushRenew', () => {
  it('rejects invalid channel id at the schema layer', () => {
    expect(() => pushRenewSchema.parse({ channelId: 'not-a-uuid' })).toThrow()
  })

  it('delegates to pushRegister and surfaces the active result verbatim', async () => {
    ;(pushRegister as jest.Mock).mockResolvedValue({
      channelId: CHANNEL,
      pushStatus: 'active',
      channelState: { pushStatus: 'active', historyId: '99999' },
    })
    const result = await pushRenew({
      container: {} as never,
      scope: { tenantId: 't', organizationId: 'o' },
      input: { channelId: CHANNEL },
    })
    expect(result).toEqual({ channelId: CHANNEL, pushStatus: 'active' })
    expect(pushRegister).toHaveBeenCalledWith(
      expect.objectContaining({ input: { channelId: CHANNEL } }),
    )
  })

  it('propagates failed status + error from pushRegister', async () => {
    ;(pushRegister as jest.Mock).mockResolvedValue({
      channelId: CHANNEL,
      pushStatus: 'failed',
      channelState: { pushStatus: 'failed' },
      error: { code: 'pubsub_topic_missing', message: 'topic required' },
    })
    const result = await pushRenew({
      container: {} as never,
      scope: { tenantId: 't', organizationId: 'o' },
      input: { channelId: CHANNEL },
    })
    expect(result.pushStatus).toBe('failed')
    expect(result.error?.code).toBe('pubsub_topic_missing')
  })
})
