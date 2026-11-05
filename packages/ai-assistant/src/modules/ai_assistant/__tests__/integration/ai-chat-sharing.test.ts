import {
  AiChatConversation,
  AiChatConversationParticipant,
  AiChatMessage,
} from '../../data/entities'
import {
  AiChatConversationRepository,
} from '../../data/repositories/AiChatConversationRepository'

// ─── In-memory ORM mock ────────────────────────────────────────────────────

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
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

let idCounter = 0

function matchesWhere(row: Record<string, any>, where: any): boolean {
  if (!where) return true
  for (const key of Object.keys(where)) {
    if (key === '$or') {
      const branches: any[] = where.$or
      if (!branches.some((branch) => matchesWhere(row, branch))) return false
      continue
    }
    const expected = where[key]
    const actual = row[key] ?? null
    if (expected && typeof expected === 'object') {
      if ('$lt' in expected) {
        const lt = expected.$lt as Date
        if (!(actual instanceof Date) || !(actual.getTime() < lt.getTime())) return false
        continue
      }
      if ('$in' in expected) {
        const list = expected.$in as unknown[]
        if (!list.includes(actual)) return false
        continue
      }
      if ('$ne' in expected) {
        if (actual === expected.$ne) return false
        continue
      }
    }
    if (expected === null) {
      if (actual !== null && actual !== undefined) return false
      continue
    }
    if (actual !== expected) return false
  }
  return true
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
    if (typeof options?.limit === 'number') rows = rows.slice(0, options.limit)
    return rows
  }

  const pendingPersist: any[] = []

  const em: any = {
    find,
    findOne: async (entity: unknown, where: any) => {
      const rows = await find(entity, where)
      return rows[0] ?? null
    },
    count: async (entity: unknown, where: any): Promise<number> => {
      const rows = await find(entity, where)
      return rows.length
    },
    create: (entity: unknown, data: any) => {
      idCounter += 1
      const key = entityKey(entity)
      if (key === 'conv') {
        const row: ConvRow = {
          id: `conv-${idCounter}`,
          tenantId: data.tenantId,
          organizationId: data.organizationId ?? null,
          conversationId: data.conversationId,
          agentId: data.agentId ?? 'test-agent',
          ownerUserId: data.ownerUserId,
          title: data.title ?? null,
          status: data.status ?? 'open',
          visibility: data.visibility ?? 'private',
          pageContext: data.pageContext ?? null,
          lastMessageAt: data.lastMessageAt ?? null,
          importedFromLocalAt: data.importedFromLocalAt ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
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
          deletedAt: data.deletedAt ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        return row
      }
      throw new Error(`Unknown entity in mock EM`)
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
        const idx = store.findIndex((c) => c.id === row.id)
        if (idx >= 0) store[idx] = row
        else store.push(row)
      }
    },
    transactional: async (fn: (tx: any) => Promise<unknown>) => fn(em),
    __stores: stores,
  }
  return em
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function seedConversation(
  em: ReturnType<typeof mockEm>,
  overrides: Partial<ConvRow> & { conversationId: string; tenantId: string; ownerUserId: string },
) {
  idCounter += 1
  const row: ConvRow = {
    id: `conv-${idCounter}`,
    organizationId: null,
    agentId: 'test-agent',
    title: null,
    status: 'open',
    visibility: 'private',
    pageContext: null,
    lastMessageAt: null,
    importedFromLocalAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  }
  em.__stores.conv.push(row)
  return row
}

function seedParticipant(
  em: ReturnType<typeof mockEm>,
  overrides: Partial<ParticipantRow> & { conversationId: string; tenantId: string; userId: string },
) {
  idCounter += 1
  const row: ParticipantRow = {
    id: `part-${idCounter}`,
    organizationId: null,
    role: 'viewer',
    lastReadAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
  em.__stores.participant.push(row)
  return row
}

// ─── Test suite ───────────────────────────────────────────────────────────

const TENANT_A = 'tenant-alpha'
const TENANT_B = 'tenant-beta'
const CONV_ID = 'conv-share-001'
const OWNER_ID = 'user-owner'
const VIEWER_ID = 'user-viewer'
const STRANGER_ID = 'user-stranger'

describe('TC-AI-sharing-01: owner access baseline', () => {
  it('owner can retrieve their own conversation via getById', async () => {
    const em = mockEm()
    seedConversation(em, {
      conversationId: CONV_ID,
      tenantId: TENANT_A,
      ownerUserId: OWNER_ID,
    })

    const repo = new AiChatConversationRepository(em)
    const result = await repo.getById(CONV_ID, {
      tenantId: TENANT_A,
      organizationId: null,
      userId: OWNER_ID,
      canManageConversations: false,
    })

    expect(result).not.toBeNull()
    expect(result?.conversationId).toBe(CONV_ID)
    expect(result?.ownerUserId).toBe(OWNER_ID)
  })
})

describe('TC-AI-sharing-02: participant access', () => {
  it('viewer participant can access a shared conversation via getById', async () => {
    const em = mockEm()
    seedConversation(em, {
      conversationId: CONV_ID,
      tenantId: TENANT_A,
      ownerUserId: OWNER_ID,
      visibility: 'shared',
    })
    seedParticipant(em, {
      conversationId: CONV_ID,
      tenantId: TENANT_A,
      userId: VIEWER_ID,
      role: 'viewer',
    })

    const repo = new AiChatConversationRepository(em)
    const result = await repo.getById(CONV_ID, {
      tenantId: TENANT_A,
      organizationId: null,
      userId: VIEWER_ID,
      canManageConversations: false,
    })

    expect(result).not.toBeNull()
    expect(result?.conversationId).toBe(CONV_ID)
  })

  it('participant also sees shared conversation in list', async () => {
    const em = mockEm()
    seedConversation(em, {
      conversationId: CONV_ID,
      tenantId: TENANT_A,
      ownerUserId: OWNER_ID,
      visibility: 'shared',
    })
    seedParticipant(em, {
      conversationId: CONV_ID,
      tenantId: TENANT_A,
      userId: VIEWER_ID,
      role: 'viewer',
    })

    const repo = new AiChatConversationRepository(em)
    const { items } = await repo.list(
      { tenantId: TENANT_A, organizationId: null, userId: VIEWER_ID, canManageConversations: false },
    )

    expect(items.some((c) => c.conversationId === CONV_ID)).toBe(true)
  })
})

describe('TC-AI-sharing-03: non-participant denial', () => {
  it('user without participant row cannot access another user\'s conversation', async () => {
    const em = mockEm()
    seedConversation(em, {
      conversationId: CONV_ID,
      tenantId: TENANT_A,
      ownerUserId: OWNER_ID,
    })

    const repo = new AiChatConversationRepository(em)
    const result = await repo.getById(CONV_ID, {
      tenantId: TENANT_A,
      organizationId: null,
      userId: STRANGER_ID,
      canManageConversations: false,
    })

    expect(result).toBeNull()
  })

  it('revoked participant (deletedAt set) cannot access the conversation', async () => {
    const em = mockEm()
    seedConversation(em, {
      conversationId: CONV_ID,
      tenantId: TENANT_A,
      ownerUserId: OWNER_ID,
      visibility: 'shared',
    })
    seedParticipant(em, {
      conversationId: CONV_ID,
      tenantId: TENANT_A,
      userId: VIEWER_ID,
      role: 'viewer',
      deletedAt: new Date(),
    })

    const repo = new AiChatConversationRepository(em)
    const result = await repo.getById(CONV_ID, {
      tenantId: TENANT_A,
      organizationId: null,
      userId: VIEWER_ID,
      canManageConversations: false,
    })

    expect(result).toBeNull()
  })
})

describe('TC-AI-sharing-04: manager override', () => {
  it('manager (canManageConversations=true) can access any conversation in their tenant', async () => {
    const em = mockEm()
    seedConversation(em, {
      conversationId: CONV_ID,
      tenantId: TENANT_A,
      ownerUserId: OWNER_ID,
    })

    const repo = new AiChatConversationRepository(em)
    const result = await repo.getById(CONV_ID, {
      tenantId: TENANT_A,
      organizationId: null,
      userId: STRANGER_ID,
      canManageConversations: true,
    })

    expect(result).not.toBeNull()
    expect(result?.conversationId).toBe(CONV_ID)
  })
})

describe('TC-AI-sharing-05: cross-tenant denial', () => {
  it('participant row from a different tenant does not grant access', async () => {
    const em = mockEm()
    seedConversation(em, {
      conversationId: CONV_ID,
      tenantId: TENANT_A,
      ownerUserId: OWNER_ID,
    })
    // Malicious scenario: participant row for VIEWER_ID but with TENANT_B tenant scope
    seedParticipant(em, {
      conversationId: CONV_ID,
      tenantId: TENANT_B,
      userId: VIEWER_ID,
      role: 'viewer',
    })

    const repo = new AiChatConversationRepository(em)
    // VIEWER_ID attempts access via TENANT_B context — should fail because the
    // conversation belongs to TENANT_A, so findOneAccessibleConversation returns null.
    const result = await repo.getById(CONV_ID, {
      tenantId: TENANT_B,
      organizationId: null,
      userId: VIEWER_ID,
      canManageConversations: false,
    })

    expect(result).toBeNull()
  })
})
