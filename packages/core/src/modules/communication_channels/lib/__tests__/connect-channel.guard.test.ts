jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createConnectedChannelRow, MailboxAlreadyConnectedError } from '../connect-channel'

const adapter = { channelType: 'email', capabilities: { realtimePush: false } } as never

function makeEm() {
  return {
    create: jest.fn((_cls: unknown, data: Record<string, unknown>) => ({ id: 'new-channel', ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => {}),
    fork: jest.fn(),
  }
}

function args(em: unknown, overrides: Record<string, unknown>) {
  return {
    em,
    adapter,
    displayName: 'Mailbox',
    credentialsRefId: 'cred-1',
    userId: 'user-1',
    scope: { tenantId: 'tenant-1', organizationId: null },
    ...overrides,
  } as never
}

beforeEach(() => {
  ;(findWithDecryption as jest.Mock).mockReset()
  ;(findOneWithDecryption as jest.Mock).mockReset()
})

describe('createConnectedChannelRow — cross-provider mailbox guard', () => {
  it('blocks connecting the same mailbox via a different provider (case-insensitive)', async () => {
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      { providerKey: 'gmail', externalIdentifier: 'User@Gmail.com' },
    ])
    const em = makeEm()
    const err = await createConnectedChannelRow(
      args(em, { providerKey: 'imap', externalIdentifier: 'user@gmail.com' }),
    ).catch((e) => e)
    expect(err).toBeInstanceOf(MailboxAlreadyConnectedError)
    expect(err.existingProviderKey).toBe('gmail')
    // The guard runs before any insert, so no channel row is created.
    expect(em.create).not.toHaveBeenCalled()
  })

  it('allows reconnecting the SAME provider for the same mailbox (heal, not block)', async () => {
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      { providerKey: 'imap', externalIdentifier: 'user@gmail.com' },
    ])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
    const em = makeEm()
    const channel = await createConnectedChannelRow(
      args(em, { providerKey: 'imap', externalIdentifier: 'user@gmail.com' }),
    )
    expect(channel).toBeTruthy()
    expect(em.create).toHaveBeenCalled()
  })

  it('allows a different provider when the mailbox address differs', async () => {
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      { providerKey: 'gmail', externalIdentifier: 'someone-else@gmail.com' },
    ])
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
    const em = makeEm()
    const channel = await createConnectedChannelRow(
      args(em, { providerKey: 'imap', externalIdentifier: 'user@gmail.com' }),
    )
    expect(channel).toBeTruthy()
    expect(em.create).toHaveBeenCalled()
  })
})
