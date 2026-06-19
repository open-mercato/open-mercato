import {
  COMMUNICATION_CHANNELS_SYSTEM_USER_ID,
  resolveCommunicationChannelsSystemUserId,
  systemUserEmail,
} from '../system-user'

describe('communication_channels system-user helper', () => {
  it('exposes a sentinel zero-UUID', () => {
    expect(COMMUNICATION_CHANNELS_SYSTEM_USER_ID).toBe('00000000-0000-0000-0000-000000000000')
  })

  it('derives a per-tenant system-user email by convention', () => {
    const tenant = '22222222-2222-2222-2222-222222222222'
    expect(systemUserEmail(tenant)).toBe(`system+communication_channels@${tenant}.local`)
  })

  describe('resolveCommunicationChannelsSystemUserId', () => {
    function makeQueryBuilderMock(result: { id?: string } | null) {
      const qb: any = {}
      qb.select = jest.fn().mockReturnValue(qb)
      qb.where = jest.fn().mockReturnValue(qb)
      qb.limit = jest.fn().mockReturnValue(qb)
      qb.execute = jest.fn(async () => result)
      return qb
    }

    function makeEm(
      queryResult: { id?: string } | null,
    ): { createQueryBuilder: jest.Mock } {
      const qb = makeQueryBuilderMock(queryResult)
      return {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      }
    }

    it('returns the channel-bot user id when found in auth.users', async () => {
      const em = makeEm({ id: 'channel-bot-user-id' })
      const id = await resolveCommunicationChannelsSystemUserId(em as any, 'tenant-1')
      expect(id).toBe('channel-bot-user-id')
    })

    it('falls back to the caller-supplied fallbackId when channel-bot user missing', async () => {
      const em = makeEm(null)
      const id = await resolveCommunicationChannelsSystemUserId(
        em as any,
        'tenant-1',
        'fallback-user-id',
      )
      expect(id).toBe('fallback-user-id')
    })

    it('falls back to the sentinel UUID when both channel-bot and fallback are missing', async () => {
      const em = makeEm(null)
      const id = await resolveCommunicationChannelsSystemUserId(em as any, 'tenant-1', null)
      expect(id).toBe(COMMUNICATION_CHANNELS_SYSTEM_USER_ID)
    })

    it('falls back to the sentinel UUID when EM throws (fail-soft)', async () => {
      const em = {
        createQueryBuilder: jest.fn(() => {
          throw new Error('em not available')
        }),
      }
      const id = await resolveCommunicationChannelsSystemUserId(em as any, 'tenant-1')
      expect(id).toBe(COMMUNICATION_CHANNELS_SYSTEM_USER_ID)
    })
  })
})
