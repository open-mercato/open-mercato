import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
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
    function makeEm(queryResult: { id?: string } | null): {
      getConnection: jest.Mock
      execute: jest.Mock
    } {
      const execute = jest.fn(async () => (queryResult ? [queryResult] : []))
      return { getConnection: jest.fn(() => ({ execute })), execute }
    }

    it('returns the channel-bot user id when the users table has one', async () => {
      const em = makeEm({ id: 'channel-bot-user-id' })
      const id = await resolveCommunicationChannelsSystemUserId(em as any, 'tenant-1')
      expect(id).toBe('channel-bot-user-id')
    })

    // #5599, first half: `users.email` is encrypted with a per-row IV, so an
    // equality filter on the plaintext can never match and every caller silently
    // fell through to its fallback. The lookup must key on the deterministic
    // `email_hash`.
    it('matches on email_hash, never on the encrypted email column', async () => {
      const em = makeEm({ id: 'channel-bot-user-id' })
      await resolveCommunicationChannelsSystemUserId(em as any, 'tenant-1')

      const [sql, params] = em.execute.mock.calls[0]
      expect(sql).not.toMatch(/\bemail\s*(=|IN)/i)
      expect(sql).toMatch(/email_hash\s+IN/i)
      expect(sql).toMatch(/deleted_at\s+IS\s+NULL/i)
      expect(params).toEqual([...lookupHashCandidates(systemUserEmail('tenant-1')), 'tenant-1'])
    })

    // #5599, second half: the previous implementation asked for `auth.users`.
    // Nothing registers an entity under that name, so MikroORM reads the dot as
    // a schema qualifier and looks in a schema this project never creates. The
    // helper swallows the error, so the miss looked exactly like "no channel-bot
    // user exists" — the same symptom as the encrypted-column defect, which is
    // why fixing only that one would have left the issue open.
    it('names the users table without a schema qualifier', async () => {
      const em = makeEm({ id: 'channel-bot-user-id' })
      await resolveCommunicationChannelsSystemUserId(em as any, 'tenant-1')

      const [sql] = em.execute.mock.calls[0]
      expect(sql).toMatch(/FROM\s+users\b/i)
      expect(sql).not.toMatch(/auth\.users/i)
    })

    // The digests this helper matches on are written by `auth`, so the two sides
    // must agree on how they are computed (no hash context, per `emailHash.ts`).
    // A divergence here re-breaks #5599 without failing any other test.
    it('computes the same digest auth writes to users.email_hash', async () => {
      const em = makeEm({ id: 'channel-bot-user-id' })
      await resolveCommunicationChannelsSystemUserId(em as any, 'tenant-1')

      const [, params] = em.execute.mock.calls[0]
      expect(params).toContain(computeEmailHash(systemUserEmail('tenant-1')))
    })

    // One placeholder per digest — a mismatch would either bind the tenant id
    // into the IN list or leave a digest unbound, and the fail-soft catch would
    // turn either into a silent fallback.
    it('binds one placeholder per candidate digest plus the tenant', async () => {
      const em = makeEm({ id: 'channel-bot-user-id' })
      await resolveCommunicationChannelsSystemUserId(em as any, 'tenant-1')

      const [sql, params] = em.execute.mock.calls[0]
      expect((sql.match(/\?/g) ?? []).length).toBe(params.length)
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
        getConnection: jest.fn(() => {
          throw new Error('em not available')
        }),
      }
      const id = await resolveCommunicationChannelsSystemUserId(em as any, 'tenant-1')
      expect(id).toBe(COMMUNICATION_CHANNELS_SYSTEM_USER_ID)
    })
  })
})
