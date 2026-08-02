/** @jest-environment node */

// P3 audit coverage for #3386: proves that the messages GET handler uses the
// correct two-phase shape — Kysely SQL ORDER BY m.sent_at + LIMIT/OFFSET
// (non-encrypted field) produces a bounded page of IDs, then findWithDecryption
// is called only for those IDs, never for the full result set.

import {
  Kysely,
  PostgresAdapter,
  PostgresQueryCompiler,
  PostgresIntrospector,
  DummyDriver,
  type CompiledQuery,
} from 'kysely'
import { Message, MessageObject } from '../../data/entities'
import { User } from '../../../auth/data/entities'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const resolveMessageContextMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  canUseMessageEmailFeature: jest.fn(async () => true),
}))

jest.mock('@open-mercato/core/modules/messages/lib/searchLookup', () => ({
  findMessageIdsBySearchTokens: jest.fn(async () => []),
}))

jest.mock('@open-mercato/core/modules/messages/lib/message-types-registry', () => ({
  getMessageType: jest.fn(() => null),
}))

const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

const recordedQueries: CompiledQuery[] = []

function isScopeQuery(q: CompiledQuery): boolean {
  const s = q.sql.toLowerCase()
  // The scope query selects message rows and is the only one with ORDER BY
  return s.includes('messages') && s.includes('order by')
}

function createRecordingKysely(): Kysely<any> {
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
    },
  })

  ;(db.getExecutor() as any).executeQuery = async (q: CompiledQuery) => {
    recordedQueries.push(q)

    const s = q.sql.toLowerCase()

    if (s.includes('count(*)')) {
      return { rows: [{ count: '3' }] }
    }

    if (isScopeQuery(q)) {
      return {
        rows: [
          { id: 'msg-a', sender_user_id: userId, is_draft: false, recipient_status: null, read_at: null },
          { id: 'msg-b', sender_user_id: userId, is_draft: false, recipient_status: null, read_at: null },
        ],
      }
    }

    return { rows: [] }
  }

  return db
}

function makeMessage(id: string): Partial<Message> {
  return {
    id,
    type: 'default',
    visibility: null,
    sourceEntityType: null,
    sourceEntityId: null,
    externalEmail: null,
    externalName: null,
    subject: `Subject ${id}`,
    body: `Body ${id}`,
    senderUserId: userId,
    priority: null,
    actionData: null,
    actionTaken: null,
    sentAt: new Date('2026-01-01T00:00:00Z'),
    threadId: null,
  } as unknown as Partial<Message>
}

import { GET } from '../route'

function buildMockEm() {
  return {
    getKysely: () => createRecordingKysely(),
    find: jest.fn(async (entity: unknown) => {
      if (entity === MessageObject) return []
      return []
    }),
  }
}

beforeEach(() => {
  recordedQueries.length = 0
  findWithDecryptionMock.mockReset()

  findWithDecryptionMock.mockImplementation(
    async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === Message) {
        const ids = (where as any)?.id?.$in as string[] | undefined
        return (ids ?? []).map(makeMessage)
      }
      if (entity === User) return []
      return []
    },
  )

  resolveMessageContextMock.mockResolvedValue({
    ctx: {
      container: { resolve: (name: string) => (name === 'em' ? buildMockEm() : null) },
    },
    scope: { tenantId, organizationId: orgId, userId },
  })
})

describe('messages GET — encrypted-sort audit (#3386 P3)', () => {
  it('sorts at SQL level on m.sent_at (non-encrypted column), not in-memory after decrypt', async () => {
    const res = await GET(new Request(`http://localhost/api/messages?pageSize=2`))
    expect(res.status).toBe(200)

    const scopeQuery = recordedQueries.find(isScopeQuery)
    expect(scopeQuery).toBeDefined()
    expect(scopeQuery!.sql.toLowerCase()).toMatch(/order by\s+"m"\."sent_at"\s+desc/)
  })

  it('passes LIMIT and OFFSET so pagination is DB-side, not in-memory', async () => {
    const res = await GET(new Request(`http://localhost/api/messages?page=2&pageSize=2`))
    expect(res.status).toBe(200)

    const scopeQuery = recordedQueries.find(isScopeQuery)
    expect(scopeQuery).toBeDefined()
    expect(scopeQuery!.sql.toLowerCase()).toMatch(/limit/)
    expect(scopeQuery!.sql.toLowerCase()).toMatch(/offset/)
  })

  it('calls findWithDecryption for Message only with the bounded page IDs, never the full set', async () => {
    const res = await GET(new Request(`http://localhost/api/messages?pageSize=2`))
    expect(res.status).toBe(200)

    const messageCalls = findWithDecryptionMock.mock.calls.filter(
      ([, entity]) => entity === Message,
    )
    expect(messageCalls).toHaveLength(1)

    const [, , where] = messageCalls[0] as [unknown, unknown, Record<string, unknown>]
    const ids = (where as any)?.id?.$in as string[]
    // Must be exactly the two IDs the SQL scope query returned — bounded to the page
    expect(ids).toEqual(['msg-a', 'msg-b'])
  })

  it('returns the decrypted message fields, confirming the two phases connect end-to-end', async () => {
    const res = await GET(new Request(`http://localhost/api/messages?pageSize=2`))
    const body = await res.json() as { items: { id: string; subject: string }[] }
    expect(body.items).toHaveLength(2)
    expect(body.items[0]!.subject).toBe('Subject msg-a')
    expect(body.items[1]!.subject).toBe('Subject msg-b')
  })
})
