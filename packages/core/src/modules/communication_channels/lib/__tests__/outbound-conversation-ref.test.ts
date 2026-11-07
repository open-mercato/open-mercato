jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ChannelThreadMapping } from '../../data/entities'
import { adoptProviderConversationRef } from '../outbound-conversation-ref'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function placeholderMapping(): ChannelThreadMapping {
  return {
    id: 'map-1',
    channelId: 'ch-1',
    externalConversationId: 'conv-1',
    externalThreadRef: 'outbound:thread-1',
  } as ChannelThreadMapping
}

function setup(forkFlush: () => Promise<void>) {
  const fork = { flush: jest.fn(forkFlush) }
  const em = { flush: jest.fn(async () => undefined), fork: jest.fn(() => fork) }
  return { em, fork }
}

function primeAdoptionFinds(mapping: ChannelThreadMapping) {
  const conversation = { id: 'conv-1', channelId: 'ch-1', externalConversationId: 'outbound:thread-1' }
  const forkMapping = { ...mapping }
  mockFindOne.mockReset()
  mockFindOne
    .mockResolvedValueOnce(conversation as never)
    .mockResolvedValueOnce(null as never)
    .mockResolvedValueOnce(forkMapping as never)
  return { conversation, forkMapping }
}

describe('adoptProviderConversationRef', () => {
  it('re-keys the conversation and mapping on a fork, then mirrors the ref onto the caller mapping', async () => {
    const mapping = placeholderMapping()
    const { em, fork } = setup(async () => undefined)
    const { conversation, forkMapping } = primeAdoptionFinds(mapping)

    const result = await adoptProviderConversationRef(em as unknown as EntityManager, {
      mapping,
      channelId: 'ch-1',
      providerConversationRef: 'gmail-thread:gm-1',
      scope,
    })

    expect(result).toBe('adopted')
    expect(mockFindOne.mock.calls.every(([usedEm]) => usedEm === fork)).toBe(true)
    expect(conversation.externalConversationId).toBe('gmail-thread:gm-1')
    expect(forkMapping.externalThreadRef).toBe('gmail-thread:gm-1')
    expect(mapping.externalThreadRef).toBe('gmail-thread:gm-1')
    expect(fork.flush).toHaveBeenCalledTimes(1)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('returns conflict when an inbound insert claims the provider id between the lookup and the flush', async () => {
    const mapping = placeholderMapping()
    const { em, fork } = setup(async () => {
      throw Object.assign(
        new Error('duplicate key value violates unique constraint "external_conversations_channel_external_uq"'),
        { code: '23505' },
      )
    })
    primeAdoptionFinds(mapping)

    const result = await adoptProviderConversationRef(em as unknown as EntityManager, {
      mapping,
      channelId: 'ch-1',
      providerConversationRef: 'gmail-thread:gm-1',
      scope,
    })

    expect(result).toBe('conflict')
    expect(fork.flush).toHaveBeenCalledTimes(1)
    expect(em.flush).not.toHaveBeenCalled()
    expect(mapping.externalThreadRef).toBe('outbound:thread-1')
  })

  it('rethrows a flush failure that is not a unique violation, leaving the caller mapping untouched', async () => {
    const mapping = placeholderMapping()
    const failure = new Error('connection reset')
    const { em } = setup(async () => {
      throw failure
    })
    primeAdoptionFinds(mapping)

    await expect(
      adoptProviderConversationRef(em as unknown as EntityManager, {
        mapping,
        channelId: 'ch-1',
        providerConversationRef: 'gmail-thread:gm-1',
        scope,
      }),
    ).rejects.toBe(failure)
    expect(mapping.externalThreadRef).toBe('outbound:thread-1')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('returns conflict without writing when the provider id is already owned at lookup time', async () => {
    const mapping = placeholderMapping()
    const { em, fork } = setup(async () => undefined)
    mockFindOne.mockReset()
    mockFindOne
      .mockResolvedValueOnce({ id: 'conv-1', externalConversationId: 'outbound:thread-1' } as never)
      .mockResolvedValueOnce({ id: 'conv-2', externalConversationId: 'gmail-thread:gm-1' } as never)

    const result = await adoptProviderConversationRef(em as unknown as EntityManager, {
      mapping,
      channelId: 'ch-1',
      providerConversationRef: 'gmail-thread:gm-1',
      scope,
    })

    expect(result).toBe('conflict')
    expect(fork.flush).not.toHaveBeenCalled()
    expect(mapping.externalThreadRef).toBe('outbound:thread-1')
  })
})
