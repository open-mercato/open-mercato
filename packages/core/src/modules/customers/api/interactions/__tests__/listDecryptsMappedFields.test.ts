import {
  Kysely,
  PostgresAdapter,
  PostgresQueryCompiler,
  PostgresIntrospector,
  DummyDriver,
  type CompiledQuery,
} from 'kysely'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const interactionId = '33333333-3333-4333-8333-333333333333'

let listRows: Array<Record<string, unknown>> = []

function createKysely(): Kysely<any> {
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<any>) => new PostgresIntrospector(instance),
    },
  })
  ;(db.getExecutor() as any).executeQuery = async (compiledQuery: CompiledQuery) => {
    if (!compiledQuery.sql.includes('customer_interactions')) return { rows: [] }
    return { rows: listRows }
  }
  return db
}

const fakeEm = {
  fork() {
    return { getKysely: () => createKysely() }
  },
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (token: string) => (token === 'em' ? fakeEm : undefined),
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ tenantId, orgId, sub: null, isApiKey: true }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({ filterIds: [orgId], selectedId: orgId }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('@open-mercato/shared/lib/crud/enricher-runner', () => ({
  applyResponseEnrichers: async (items: unknown[]) => ({ items }),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: async () => ({}),
}))

const mockGetEncryptedFieldNames = jest.fn<Promise<string[]>, unknown[]>(async () => ['title', 'body'])
jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: () => ({
    isEnabled: () => true,
    getEncryptedFieldNames: (...args: unknown[]) => mockGetEncryptedFieldNames(...args),
    decryptEntityPayload: async (_entityId: string, payload: Record<string, unknown>) => payload,
  }),
}))

let decryptedInteractions: Array<Record<string, unknown>> = []
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: async (_em: unknown, entity: unknown) => {
    const name = typeof entity === 'function' ? (entity as { name: string }).name : String(entity)
    return name === 'CustomerInteraction' ? decryptedInteractions : []
  },
}))

import { GET } from '../route'

function ciphertextRow(overrides: Record<string, unknown> = {}) {
  return {
    id: interactionId,
    entity_id: '44444444-4444-4444-8444-444444444444',
    deal_id: null,
    interaction_type: 'meeting',
    title: 'enc:v1:title',
    body: 'enc:v1:body',
    status: 'planned',
    scheduled_at: null,
    occurred_at: null,
    priority: null,
    author_user_id: null,
    owner_user_id: null,
    external_message_id: null,
    appearance_icon: null,
    appearance_color: null,
    source: null,
    duration_minutes: null,
    location: 'enc:v1:location',
    all_day: null,
    recurrence_rule: null,
    recurrence_end: null,
    participants: 'enc:v1:participants',
    reminder_minutes: null,
    visibility: null,
    linked_entities: null,
    guest_permissions: null,
    pinned: false,
    organization_id: orgId,
    tenant_id: tenantId,
    created_at: new Date('2026-03-01T00:00:00.000Z'),
    updated_at: new Date('2026-03-01T00:00:00.000Z'),
    __sort_value: new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  }
}

const decryptedParticipants = [{ email: 'guest@example.test', name: 'Guest' }]

function decryptedInteraction(overrides: Record<string, unknown> = {}) {
  return {
    id: interactionId,
    title: 'Quarterly review',
    body: 'Agenda and notes',
    location: 'https://meet.example.test/room-42',
    participants: decryptedParticipants,
    ...overrides,
  }
}

async function listItems() {
  const res = await GET(new Request('https://example.test/api/customers/interactions'))
  expect(res.status).toBe(200)
  const payload = await res.json()
  return payload.items as Array<Record<string, unknown>>
}

beforeEach(() => {
  listRows = [ciphertextRow()]
  decryptedInteractions = [decryptedInteraction()]
  mockGetEncryptedFieldNames.mockReset()
  mockGetEncryptedFieldNames.mockImplementation(async () => ['title', 'body'])
})

describe('interactions list — decrypts every encryption-map field (#5945)', () => {
  test('a map extended beyond title/body returns plaintext for the added fields', async () => {
    mockGetEncryptedFieldNames.mockImplementation(async () => ['title', 'body', 'location', 'participants'])

    const [item] = await listItems()

    expect(item.location).toBe('https://meet.example.test/room-42')
    expect(item.participants).toEqual(decryptedParticipants)
    expect(item.title).toBe('Quarterly review')
    expect(item.body).toBe('Agenda and notes')
  })

  test('the field set comes from the resolved map for the caller tenant and organization', async () => {
    await listItems()

    expect(mockGetEncryptedFieldNames).toHaveBeenCalledWith('customers:customer_interaction', tenantId, orgId)
  })

  test('the shipped title/body map keeps decrypting exactly those two fields', async () => {
    const [item] = await listItems()

    expect(item.title).toBe('Quarterly review')
    expect(item.body).toBe('Agenda and notes')
    expect(item.location).toBe('enc:v1:location')
  })

  test('with encryption disabled the response keeps the raw column values', async () => {
    mockGetEncryptedFieldNames.mockImplementation(async () => [])
    listRows = [ciphertextRow({ title: 'Plain title', body: 'Plain body', location: 'Room 4' })]

    const [item] = await listItems()

    expect(item.title).toBe('Plain title')
    expect(item.body).toBe('Plain body')
    expect(item.location).toBe('Room 4')
  })

  test('a row with no decrypted record falls back to its raw column values', async () => {
    mockGetEncryptedFieldNames.mockImplementation(async () => ['title', 'body', 'location'])
    decryptedInteractions = []

    const [item] = await listItems()

    expect(item.title).toBe('enc:v1:title')
    expect(item.location).toBe('enc:v1:location')
  })
})
