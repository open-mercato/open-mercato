jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createConnectedChannelRow } from '../connect-channel'

const ADAPTER = { channelType: 'email', capabilities: { realtimePush: false } } as never

const BASE = {
  adapter: ADAPTER,
  providerKey: 'imap',
  displayName: 'Work mail',
  externalIdentifier: 'alice@example.com',
  credentialsRefId: 'cred-1',
  userId: 'user-1',
  scope: { tenantId: 't', organizationId: 'o' },
}

describe('createConnectedChannelRow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default: no other channels for the user, so the cross-provider mailbox
    // guard never trips in these (single-provider) scenarios.
    ;(findWithDecryption as jest.Mock).mockResolvedValue([])
  })

  it('creates a new channel when none exists for the mailbox', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
    const em: any = {
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
      fork: jest.fn(),
    }
    const channel = await createConnectedChannelRow({ em, ...BASE })
    expect(em.create).toHaveBeenCalledTimes(1)
    expect(em.fork).not.toHaveBeenCalled()
    expect(channel.status).toBe('connected')
    expect(channel.isActive).toBe(true)
  })

  it('heals the existing channel in place on reconnect (no duplicate insert)', async () => {
    const existing: any = {
      id: 'ch-1',
      status: 'requires_reauth',
      isActive: false,
      lastError: 'credentials_persist_failed',
      credentialsRef: 'old-cred',
    }
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(existing)
    const em: any = {
      create: jest.fn(),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
      fork: jest.fn(),
    }
    const channel = await createConnectedChannelRow({ em, ...BASE })
    expect(em.create).not.toHaveBeenCalled()
    expect(channel).toBe(existing)
    expect(existing.status).toBe('connected')
    expect(existing.isActive).toBe(true)
    expect(existing.lastError).toBeNull()
    expect(existing.credentialsRef).toBe('cred-1')
    expect(em.flush).toHaveBeenCalled()
  })

  it('re-selects + heals the winner on a concurrent-connect unique violation', async () => {
    const winner: any = { id: 'ch-win', status: 'requires_reauth', isActive: false }
    ;(findOneWithDecryption as jest.Mock)
      .mockResolvedValueOnce(null) // existence check: none yet
      .mockResolvedValueOnce(winner) // re-select after 23505
    const reEm = { flush: jest.fn(async () => undefined) }
    const uniqueErr = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    })
    const em: any = {
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      persist: jest.fn(),
      flush: jest.fn(async () => {
        throw uniqueErr
      }),
      fork: jest.fn(() => reEm),
    }
    const channel = await createConnectedChannelRow({ em, ...BASE })
    expect(channel).toBe(winner)
    expect(winner.status).toBe('connected')
    expect(em.fork).toHaveBeenCalledTimes(1)
    expect(reEm.flush).toHaveBeenCalled()
  })

  describe('adapter-reported identity (#4977)', () => {
    const DISCORD_BASE = {
      ...BASE,
      adapter: { channelType: 'discord', capabilities: { realtimePush: true } } as never,
      providerKey: 'discord',
      displayName: 'Discord',
      externalIdentifier: 'discord:123',
      adoptUnidentifiedChannel: true,
    }

    function buildEm() {
      return {
        create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
        persist: jest.fn(),
        flush: jest.fn(async () => undefined),
        fork: jest.fn(),
        begin: jest.fn(async () => undefined),
        commit: jest.fn(async () => undefined),
        rollback: jest.fn(async () => undefined),
      } as any
    }

    it('adopts and heals the newest legacy identifier-less row instead of inserting a duplicate', async () => {
      const legacy: any = {
        id: 'ch-legacy',
        status: 'requires_reauth',
        isActive: true,
        lastError: 'gateway_close_4014',
        externalIdentifier: null,
      }
      ;(findOneWithDecryption as jest.Mock).mockResolvedValueOnce(null)
      ;(findWithDecryption as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([legacy])
      const em = buildEm()
      const channel = await createConnectedChannelRow({ em, ...DISCORD_BASE })

      expect(channel).toBe(legacy)
      expect(em.create).not.toHaveBeenCalled()
      expect(legacy.status).toBe('connected')
      expect(legacy.lastError).toBeNull()
      expect(legacy.externalIdentifier).toBe('discord:123')
      const [, , legacyFilter, legacyOptions] = (findWithDecryption as jest.Mock).mock.calls[1]
      expect(legacyFilter).toEqual({
        tenantId: 't',
        userId: 'user-1',
        providerKey: 'discord',
        externalIdentifier: null,
        deletedAt: null,
      })
      expect(legacyOptions).toEqual({ orderBy: { createdAt: 'desc' } })
    })

    it('retires older legacy duplicates so a stuck requires_reauth row stops showing', async () => {
      const newest: any = { id: 'ch-new', status: 'connected', isActive: true, isPrimary: false, externalIdentifier: null }
      const stuck: any = {
        id: 'ch-old',
        status: 'requires_reauth',
        isActive: true,
        isPrimary: true,
        lastError: 'gateway_close_4014',
        externalIdentifier: null,
      }
      ;(findOneWithDecryption as jest.Mock).mockResolvedValueOnce(null)
      ;(findWithDecryption as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([newest, stuck])
      const em = buildEm()
      const primaryFlagsAtFlush: Array<{ newest: boolean; stuck: boolean }> = []
      em.flush.mockImplementation(async () => {
        primaryFlagsAtFlush.push({ newest: newest.isPrimary, stuck: stuck.isPrimary })
      })
      const channel = await createConnectedChannelRow({ em, ...DISCORD_BASE })

      expect(channel).toBe(newest)
      expect(newest.externalIdentifier).toBe('discord:123')
      expect(newest.isPrimary).toBe(true)
      expect(stuck).toMatchObject({
        isActive: false,
        isPrimary: false,
        status: 'disconnected',
        lastError: 'superseded_by_reconnect',
        externalIdentifier: null,
      })
      expect(primaryFlagsAtFlush[0]).toEqual({ newest: false, stuck: false })
      expect(primaryFlagsAtFlush.some((flags) => flags.newest && !flags.stuck)).toBe(true)
      expect(primaryFlagsAtFlush.every((flags) => !(flags.newest && flags.stuck))).toBe(true)
      expect(em.begin).toHaveBeenCalledTimes(1)
      expect(em.commit).toHaveBeenCalledTimes(1)
    })

    it('heals the row already carrying the identifier without looking for legacy rows', async () => {
      const existing: any = { id: 'ch-1', status: 'requires_reauth', lastError: 'gateway_close_4004' }
      ;(findOneWithDecryption as jest.Mock).mockResolvedValueOnce(existing)
      const em = buildEm()
      const channel = await createConnectedChannelRow({ em, ...DISCORD_BASE })

      expect(channel).toBe(existing)
      expect(existing.status).toBe('connected')
      expect(findWithDecryption).toHaveBeenCalledTimes(1)
    })

    it('inserts a new row when there is nothing to heal or adopt', async () => {
      ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
      const em = buildEm()
      const channel = await createConnectedChannelRow({ em, ...DISCORD_BASE })

      expect(em.create).toHaveBeenCalledTimes(1)
      expect(channel.externalIdentifier).toBe('discord:123')
    })

    it('never adopts a legacy row for an identifier sniffed from the credential bag', async () => {
      ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
      const em = buildEm()
      await createConnectedChannelRow({ em, ...BASE })

      expect(findWithDecryption).toHaveBeenCalledTimes(1)
      expect(em.create).toHaveBeenCalledTimes(1)
    })
  })

  it('skips the existence check (straight insert) when externalIdentifier is null', async () => {
    const em: any = {
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
      fork: jest.fn(),
    }
    await createConnectedChannelRow({ em, ...BASE, externalIdentifier: null })
    expect(findOneWithDecryption).not.toHaveBeenCalled()
    expect(em.create).toHaveBeenCalledTimes(1)
  })

  it('creates a tenant-wide push channel (user_id null) and dedups on reconnect', async () => {
    const pushBase = {
      adapter: { channelType: 'push', capabilities: { realtimePush: true } } as never,
      providerKey: 'fcm',
      displayName: 'Firebase Cloud Messaging',
      externalIdentifier: null,
      credentialsRefId: 'cred-push',
      userId: null,
      scope: { tenantId: 't', organizationId: 'o' },
    }

    // First connect: no existing tenant push channel — insert one with user_id null.
    ;(findOneWithDecryption as jest.Mock).mockResolvedValueOnce(null)
    const em: any = {
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
      fork: jest.fn(),
    }
    const created = await createConnectedChannelRow({ em, ...pushBase })
    // Unlike an identifier-less EMAIL channel, push runs the dedup existence check.
    expect(findOneWithDecryption).toHaveBeenCalledTimes(1)
    expect(em.create).toHaveBeenCalledTimes(1)
    expect(created.userId).toBeNull()
    expect(created.channelType).toBe('push')

    // Reconnect: the existing tenant push row is healed in place (no duplicate insert).
    const existing: any = { id: 'push-1', status: 'requires_reauth', isActive: false }
    ;(findOneWithDecryption as jest.Mock).mockResolvedValueOnce(existing)
    const em2: any = {
      create: jest.fn(),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
      fork: jest.fn(),
    }
    const healed = await createConnectedChannelRow({ em: em2, ...pushBase })
    expect(em2.create).not.toHaveBeenCalled()
    expect(healed).toBe(existing)
    expect(existing.status).toBe('connected')
    expect(existing.isActive).toBe(true)
  })

  it('ignores a stray externalIdentifier on a tenant-wide push channel (heals, no mailbox INSERT/500)', async () => {
    // A push credential schema is `.passthrough()`, so a stray `email` key can leak in as an
    // externalIdentifier. It must NOT route the reconnect down the mailbox dedup branch — that would
    // INSERT and violate the tenant-push unique index. The tenant push row must be healed instead.
    const pushBaseWithStrayIdentifier = {
      adapter: { channelType: 'push', capabilities: { realtimePush: true } } as never,
      providerKey: 'fcm',
      displayName: 'Firebase Cloud Messaging',
      externalIdentifier: 'ops@example.com',
      credentialsRefId: 'cred-push',
      userId: null,
      scope: { tenantId: 't', organizationId: 'o' },
    }

    const existing: any = { id: 'push-1', status: 'requires_reauth', isActive: false }
    ;(findOneWithDecryption as jest.Mock).mockResolvedValueOnce(existing)
    const em: any = {
      create: jest.fn(),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
      fork: jest.fn(),
    }

    const healed = await createConnectedChannelRow({ em, ...pushBaseWithStrayIdentifier })

    // Dedup keyed on the tenant-push identity (not the stray mailbox) → existing row healed, no INSERT.
    const dedupeFilter = (findOneWithDecryption as jest.Mock).mock.calls[0][2]
    expect(dedupeFilter).toMatchObject({ channelType: 'push', userId: null, providerKey: 'fcm' })
    expect(dedupeFilter.externalIdentifier).toBeUndefined()
    expect(em.create).not.toHaveBeenCalled()
    expect(healed).toBe(existing)
    // The stray identifier is dropped from the stored push row.
    expect(existing.externalIdentifier).toBeNull()
    // Cross-provider mailbox guard must not run for a tenant-wide push channel.
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  it('rethrows a non-unique flush error', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
    const em: any = {
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      persist: jest.fn(),
      flush: jest.fn(async () => {
        throw new Error('connection terminated unexpectedly')
      }),
      fork: jest.fn(),
    }
    await expect(createConnectedChannelRow({ em, ...BASE })).rejects.toThrow('connection terminated')
    expect(em.fork).not.toHaveBeenCalled()
  })
})
