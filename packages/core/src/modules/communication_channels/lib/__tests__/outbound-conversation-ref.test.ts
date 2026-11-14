jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ChannelThreadMapping, ExternalConversation } from '../../data/entities'
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

type ForkStub = {
  flush: jest.Mock<Promise<void>, []>
  transactional: jest.Mock<Promise<unknown>, [(tx: ForkStub) => Promise<unknown>]>
}

function setup(forkFlush: () => Promise<void>) {
  const fork: ForkStub = {
    flush: jest.fn(forkFlush),
    transactional: jest.fn(async (callback: (tx: ForkStub) => Promise<unknown>) => callback(fork)),
  }
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
  it('re-keys the conversation and mapping in one locked transaction, then mirrors the ref onto the caller mapping', async () => {
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
    expect(fork.transactional).toHaveBeenCalledTimes(1)
    expect(mockFindOne.mock.calls.every(([usedEm]) => usedEm === (fork as unknown))).toBe(true)
    const [conversationCall, ownerCall, mappingCall] = mockFindOne.mock.calls
    expect(conversationCall[1]).toBe(ExternalConversation)
    expect(conversationCall[3]).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
    expect(ownerCall[1]).toBe(ExternalConversation)
    expect(mappingCall[1]).toBe(ChannelThreadMapping)
    expect(mappingCall[3]).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE })
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

  describe('two adopters on the same placeholder', () => {
    type Row = Record<string, unknown>
    type LockOptions = { lockMode?: LockMode }
    type StoreSession = {
      findOne: (entity: unknown, where: Row, options?: LockOptions) => Promise<Row | null>
      flush: () => Promise<void>
      transactional: <T>(callback: (tx: StoreSession) => Promise<T>) => Promise<T>
    }

    function deferred() {
      let resolve: () => void = () => undefined
      const promise = new Promise<void>((done) => {
        resolve = done
      })
      return { promise, resolve }
    }

    const drain = () => new Promise<void>((done) => setImmediate(done))

    /**
     * In-memory stand-in for the two rows: `PESSIMISTIC_WRITE` reads queue on a
     * per-row lock held until the reading transaction ends, reads return copies
     * of the committed row, and a flush writes the copies back. Every flush
     * first waits on `flushGate`, so both adopters can be paused after the reads
     * they are able to make before either writes.
     */
    function createStore() {
      const conversations: Row[] = [
        { id: 'conv-1', channelId: 'ch-1', externalConversationId: 'outbound:thread-1', ...scope },
      ]
      const mappings: Row[] = [
        {
          id: 'map-1',
          channelId: 'ch-1',
          externalConversationId: 'conv-1',
          externalThreadRef: 'outbound:thread-1',
          ...scope,
        },
      ]
      const lockTails = new Map<string, Promise<void>>()
      const events: string[] = []
      const flushGate = deferred()

      async function acquire(key: string): Promise<() => void> {
        const previous = lockTails.get(key) ?? Promise.resolve()
        const current = deferred()
        lockTails.set(key, previous.then(() => current.promise))
        await previous
        return current.resolve
      }

      function createSession(name: string): StoreSession {
        const loaded: Array<{ row: Row; copy: Row }> = []
        const held: Array<() => void> = []
        const session: StoreSession = {
          async findOne(entity, where, options) {
            const table = entity === ExternalConversation ? 'conversation' : 'mapping'
            const rows = table === 'conversation' ? conversations : mappings
            if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
              events.push(`${name}:wait:${table}`)
              held.push(await acquire(`${table}:${String(where.id)}`))
              events.push(`${name}:locked:${table}`)
            }
            const row = rows.find((candidate) => Object.entries(where).every(([key, value]) => candidate[key] === value))
            if (!row) return null
            const copy = { ...row }
            loaded.push({ row, copy })
            return copy
          },
          async flush() {
            events.push(`${name}:paused`)
            await flushGate.promise
            for (const { row, copy } of loaded) Object.assign(row, copy)
          },
          async transactional(callback) {
            try {
              return await callback(session)
            } finally {
              held.splice(0).forEach((release) => release())
            }
          },
        }
        return session
      }

      let forks = 0
      const names = ['A', 'B', 'retry']
      const em = { fork: () => createSession(names[forks++] ?? `fork-${forks}`) }
      return { em, conversations, mappings, events, releaseFlushes: flushGate.resolve }
    }

    beforeEach(() => {
      mockFindOne.mockReset()
      mockFindOne.mockImplementation((async (
        usedEm: StoreSession,
        entity: unknown,
        where: Row,
        options?: LockOptions,
      ) => usedEm.findOne(entity, where, options)) as unknown as typeof findOneWithDecryption)
    })

    function adopt(em: unknown, mapping: ChannelThreadMapping, ref: string) {
      return adoptProviderConversationRef(em as EntityManager, {
        mapping,
        channelId: 'ch-1',
        providerConversationRef: ref,
        scope,
      })
    }

    it('lets exactly one adopter win, keeps the pair consistent and never lets the loser replace the winner', async () => {
      const store = createStore()
      const mappingA = placeholderMapping()
      const mappingB = placeholderMapping()

      const first = adopt(store.em, mappingA, 'gmail-thread:A')
      const second = adopt(store.em, mappingB, 'gmail-thread:B')
      await drain()

      expect(store.events).toEqual([
        'A:wait:conversation',
        'B:wait:conversation',
        'A:locked:conversation',
        'A:wait:mapping',
        'A:locked:mapping',
        'A:paused',
      ])
      expect(store.conversations[0].externalConversationId).toBe('outbound:thread-1')

      store.releaseFlushes()
      const results = await Promise.all([first, second])

      expect(results).toEqual(['adopted', 'conflict'])
      expect(store.events.slice(-1)).toEqual(['B:locked:conversation'])
      expect(store.conversations[0].externalConversationId).toBe('gmail-thread:A')
      expect(store.mappings[0].externalThreadRef).toBe('gmail-thread:A')
      expect(mappingA.externalThreadRef).toBe('gmail-thread:A')
      expect(mappingB.externalThreadRef).toBe('outbound:thread-1')

      const retry = await adopt(store.em, mappingB, 'gmail-thread:B')

      expect(retry).toBe('conflict')
      expect(store.conversations[0].externalConversationId).toBe('gmail-thread:A')
      expect(store.mappings[0].externalThreadRef).toBe('gmail-thread:A')
      expect(mappingB.externalThreadRef).toBe('outbound:thread-1')
    })

    it('treats a loser that reports the winner\'s ref as unchanged', async () => {
      const store = createStore()
      const mappingA = placeholderMapping()
      const mappingB = placeholderMapping()

      const first = adopt(store.em, mappingA, 'gmail-thread:A')
      const second = adopt(store.em, mappingB, 'gmail-thread:A')
      await drain()
      store.releaseFlushes()

      expect(await Promise.all([first, second])).toEqual(['adopted', 'unchanged'])
      expect(store.conversations[0].externalConversationId).toBe('gmail-thread:A')
      expect(store.mappings[0].externalThreadRef).toBe('gmail-thread:A')
    })
  })
})
