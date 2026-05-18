import {
  AiChatConversation,
  AiChatConversationParticipant,
  AiChatMessage,
} from '../../entities'
import {
  AiChatConversationAccessError,
  AiChatConversationRepository,
} from '../AiChatConversationRepository'

type ConvRow = {
  id: string
  tenantId: string
  organizationId: string | null
  conversationId: string
  agentId: string
  ownerUserId: string
  title: string | null
  status: 'open' | 'closed'
  visibility: 'private' | 'shared' | 'organization'
  pageContext: Record<string, unknown> | null
  lastMessageAt: Date | null
  importedFromLocalAt: Date | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

type ParticipantRow = {
  id: string
  tenantId: string
  organizationId: string | null
  conversationId: string
  userId: string
  role: 'owner' | 'viewer' | 'commenter'
  lastReadAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type MessageRow = {
  id: string
  tenantId: string
  organizationId: string | null
  conversationId: string
  clientMessageId: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
  uiParts: unknown[] | null
  attachmentIds: string[] | null
  filesMetadata: Array<Record<string, unknown>> | null
  model: string | null
  metadata: Record<string, unknown> | null
  createdByUserId: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

let idCounter = 0

function matchesWhere(row: Record<string, any>, where: any): boolean {
  if (!where) return true
  for (const key of Object.keys(where)) {
    const expected = where[key]
    const actual = row[key] ?? null
    if (expected && typeof expected === 'object' && '$lt' in expected) {
      const lt = expected.$lt as Date
      if (!(actual instanceof Date) || !(actual.getTime() < lt.getTime())) return false
      continue
    }
    if (expected === null) {
      if (actual !== null && actual !== undefined) return false
      continue
    }
    if (actual !== expected) return false
  }
  return true
}

function applyOrder<T extends Record<string, any>>(rows: T[], orderBy: any): T[] {
  if (!orderBy) return rows
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy]
  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      for (const [field, direction] of Object.entries(clause)) {
        const av = a[field]
        const bv = b[field]
        const aTime = av instanceof Date ? av.getTime() : av ?? null
        const bTime = bv instanceof Date ? bv.getTime() : bv ?? null
        if (aTime === bTime) continue
        if (aTime === null) return direction === 'asc' ? -1 : 1
        if (bTime === null) return direction === 'asc' ? 1 : -1
        if (aTime < bTime) return direction === 'asc' ? -1 : 1
        return direction === 'asc' ? 1 : -1
      }
    }
    return 0
  })
}

function entityKey(entity: unknown): 'conv' | 'participant' | 'message' | null {
  if (entity === AiChatConversation) return 'conv'
  if (entity === AiChatConversationParticipant) return 'participant'
  if (entity === AiChatMessage) return 'message'
  return null
}

function mockEm() {
  const stores: Record<'conv' | 'participant' | 'message', any[]> = {
    conv: [],
    participant: [],
    message: [],
  }

  const find = async (entity: unknown, where: any, options?: any): Promise<any[]> => {
    const key = entityKey(entity)
    if (!key) return []
    let rows = stores[key].filter((row) => matchesWhere(row, where))
    rows = applyOrder(rows, options?.orderBy)
    if (typeof options?.limit === 'number') rows = rows.slice(0, options.limit)
    return rows
  }

  const pendingPersist: any[] = []

  const em: any = {
    find,
    findOne: async (entity: unknown, where: any, options?: any) => {
      const rows = await find(entity, where, options)
      return rows[0] ?? null
    },
    create: (entity: unknown, data: any) => {
      idCounter += 1
      const key = entityKey(entity)
      if (!key) throw new Error(`Unknown entity in mock EM`)
      if (key === 'conv') {
        const row: ConvRow = {
          id: `conv-${idCounter}`,
          tenantId: data.tenantId,
          organizationId: data.organizationId ?? null,
          conversationId: data.conversationId,
          agentId: data.agentId,
          ownerUserId: data.ownerUserId,
          title: data.title ?? null,
          status: data.status ?? 'open',
          visibility: data.visibility ?? 'private',
          pageContext: data.pageContext ?? null,
          lastMessageAt: data.lastMessageAt ?? null,
          importedFromLocalAt: data.importedFromLocalAt ?? null,
          createdAt: data.createdAt instanceof Date ? data.createdAt : new Date(),
          updatedAt: data.updatedAt instanceof Date ? data.updatedAt : new Date(),
          deletedAt: data.deletedAt ?? null,
        }
        return row
      }
      if (key === 'participant') {
        const row: ParticipantRow = {
          id: `part-${idCounter}`,
          tenantId: data.tenantId,
          organizationId: data.organizationId ?? null,
          conversationId: data.conversationId,
          userId: data.userId,
          role: data.role ?? 'owner',
          lastReadAt: data.lastReadAt ?? null,
          createdAt: data.createdAt instanceof Date ? data.createdAt : new Date(),
          updatedAt: data.updatedAt instanceof Date ? data.updatedAt : new Date(),
        }
        return row
      }
      const row: MessageRow = {
        id: `msg-${idCounter}`,
        tenantId: data.tenantId,
        organizationId: data.organizationId ?? null,
        conversationId: data.conversationId,
        clientMessageId: data.clientMessageId ?? null,
        role: data.role,
        content: data.content,
        uiParts: data.uiParts ?? null,
        attachmentIds: data.attachmentIds ?? null,
        filesMetadata: data.filesMetadata ?? null,
        model: data.model ?? null,
        metadata: data.metadata ?? null,
        createdByUserId: data.createdByUserId ?? null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : new Date(),
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : new Date(),
        deletedAt: data.deletedAt ?? null,
      }
      return row
    },
    persist: (row: any) => {
      pendingPersist.push(row)
      return em
    },
    flush: async () => {
      while (pendingPersist.length > 0) {
        const row = pendingPersist.shift()
        if (!row) continue
        const key: 'conv' | 'participant' | 'message' = row.id.startsWith('conv-')
          ? 'conv'
          : row.id.startsWith('part-')
            ? 'participant'
            : 'message'
        const store = stores[key]
        const idx = store.findIndex((candidate) => candidate.id === row.id)
        if (idx >= 0) store[idx] = row
        else store.push(row)
      }
    },
    transactional: async (fn: (tx: any) => Promise<unknown>) => fn(em),
    __stores: stores,
  }

  return em
}

const tenantAlpha = 't-alpha'
const tenantBeta = 't-beta'

describe('AiChatConversationRepository', () => {
  it('createOrGet writes an owner participant row in the same transaction', async () => {
    const em = mockEm()
    const repo = new AiChatConversationRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }

    const row = await repo.createOrGet(
      {
        conversationId: 'conv-1',
        agentId: 'catalog.merchandising_assistant',
        title: 'Pricing work',
      },
      ctx,
    )

    expect(row.conversationId).toBe('conv-1')
    expect(row.ownerUserId).toBe('u-1')
    expect(row.status).toBe('open')
    expect(em.__stores.participant).toHaveLength(1)
    expect(em.__stores.participant[0].userId).toBe('u-1')
    expect(em.__stores.participant[0].role).toBe('owner')
  })

  it('createOrGet is idempotent for the same caller within a tenant', async () => {
    const em = mockEm()
    const repo = new AiChatConversationRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }
    const first = await repo.createOrGet(
      { conversationId: 'conv-42', agentId: 'catalog.merchandising_assistant' },
      ctx,
    )
    const second = await repo.createOrGet(
      { conversationId: 'conv-42', agentId: 'catalog.merchandising_assistant' },
      ctx,
    )
    expect(second.id).toBe(first.id)
    expect(em.__stores.conv).toHaveLength(1)
    expect(em.__stores.participant).toHaveLength(1)
  })

  it('createOrGet refuses to surface a conversation owned by a different user (cross-user denial)', async () => {
    const em = mockEm()
    const repo = new AiChatConversationRepository(em)
    const ctx1 = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }
    const ctx2 = { tenantId: tenantAlpha, organizationId: null, userId: 'u-2' }
    await repo.createOrGet(
      { conversationId: 'conv-x', agentId: 'catalog.merchandising_assistant' },
      ctx1,
    )
    await expect(
      repo.createOrGet(
        { conversationId: 'conv-x', agentId: 'catalog.merchandising_assistant' },
        ctx2,
      ),
    ).rejects.toBeInstanceOf(AiChatConversationAccessError)
  })

  it('getById returns null for cross-tenant lookups even when the conversation id collides', async () => {
    const em = mockEm()
    const repo = new AiChatConversationRepository(em)
    await repo.createOrGet(
      { conversationId: 'duplicate-id', agentId: 'a' },
      { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' },
    )
    await repo.createOrGet(
      { conversationId: 'duplicate-id', agentId: 'a' },
      { tenantId: tenantBeta, organizationId: null, userId: 'u-2' },
    )
    const result = await repo.getById('duplicate-id', {
      tenantId: tenantAlpha,
      organizationId: null,
      userId: 'u-2',
    })
    expect(result).toBeNull()
  })

  it('appendMessage with the same clientMessageId returns the existing row without duplicating', async () => {
    const em = mockEm()
    const repo = new AiChatConversationRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }
    await repo.createOrGet({ conversationId: 'c1', agentId: 'a' }, ctx)

    const first = await repo.appendMessage(
      'c1',
      { role: 'user', content: 'Hello', clientMessageId: 'm-1' },
      ctx,
    )
    const second = await repo.appendMessage(
      'c1',
      { role: 'user', content: 'Hello (retry)', clientMessageId: 'm-1' },
      ctx,
    )
    expect(second.id).toBe(first.id)
    expect(em.__stores.message).toHaveLength(1)
    expect(em.__stores.message[0].content).toBe('Hello')
  })

  it('appendMessage updates the conversation `lastMessageAt`', async () => {
    const em = mockEm()
    const repo = new AiChatConversationRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }
    await repo.createOrGet({ conversationId: 'c1', agentId: 'a' }, ctx)
    const at = new Date('2026-05-18T12:00:00.000Z')
    await repo.appendMessage(
      'c1',
      { role: 'user', content: 'Hi', clientMessageId: 'm-1' },
      ctx,
      { createdAt: at },
    )
    expect(em.__stores.conv[0].lastMessageAt).toEqual(at)
  })

  it('appendMessage refuses to write into another user\'s conversation', async () => {
    const em = mockEm()
    const repo = new AiChatConversationRepository(em)
    await repo.createOrGet(
      { conversationId: 'c-owned', agentId: 'a' },
      { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' },
    )
    await expect(
      repo.appendMessage(
        'c-owned',
        { role: 'user', content: 'evil' },
        { tenantId: tenantAlpha, organizationId: null, userId: 'u-2' },
      ),
    ).rejects.toBeInstanceOf(AiChatConversationAccessError)
  })

  it('softDelete marks the conversation and all messages as deleted in one transaction', async () => {
    const em = mockEm()
    const repo = new AiChatConversationRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }
    await repo.createOrGet({ conversationId: 'c1', agentId: 'a' }, ctx)
    await repo.appendMessage(
      'c1',
      { role: 'user', content: 'a', clientMessageId: 'm-a' },
      ctx,
    )
    await repo.appendMessage(
      'c1',
      { role: 'assistant', content: 'b', clientMessageId: 'm-b' },
      ctx,
    )
    const at = new Date('2026-05-18T13:00:00.000Z')
    await repo.softDelete('c1', ctx, at)
    expect(em.__stores.conv[0].deletedAt).toEqual(at)
    expect(em.__stores.conv[0].status).toBe('closed')
    expect(em.__stores.message.every((row: MessageRow) => row.deletedAt instanceof Date)).toBe(true)
  })

  it('list only returns conversations owned by the caller', async () => {
    const em = mockEm()
    const repo = new AiChatConversationRepository(em)
    const u1 = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }
    const u2 = { tenantId: tenantAlpha, organizationId: null, userId: 'u-2' }
    await repo.createOrGet({ conversationId: 'a', agentId: 'x' }, u1)
    await repo.createOrGet({ conversationId: 'b', agentId: 'x' }, u2)
    const result = await repo.list(u1, { agentId: 'x' })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].conversationId).toBe('a')
  })

  it('list filters by agentId when supplied', async () => {
    const em = mockEm()
    const repo = new AiChatConversationRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }
    await repo.createOrGet({ conversationId: 'a', agentId: 'agent-a' }, ctx)
    await repo.createOrGet({ conversationId: 'b', agentId: 'agent-b' }, ctx)
    const result = await repo.list(ctx, { agentId: 'agent-b' })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].agentId).toBe('agent-b')
  })

  it('importLocalConversation imports unique messages and skips duplicates idempotently', async () => {
    const em = mockEm()
    const repo = new AiChatConversationRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }
    const payload = {
      conversation: { conversationId: 'imp-1', agentId: 'x', title: 'Imported' },
      messages: [
        { role: 'user' as const, content: 'hi', clientMessageId: 'm-1' },
        { role: 'assistant' as const, content: 'hello', clientMessageId: 'm-2' },
      ],
    }
    const first = await repo.importLocalConversation(payload, ctx)
    expect(first.importedMessageCount).toBe(2)
    expect(first.skippedMessageCount).toBe(0)

    const second = await repo.importLocalConversation(payload, ctx)
    expect(second.importedMessageCount).toBe(0)
    expect(second.skippedMessageCount).toBe(2)
    expect(em.__stores.message).toHaveLength(2)
    expect(em.__stores.conv[0].importedFromLocalAt).not.toBeNull()
  })

  it('importLocalConversation skips messages without a clientMessageId (no dedupe key)', async () => {
    const em = mockEm()
    const repo = new AiChatConversationRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }
    const result = await repo.importLocalConversation(
      {
        conversation: { conversationId: 'imp-2', agentId: 'x' },
        messages: [{ role: 'user', content: 'no-id' }],
      },
      ctx,
    )
    expect(result.importedMessageCount).toBe(0)
    expect(result.skippedMessageCount).toBe(1)
    expect(em.__stores.message).toHaveLength(0)
  })

  it('getTranscript returns messages ascending and emits a usable forward-pagination cursor', async () => {
    const em = mockEm()
    const repo = new AiChatConversationRepository(em)
    const ctx = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }
    await repo.createOrGet({ conversationId: 'paged', agentId: 'a' }, ctx)
    for (let i = 0; i < 5; i += 1) {
      await repo.appendMessage(
        'paged',
        { role: 'user', content: `m${i}`, clientMessageId: `cm-${i}` },
        ctx,
        { createdAt: new Date(`2026-05-18T12:0${i}:00.000Z`) },
      )
    }

    const firstPage = await repo.getTranscript('paged', ctx, { limit: 2 })
    expect(firstPage).not.toBeNull()
    expect(firstPage!.messages.map((m) => m.content)).toEqual(['m3', 'm4'])
    expect(firstPage!.nextCursor).toBe(new Date('2026-05-18T12:03:00.000Z').toISOString())

    const secondPage = await repo.getTranscript('paged', ctx, {
      limit: 2,
      before: firstPage!.nextCursor!,
    })
    expect(secondPage).not.toBeNull()
    expect(secondPage!.messages.map((m) => m.content)).toEqual(['m1', 'm2'])
    expect(secondPage!.nextCursor).toBe(new Date('2026-05-18T12:01:00.000Z').toISOString())

    const thirdPage = await repo.getTranscript('paged', ctx, {
      limit: 2,
      before: secondPage!.nextCursor!,
    })
    expect(thirdPage).not.toBeNull()
    expect(thirdPage!.messages.map((m) => m.content)).toEqual(['m0'])
    expect(thirdPage!.nextCursor).toBeNull()
  })

  it('getTranscript refuses to leak a transcript to a non-owner', async () => {
    const em = mockEm()
    const repo = new AiChatConversationRepository(em)
    const owner = { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' }
    const intruder = { tenantId: tenantAlpha, organizationId: null, userId: 'u-2' }
    await repo.createOrGet({ conversationId: 'private', agentId: 'a' }, owner)
    await repo.appendMessage(
      'private',
      { role: 'user', content: 'secret', clientMessageId: 'cm-1' },
      owner,
    )
    const leak = await repo.getTranscript('private', intruder)
    expect(leak).toBeNull()
  })

  it('update refuses to touch a conversation owned by another user', async () => {
    const em = mockEm()
    const repo = new AiChatConversationRepository(em)
    await repo.createOrGet(
      { conversationId: 'c-owned', agentId: 'a' },
      { tenantId: tenantAlpha, organizationId: null, userId: 'u-1' },
    )
    await expect(
      repo.update(
        'c-owned',
        { title: 'hijacked' },
        { tenantId: tenantAlpha, organizationId: null, userId: 'u-2' },
      ),
    ).rejects.toBeInstanceOf(AiChatConversationAccessError)
  })
})
