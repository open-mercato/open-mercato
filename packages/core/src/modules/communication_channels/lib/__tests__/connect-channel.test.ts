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
