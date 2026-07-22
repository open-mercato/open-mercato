// Mock findPeopleByAddresses so subscriber tests are isolated from the
// encryption helpers and don't need em.findOne chains per address.
jest.mock('../../lib/findPeopleByAddresses', () => ({
  findPeopleByAddresses: jest.fn(),
  normalizeAddresses: jest.requireActual('../../lib/findPeopleByAddresses').normalizeAddresses,
}))

import handler from '../../lib/link-channel-message-handler'
import { metadata as receivedMetadata } from '../link-channel-message-received'
import { metadata as sentMetadata } from '../link-channel-message-sent'
import { findPeopleByAddresses } from '../../lib/findPeopleByAddresses'

const mockFindPeople = findPeopleByAddresses as jest.MockedFunction<typeof findPeopleByAddresses>

/**
 * Build a mock EntityManager. The `fork` method returns the same mock instance
 * (self-referential) so both the outer fork in the handler and the per-row
 * fork in `persistInteractions` share the same mock state.
 */
function makeEm(overrides: Partial<{
  findOneResults: unknown[]
  findResults: unknown[][]
  executeResults: unknown[][]
  flushError: Error | null
}> = {}) {
  let findOneIdx = 0
  let findIdx = 0
  let executeIdx = 0
  const findOneResults = overrides.findOneResults ?? []
  const findResults = overrides.findResults ?? []
  const executeResults = overrides.executeResults ?? []
  const flushError = overrides.flushError ?? null

  const em: any = {
    findOne: jest.fn().mockImplementation(async () => {
      return findOneResults[findOneIdx++] ?? null
    }),
    find: jest.fn().mockImplementation(async () => {
      return findResults[findIdx++] ?? []
    }),
    create: jest.fn().mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
      ...data,
    })),
    getReference: jest.fn().mockImplementation((_entity: unknown, id: string) => ({ id })),
    flush: jest.fn().mockImplementation(async () => {
      if (flushError) throw flushError
    }),
    // Raw connection for the bounded threading-inheritance query
    // (`em.getConnection().execute(...)`). Returns executeResults rows in order.
    getConnection: jest.fn().mockReturnValue({
      execute: jest.fn().mockImplementation(async () => executeResults[executeIdx++] ?? []),
    }),
  }
  // Self-referential fork — both outer and inner fork() calls return the same mock.
  em.fork = jest.fn().mockReturnValue(em)
  return em
}

function makeCtx(em: any) {
  return {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return { fork: () => em } as unknown as T
      throw new Error(`unexpected resolve: ${name}`)
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe('link-channel-message subscriber metadata', () => {
  it('declares one event per auto-discovered subscriber file', () => {
    expect(receivedMetadata).toMatchObject({
      event: 'communication_channels.message.received',
      persistent: true,
      id: 'customers:link-channel-message-received',
    })
    expect(sentMetadata).toMatchObject({
      event: 'communication_channels.message.sent',
      persistent: true,
      id: 'customers:link-channel-message-sent',
    })
  })
})

// ---------------------------------------------------------------------------
// Inbound path
// ---------------------------------------------------------------------------

describe('link-channel-message subscriber — inbound', () => {
  it('no-ops when payload has no channelLinkId', async () => {
    const em = makeEm()
    await handler({} as any, makeCtx(em))
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(mockFindPeople).not.toHaveBeenCalled()
  })

  it('no-ops (fail-closed) when payload lacks tenantId', async () => {
    const em = makeEm()
    await handler(
      { eventType: 'communication_channels.message.received', channelLinkId: 'mcl-1' } as any,
      makeCtx(em),
    )
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(mockFindPeople).not.toHaveBeenCalled()
  })

  it('creates one interaction for single address match; visibility=shared for tenant-scoped channel', async () => {
    const linkRow = {
      id: 'mcl-1',
      providerKey: 'gmail',
      direction: 'inbound',
      createdAt: new Date('2026-05-27T10:00:00Z'),
      channelMetadata: {
        from: 'alice@example.com',
        to: ['bob@example.com'],
        cc: [],
        subject: 'Hello',
      },
    }
    mockFindPeople.mockResolvedValueOnce([{ id: 'person-1', email: 'alice@example.com' }])
    const em = makeEm({
      // findOne[0]: link lookup, findOne[1]: channel lookup returns null (tenant-scoped)
      findOneResults: [linkRow, null],
    })
    // Override getReference to return a predictable ref
    const personRef = { id: 'person-1' }
    em.getReference.mockReturnValue(personRef)

    await handler(
      {
        eventType: 'communication_channels.message.received',
        channelLinkId: 'mcl-1',
        channelId: 'ch-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as any,
      makeCtx(em),
    )

    // flush called once (per row)
    expect(em.flush).toHaveBeenCalledTimes(1)
    // create called with interaction data
    expect(em.create).toHaveBeenCalledTimes(1)
    const [, createdData] = em.create.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(createdData.interactionType).toBe('email')
    expect(createdData.externalMessageId).toBe('mcl-1')
    expect(createdData.visibility).toBe('shared') // tenant-scoped channel → shared
    expect(createdData.entity).toBe(personRef)
    expect(createdData.title).toBe('Hello')
    expect(createdData.authorUserId).toBeNull()
  })

  it('inherits Person from the hub thread when address match is empty (encryption-safe reply linking)', async () => {
    // Reply scenario: tenant data encryption makes findPeopleByAddresses return
    // empty (it filters the encrypted primary_email by plaintext). The reply
    // shares the outbound's message_thread_id, so we inherit the Person of the
    // existing email interaction in that thread via the threadId join.
    const linkRow = {
      id: 'mcl-reply',
      messageId: 'msg-inbound',
      providerKey: 'imap',
      direction: 'inbound',
      createdAt: new Date('2026-05-28T22:16:00Z'),
      channelPayload: { from: 'gita@external.com', to: ['me@org.com'], subject: 'Re: Hello', text: 'thanks' },
      channelMetadata: {},
    }
    // Address matching finds nobody (encrypted column vs plaintext value).
    mockFindPeople.mockResolvedValueOnce([])
    const em = makeEm({
      // findOne[0]: link lookup, findOne[1]: channel (user-scoped → private)
      findOneResults: [linkRow, { userId: 'u-1' }],
      // execute[0]: thread-inheritance query resolves the Person from the thread
      executeResults: [[{ entity_id: 'person-thread' }]],
    })
    const personRef = { id: 'person-thread' }
    em.getReference.mockReturnValue(personRef)

    await handler(
      {
        eventType: 'communication_channels.message.received',
        channelLinkId: 'mcl-reply',
        channelId: 'ch-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as any,
      makeCtx(em),
    )

    const execute = em.getConnection().execute as jest.Mock
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('inbound_m.tenant_id = ?'),
      [
        'msg-inbound',
        'tenant-1',
        'org-1',
        'tenant-1',
        'org-1',
        'tenant-1',
        'org-1',
        'tenant-1',
        'org-1',
      ],
    )
    expect(em.create).toHaveBeenCalledTimes(1)
    const [, createdData] = em.create.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(createdData.interactionType).toBe('email')
    expect(createdData.externalMessageId).toBe('mcl-reply')
    expect(createdData.entity).toBe(personRef)
    expect(createdData.visibility).toBe('private') // user-scoped channel
  })

  it('IGNORES crmVisibility on INBOUND — provider metadata cannot downgrade a user-owned channel to shared', async () => {
    // Security regression guard: inbound channelMetadata is provider-derived
    // (attacker-influenceable). `crmVisibility` is an outbound-compose concern; on
    // inbound it MUST be ignored so a crafted inbound header cannot expose a private
    // channel's mail to the whole tenant. User-owned channel + crmVisibility:'shared'
    // → still private.
    const linkRow = {
      id: 'mcl-inbound-vis',
      messageId: 'msg-inbound-vis',
      providerKey: 'imap',
      direction: 'inbound',
      createdAt: new Date('2026-05-28T22:16:00Z'),
      channelPayload: { from: 'gita@external.com', to: ['me@org.com'], subject: 'Hi', text: 'hi' },
      channelMetadata: { crmVisibility: 'shared' },
    }
    mockFindPeople.mockResolvedValueOnce([{ id: 'person-1' }])
    const em = makeEm({
      // findOne[0]: link lookup, findOne[1]: channel (user-scoped → owner present)
      findOneResults: [linkRow, { userId: 'u-1' }],
    })

    await handler(
      {
        eventType: 'communication_channels.message.received',
        channelLinkId: 'mcl-inbound-vis',
        channelId: 'ch-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as any,
      makeCtx(em),
    )

    expect(em.create).toHaveBeenCalledTimes(1)
    const [, createdData] = em.create.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(createdData.visibility).toBe('private')
  })

  it('creates 3 interactions for 3-person match across From/To/Cc', async () => {
    const linkRow = {
      id: 'mcl-multi',
      providerKey: 'gmail',
      direction: 'inbound',
      createdAt: new Date(),
      channelMetadata: {
        from: 'alice@x.com',
        to: ['bob@x.com'],
        cc: ['carol@x.com'],
      },
    }
    mockFindPeople.mockResolvedValueOnce([
      { id: 'p-A', email: 'alice@x.com' },
      { id: 'p-B', email: 'bob@x.com' },
      { id: 'p-C', email: 'carol@x.com' },
    ])
    const em = makeEm({ findOneResults: [linkRow, null] })
    em.getReference.mockImplementation((_e: unknown, id: string) => ({ id }))

    await handler(
      {
        eventType: 'communication_channels.message.received',
        channelLinkId: 'mcl-multi',
        channelId: 'ch-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as any,
      makeCtx(em),
    )

    expect(em.flush).toHaveBeenCalledTimes(3)
    expect(em.create).toHaveBeenCalledTimes(3)
    const createdEntityIds = em.create.mock.calls.map(
      ([, data]: [unknown, Record<string, unknown>]) => (data.entity as any).id,
    )
    expect(createdEntityIds.sort()).toEqual(['p-A', 'p-B', 'p-C'])
  })

  it('no-op when zero people match, no crmPersonId, and no threading refs', async () => {
    const linkRow = {
      id: 'mcl-1',
      providerKey: 'gmail',
      direction: 'inbound',
      createdAt: new Date(),
      channelMetadata: { from: 'random@nowhere.io', to: [], cc: [] },
    }
    mockFindPeople.mockResolvedValueOnce([])
    const em = makeEm({
      findOneResults: [linkRow, null],
      // Threading: parent link lookup → empty
      findResults: [[]],
    })

    await handler(
      {
        eventType: 'communication_channels.message.received',
        channelLinkId: 'mcl-1',
        channelId: 'ch-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as any,
      makeCtx(em),
    )
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
  })

  it('idempotent — unique-constraint violation (23505) is swallowed and does not throw', async () => {
    const linkRow = {
      id: 'mcl-1',
      providerKey: 'gmail',
      direction: 'inbound',
      createdAt: new Date(),
      channelMetadata: { from: 'alice@x.com', to: [], cc: [] },
    }
    mockFindPeople.mockResolvedValueOnce([{ id: 'p-A', email: 'alice@x.com' }])
    const dupError = Object.assign(
      new Error('duplicate key value violates unique constraint "customer_interactions_email_dedupe_uq"'),
      { code: '23505' },
    )
    const em = makeEm({ findOneResults: [linkRow, null], flushError: dupError })
    em.getReference.mockReturnValue({ id: 'p-A' })

    await expect(
      handler(
        {
          eventType: 'communication_channels.message.received',
          channelLinkId: 'mcl-1',
          channelId: 'ch-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        } as any,
        makeCtx(em),
      ),
    ).resolves.toBeUndefined()
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('re-throws non-23505 flush errors so the event bus retries', async () => {
    const linkRow = {
      id: 'mcl-1',
      providerKey: 'gmail',
      direction: 'inbound',
      createdAt: new Date(),
      channelMetadata: { from: 'alice@x.com', to: [], cc: [] },
    }
    mockFindPeople.mockResolvedValueOnce([{ id: 'p-A', email: 'alice@x.com' }])
    const dbErr = Object.assign(new Error('connection reset'), { code: '57P01' })
    const em = makeEm({ findOneResults: [linkRow, null], flushError: dbErr })
    em.getReference.mockReturnValue({ id: 'p-A' })

    await expect(
      handler(
        {
          eventType: 'communication_channels.message.received',
          channelLinkId: 'mcl-1',
          channelId: 'ch-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        } as any,
        makeCtx(em),
      ),
    ).rejects.toThrow('connection reset')
  })

  it('falls back to channelPayload addresses when channelMetadata has no address fields', async () => {
    // Inbound Gmail: addresses stored as { address, name } objects in channelPayload
    const linkRow = {
      id: 'mcl-inbound',
      providerKey: 'gmail',
      direction: 'inbound',
      createdAt: new Date(),
      channelMetadata: { messageId: 'msg@gmail.com', inReplyTo: null, references: [] },
      channelPayload: {
        from: { address: 'sender@example.com', name: 'Sender' },
        to: [{ address: 'dest@example.com', name: 'Dest' }],
        cc: [],
        subject: 'Re: meeting',
      },
    }
    mockFindPeople.mockResolvedValueOnce([{ id: 'p-sender', email: 'sender@example.com' }])
    const personRef = { id: 'p-sender' }
    const em = makeEm({ findOneResults: [linkRow, null] })
    em.getReference.mockReturnValue(personRef)

    await handler(
      {
        eventType: 'communication_channels.message.received',
        channelLinkId: 'mcl-inbound',
        channelId: 'ch-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as any,
      makeCtx(em),
    )

    expect(em.flush).toHaveBeenCalledTimes(1)
    const [, createdData] = em.create.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(createdData.entity).toBe(personRef)
    // Verify findPeopleByAddresses was called with addresses extracted from channelPayload
    expect(mockFindPeople).toHaveBeenCalledWith(
      em,
      expect.arrayContaining(['sender@example.com']),
      'tenant-1',
      'org-1',
    )
  })
})

// ---------------------------------------------------------------------------
// Outbound path (Task 12 extension)
// ---------------------------------------------------------------------------

describe('link-channel-message subscriber — outbound', () => {
  it('crmVisibility="shared" in channelMetadata → interaction.visibility="shared"', async () => {
    const linkRow = {
      id: 'mcl-2',
      providerKey: 'gmail',
      direction: 'outbound',
      createdAt: new Date(),
      channelMetadata: {
        from: 'sales@example.com',
        to: ['bob@example.com'],
        cc: [],
        crmVisibility: 'shared',
        crmPersonId: 'person-bob',
        subject: 'Your quote',
      },
    }
    mockFindPeople.mockResolvedValueOnce([{ id: 'person-bob', email: 'bob@example.com' }])
    const personRef = { id: 'person-bob' }
    // channel lookup returns user-scoped channel, but crmVisibility overrides
    const em = makeEm({ findOneResults: [linkRow, { id: 'ch-sales', userId: 'user-sales' }] })
    em.getReference.mockReturnValue(personRef)

    await handler(
      {
        eventType: 'communication_channels.message.sent',
        channelLinkId: 'mcl-2',
        channelId: 'ch-sales',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as any,
      makeCtx(em),
    )

    expect(em.flush).toHaveBeenCalledTimes(1)
    const [, data] = em.create.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(data.visibility).toBe('shared') // explicit override wins
    expect(data.title).toBe('Your quote')
    expect(data.authorUserId).toBe('user-sales')
  })

  it('crmPersonId hint creates interaction even when address matching returns zero', async () => {
    const linkRow = {
      id: 'mcl-3',
      providerKey: 'gmail',
      direction: 'outbound',
      createdAt: new Date(),
      channelMetadata: {
        from: 'sales@example.com',
        to: ['typo@exmaple.com'], // typo — no Person match
        cc: [],
        crmPersonId: 'person-target',
      },
    }
    mockFindPeople.mockResolvedValueOnce([]) // address lookup empty
    const personRef = { id: 'person-target' }
    // findOne[2] satisfies the M4 crmPersonId tenant-ownership re-validation.
    const em = makeEm({ findOneResults: [linkRow, null, { id: 'person-target' }] })
    em.getReference.mockReturnValue(personRef)

    await handler(
      {
        eventType: 'communication_channels.message.sent',
        channelLinkId: 'mcl-3',
        channelId: 'ch-sales',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as any,
      makeCtx(em),
    )

    expect(em.flush).toHaveBeenCalledTimes(1)
    const [, data] = em.create.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(data.entity).toBe(personRef)
  })

  it('rejects a foreign-tenant crmPersonId hint — no interaction created (cross-tenant link prevention)', async () => {
    const linkRow = {
      id: 'mcl-xtenant',
      providerKey: 'gmail',
      direction: 'outbound',
      createdAt: new Date(),
      channelMetadata: {
        from: 'sales@example.com',
        to: ['nomatch@example.com'], // no Person match
        cc: [],
        crmPersonId: 'person-in-other-tenant',
      },
    }
    mockFindPeople.mockResolvedValueOnce([]) // address lookup empty
    // findOne sequence: [link row, channel row, crmPersonId tenant re-validation].
    // The hint points at a person owned by a DIFFERENT tenant, so the
    // tenant-scoped re-validation returns null and the hint MUST be dropped.
    const em = makeEm({ findOneResults: [linkRow, null, null] })

    await handler(
      {
        eventType: 'communication_channels.message.sent',
        channelLinkId: 'mcl-xtenant',
        channelId: 'ch-sales',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as any,
      makeCtx(em),
    )

    // No address match, no same-tenant person hint, no threading refs → nothing
    // to link → no interaction row is created or flushed.
    expect(em.create).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('user-scoped channel → authorUserId set + visibility=private (no crmVisibility override)', async () => {
    const linkRow = {
      id: 'mcl-4',
      providerKey: 'gmail',
      direction: 'outbound',
      createdAt: new Date(),
      channelMetadata: {
        to: ['target@example.com'],
        crmPersonId: 'person-xyz',
        // No crmVisibility
      },
    }
    mockFindPeople.mockResolvedValueOnce([])
    const personRef = { id: 'person-xyz' }
    const em = makeEm({
      findOneResults: [linkRow, { id: 'ch-user', userId: 'user-abc' }, { id: 'person-xyz' }],
    })
    em.getReference.mockReturnValue(personRef)

    await handler(
      {
        eventType: 'communication_channels.message.sent',
        channelLinkId: 'mcl-4',
        channelId: 'ch-user',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as any,
      makeCtx(em),
    )

    expect(em.flush).toHaveBeenCalledTimes(1)
    const [, data] = em.create.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(data.authorUserId).toBe('user-abc')
    expect(data.visibility).toBe('private')
  })

  it('tenant-scoped channel (userId=null) → visibility=shared', async () => {
    const linkRow = {
      id: 'mcl-5',
      providerKey: 'gmail',
      direction: 'outbound',
      createdAt: new Date(),
      channelMetadata: {
        to: ['target@example.com'],
        crmPersonId: 'person-xyz',
      },
    }
    mockFindPeople.mockResolvedValueOnce([])
    const personRef = { id: 'person-xyz' }
    const em = makeEm({
      findOneResults: [linkRow, { id: 'ch-tenant', userId: null }, { id: 'person-xyz' }],
    })
    em.getReference.mockReturnValue(personRef)

    await handler(
      {
        eventType: 'communication_channels.message.sent',
        channelLinkId: 'mcl-5',
        channelId: 'ch-tenant',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as any,
      makeCtx(em),
    )

    expect(em.flush).toHaveBeenCalledTimes(1)
    const [, data] = em.create.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(data.visibility).toBe('shared')
  })
})

// ---------------------------------------------------------------------------
// Threading inheritance (TC-CRM-EMAIL-005)
// ---------------------------------------------------------------------------

describe('link-channel-message subscriber — threading inheritance', () => {
  it('inherits person from parent thread when no address matches and no crmPersonId', async () => {
    const newLinkRow = {
      id: 'mcl-reply',
      providerKey: 'gmail',
      direction: 'inbound',
      createdAt: new Date(),
      channelMetadata: {
        from: 'unknown@nowhere.io',
        to: [],
        cc: [],
        inReplyTo: 'original@example.com',
        references: [],
      },
    }
    // Parent link has channelMetadata.messageId = 'original@example.com'
    const parentLink = { id: 'mcl-original', channelMetadata: { messageId: 'original@example.com' } }
    const personRef = { id: 'alice-entity-id' }

    mockFindPeople.mockResolvedValueOnce([]) // address lookup → no matches

    const em = makeEm({
      findOneResults: [newLinkRow, null], // link + channel
      // Bounded threading query (getConnection().execute) returns the matching parent link id.
      executeResults: [[{ id: parentLink.id }]],
      findResults: [
        [{ entity: personRef }],           // threading: CustomerInteractions for parent
      ],
    })
    em.getReference.mockReturnValue(personRef)

    await handler(
      {
        eventType: 'communication_channels.message.received',
        channelLinkId: 'mcl-reply',
        channelId: 'ch-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as any,
      makeCtx(em),
    )

    expect(em.flush).toHaveBeenCalledTimes(1)
    const [, data] = em.create.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(data.entity).toBe(personRef)
    expect(data.externalMessageId).toBe('mcl-reply')
  })

  it('no-op when threading finds parent links but none match the inReplyTo messageId', async () => {
    const newLinkRow = {
      id: 'mcl-orphan',
      providerKey: 'gmail',
      direction: 'inbound',
      createdAt: new Date(),
      channelMetadata: {
        from: 'unknown@nowhere.io',
        to: [],
        cc: [],
        inReplyTo: 'nonexistent@example.com',
        references: [],
      },
    }
    mockFindPeople.mockResolvedValueOnce([])

    const em = makeEm({
      findOneResults: [newLinkRow, null],
      // inReplyTo 'nonexistent@example.com' matches no parent link's messageId,
      // so the bounded threading SQL query returns no rows.
      executeResults: [[]],
    })

    await handler(
      {
        eventType: 'communication_channels.message.received',
        channelLinkId: 'mcl-orphan',
        channelId: 'ch-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as any,
      makeCtx(em),
    )

    expect(em.flush).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
  })

  it('no-op when no inReplyTo or references exist in metadata', async () => {
    const linkRow = {
      id: 'mcl-fresh',
      providerKey: 'gmail',
      direction: 'inbound',
      createdAt: new Date(),
      // No inReplyTo, no references
      channelMetadata: { from: 'new@sender.io', to: [], cc: [] },
    }
    mockFindPeople.mockResolvedValueOnce([])

    const em = makeEm({ findOneResults: [linkRow, null] })

    await handler(
      {
        eventType: 'communication_channels.message.received',
        channelLinkId: 'mcl-fresh',
        channelId: 'ch-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      } as any,
      makeCtx(em),
    )

    // Threading skipped because no inReplyTo/references → no find calls, no flush
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.find).not.toHaveBeenCalled()
  })
})
