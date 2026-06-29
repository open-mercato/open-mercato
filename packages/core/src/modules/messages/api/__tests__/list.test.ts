/** @jest-environment node */

// P3 audit coverage for #3386 after the messages list was moved behind
// makeCrudRoute: the route must delegate sorting/pagination to the CRUD
// factory on the non-encrypted sent_at column. Message decryption remains
// owned by the CRUD factory's bounded list path, not by the visibility filter.

const crudGetMock = jest.fn(async () => Response.json({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 }))
type MessageCrudOptions = {
  list: {
    sortFieldMap: Record<string, string>
    buildFilters: (
      input: Record<string, unknown>,
      ctx: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>
  }
}
let crudOptions: MessageCrudOptions | null = null

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: MessageCrudOptions) => {
    crudOptions = opts
    return {
      GET: crudGetMock,
      POST: jest.fn(),
      PUT: jest.fn(),
      DELETE: jest.fn(),
    }
  }),
}))

const findWithDecryptionMock = jest.fn()
const findMessageIdsBySearchTokensMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: jest.fn(),
  canUseMessageEmailFeature: jest.fn(async () => true),
}))

jest.mock('@open-mercato/core/modules/messages/lib/searchLookup', () => ({
  findMessageIdsBySearchTokens: (...args: unknown[]) => findMessageIdsBySearchTokensMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/message-types-registry', () => ({
  getMessageType: jest.fn(() => null),
}))

import { GET } from '../route'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

function getCrudOptions() {
  if (!crudOptions) throw new Error('makeCrudRoute was not called')
  return crudOptions
}

function createQueryBuilder(result: unknown) {
  const builder: Record<string, jest.Mock> = {}
  const chain = jest.fn(() => builder)
  const joinBuilder = {
    onRef: jest.fn(() => joinBuilder),
    on: jest.fn(() => joinBuilder),
  }
  const expressionBuilder = {
    or: jest.fn((value) => value),
    exists: jest.fn((value) => value),
    not: jest.fn((value) => value),
    selectFrom: jest.fn(() => builder),
  }
  Object.assign(builder, {
    select: chain,
    where: jest.fn((arg: unknown) => {
      if (typeof arg === 'function') arg(expressionBuilder)
      return builder
    }),
    whereRef: chain,
    leftJoin: jest.fn((_table: string, callback?: (jb: typeof joinBuilder) => unknown) => {
      if (callback) callback(joinBuilder)
      return builder
    }),
    groupBy: chain,
    execute: jest.fn(async () => result),
  })
  return builder
}

function createEmMock() {
  const db = {
    selectFrom: jest.fn((table: string) => {
      if (table === 'messages as m') return createQueryBuilder([{ id: 'msg-a' }, { id: 'msg-b' }])
      return createQueryBuilder([])
    }),
  }

  return {
    getKysely: jest.fn(() => db),
    find: jest.fn(async () => []),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  findMessageIdsBySearchTokensMock.mockResolvedValue([])
})

describe('messages GET encrypted-sort audit (#3386 P3)', () => {
  it('delegates default sorting to makeCrudRoute on sentAt desc', async () => {
    const res = await GET(new Request('http://localhost/api/messages?pageSize=2'))
    expect(res.status).toBe(200)

    const delegatedRequest = crudGetMock.mock.calls[0]?.[0] as Request
    const delegatedUrl = new URL(delegatedRequest.url)
    expect(delegatedUrl.searchParams.get('sortField')).toBe('sentAt')
    expect(delegatedUrl.searchParams.get('sortDir')).toBe('desc')
    expect(delegatedUrl.searchParams.get('pageSize')).toBe('2')
  })

  it('preserves explicit sort parameters for the CRUD factory', async () => {
    await GET(new Request('http://localhost/api/messages?sortField=subject&sortDir=asc'))

    const delegatedRequest = crudGetMock.mock.calls[0]?.[0] as Request
    const delegatedUrl = new URL(delegatedRequest.url)
    expect(delegatedUrl.searchParams.get('sortField')).toBe('subject')
    expect(delegatedUrl.searchParams.get('sortDir')).toBe('asc')
  })

  it('maps the default sentAt sort to the non-encrypted sent_at column', () => {
    const opts = getCrudOptions()

    expect(opts.list.sortFieldMap.sentAt).toBe('sent_at')
    expect(opts.list.sortFieldMap.sent_at).toBe('sent_at')
  })

  it('keeps visibility filtering separate from bounded message decryption', async () => {
    const opts = getCrudOptions()
    const em = createEmMock()
    const ctx = {
      auth: { tenantId, orgId, sub: userId },
      selectedOrganizationId: orgId,
      container: {
        resolve: (name: string) => (name === 'em' ? em : null),
      },
    }

    const filter = await opts.list.buildFilters({ folder: 'inbox' }, ctx)

    expect(filter).toEqual({ id: { $in: ['msg-a', 'msg-b'] } })
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })
})
