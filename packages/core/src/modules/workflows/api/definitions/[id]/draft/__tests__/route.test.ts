/** @jest-environment node */

import { GET, PUT, DELETE } from '../route'
import { WorkflowDefinition, WorkflowDefinitionDraft } from '../../../../../data/entities'

const TENANT_A = '123e4567-e89b-12d3-a456-426614174001'
const TENANT_B = '123e4567-e89b-12d3-a456-426614174009'
const ORG_A = '123e4567-e89b-12d3-a456-426614174002'
const ORG_B = '123e4567-e89b-12d3-a456-426614174008'
const USER_A = '123e4567-e89b-12d3-a456-426614174010'
const USER_B = '123e4567-e89b-12d3-a456-426614174011'
const DEFINITION_ID = '123e4567-e89b-12d3-a456-426614174070'
const DRAFT_ID = '123e4567-e89b-12d3-a456-426614174080'

const mockGetAuthFromRequest = jest.fn()
const mockResolveScope = jest.fn()

type DraftRecord = {
  id: string
  definitionId: string | null
  userId: string
  definition: { steps: Array<Record<string, unknown>>; transitions: Array<Record<string, unknown>> }
  metadata: Record<string, unknown> | null
  baseUpdatedAt: Date | null
  tenantId: string
  organizationId: string
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

let definitionRecords: Array<Record<string, unknown>> = []
let draftRecords: DraftRecord[] = []

function matches(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => record[key] === value)
}

const mockEm = {
  findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === WorkflowDefinition) {
      return definitionRecords.find((record) => matches(record, where)) ?? null
    }
    if (entity === WorkflowDefinitionDraft) {
      return draftRecords.find((record) => matches(record as unknown as Record<string, unknown>, where)) ?? null
    }
    return null
  }),
  create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
    id: DRAFT_ID,
    deletedAt: null,
    ...data,
  })),
  persist: jest.fn((entity: unknown) => {
    draftRecords.push(entity as DraftRecord)
    return entity
  }),
  flush: jest.fn(async () => undefined),
}

const mockRbacService = {
  userHasAllFeatures: jest.fn(async () => true),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return mockRbacService
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => mockResolveScope()),
}))

function makeRequest(method: string, body?: unknown): Request {
  return new Request(`http://localhost/api/workflows/definitions/${DEFINITION_ID}/draft`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function makeContext(id: string = DEFINITION_ID) {
  return { params: Promise.resolve({ id }) }
}

function seedDraft(overrides: Partial<DraftRecord> = {}): DraftRecord {
  const draft: DraftRecord = {
    id: DRAFT_ID,
    definitionId: DEFINITION_ID,
    userId: USER_A,
    definition: { steps: [{ stepId: 'start' }], transitions: [] },
    metadata: null,
    baseUpdatedAt: new Date('2026-07-27T10:00:00.000Z'),
    tenantId: TENANT_A,
    organizationId: ORG_A,
    createdAt: new Date('2026-07-27T09:00:00.000Z'),
    updatedAt: new Date('2026-07-27T10:05:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
  draftRecords.push(draft)
  return draft
}

const validDraftBody = {
  definition: {
    steps: [{ stepId: 'start', stepName: 'Start', stepType: 'START' }],
    transitions: [],
  },
  baseUpdatedAt: '2026-07-27T10:00:00.000Z',
}

beforeEach(() => {
  jest.clearAllMocks()
  definitionRecords = [
    {
      id: DEFINITION_ID,
      tenantId: TENANT_A,
      organizationId: ORG_A,
      deletedAt: null,
      updatedAt: new Date('2026-07-27T10:00:00.000Z'),
    },
  ]
  draftRecords = []
  mockGetAuthFromRequest.mockResolvedValue({ sub: USER_A, tenantId: TENANT_A, orgId: ORG_A })
  mockResolveScope.mockReturnValue({ selectedId: ORG_A })
  mockRbacService.userHasAllFeatures.mockResolvedValue(true)
})

describe('GET /api/workflows/definitions/[id]/draft', () => {
  it('returns 404 when the user has no draft', async () => {
    const response = await GET(makeRequest('GET') as never, makeContext())
    expect(response.status).toBe(404)
  })

  it('returns the current user draft', async () => {
    seedDraft()
    const response = await GET(makeRequest('GET') as never, makeContext())
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.data.id).toBe(DRAFT_ID)
    expect(payload.data.definitionId).toBe(DEFINITION_ID)
    expect(payload.data.baseUpdatedAt).toBe('2026-07-27T10:00:00.000Z')
    expect(payload.data.updatedAt).toBe('2026-07-27T10:05:00.000Z')
  })

  it('does not return another user draft (cross-user isolation)', async () => {
    seedDraft({ userId: USER_B })
    const response = await GET(makeRequest('GET') as never, makeContext())
    expect(response.status).toBe(404)
  })

  it('does not return a draft from another tenant (cross-tenant isolation)', async () => {
    seedDraft()
    mockGetAuthFromRequest.mockResolvedValue({ sub: USER_A, tenantId: TENANT_B, orgId: ORG_B })
    mockResolveScope.mockReturnValue({ selectedId: ORG_B })
    const response = await GET(makeRequest('GET') as never, makeContext())
    expect(response.status).toBe(404)
  })

  it('returns 400 for a non-uuid id', async () => {
    const response = await GET(makeRequest('GET') as never, makeContext('new'))
    expect(response.status).toBe(400)
  })

  it('returns 403 without the edit feature', async () => {
    mockRbacService.userHasAllFeatures.mockResolvedValue(false)
    const response = await GET(makeRequest('GET') as never, makeContext())
    expect(response.status).toBe(403)
  })
})

describe('PUT /api/workflows/definitions/[id]/draft', () => {
  it('creates a draft for the current user', async () => {
    const response = await PUT(makeRequest('PUT', validDraftBody) as never, makeContext())
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.data.definitionId).toBe(DEFINITION_ID)
    expect(payload.data.baseUpdatedAt).toBe('2026-07-27T10:00:00.000Z')
    expect(mockEm.persist).toHaveBeenCalledTimes(1)
    expect(mockEm.flush).toHaveBeenCalledTimes(1)
    const created = draftRecords[0]
    expect(created.userId).toBe(USER_A)
    expect(created.tenantId).toBe(TENANT_A)
    expect(created.organizationId).toBe(ORG_A)
  })

  it('never takes the userId from the body', async () => {
    const response = await PUT(
      makeRequest('PUT', { ...validDraftBody, userId: USER_B }) as never,
      makeContext(),
    )
    expect(response.status).toBe(400)
  })

  it('updates the existing draft in place', async () => {
    const existing = seedDraft()
    const response = await PUT(
      makeRequest('PUT', {
        definition: { steps: [{ stepId: 'start' }, { stepId: 'end' }], transitions: [] },
      }) as never,
      makeContext(),
    )
    expect(response.status).toBe(200)
    expect(mockEm.persist).not.toHaveBeenCalled()
    expect(existing.definition.steps).toHaveLength(2)
    expect(existing.baseUpdatedAt?.toISOString()).toBe('2026-07-27T10:00:00.000Z')
  })

  it('revives a soft-deleted draft on save', async () => {
    const existing = seedDraft({ deletedAt: new Date('2026-07-27T11:00:00.000Z') })
    const response = await PUT(makeRequest('PUT', validDraftBody) as never, makeContext())
    expect(response.status).toBe(200)
    expect(existing.deletedAt).toBeNull()
  })

  it('accepts a structurally incomplete definition (lenient draft schema)', async () => {
    const response = await PUT(
      makeRequest('PUT', { definition: { steps: [], transitions: [] } }) as never,
      makeContext(),
    )
    expect(response.status).toBe(200)
  })

  it('rejects a malformed definition payload', async () => {
    const response = await PUT(
      makeRequest('PUT', { definition: { steps: 'not-an-array', transitions: [] } }) as never,
      makeContext(),
    )
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.error).toBe('Validation failed')
  })

  it('returns 404 when the definition is not in the caller tenant (cross-tenant isolation)', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: USER_A, tenantId: TENANT_B, orgId: ORG_B })
    mockResolveScope.mockReturnValue({ selectedId: ORG_B })
    const response = await PUT(makeRequest('PUT', validDraftBody) as never, makeContext())
    expect(response.status).toBe(404)
  })

  it('returns 400 for a non-uuid id', async () => {
    const response = await PUT(makeRequest('PUT', validDraftBody) as never, makeContext('code:checkout-flow'))
    expect(response.status).toBe(400)
  })

  it('returns 403 without the edit feature', async () => {
    mockRbacService.userHasAllFeatures.mockResolvedValue(false)
    const response = await PUT(makeRequest('PUT', validDraftBody) as never, makeContext())
    expect(response.status).toBe(403)
  })
})

describe('DELETE /api/workflows/definitions/[id]/draft', () => {
  it('soft-deletes the current user draft', async () => {
    const existing = seedDraft()
    const response = await DELETE(makeRequest('DELETE') as never, makeContext())
    expect(response.status).toBe(200)
    expect(existing.deletedAt).not.toBeNull()
    expect(mockEm.flush).toHaveBeenCalledTimes(1)
  })

  it('is idempotent when no draft exists', async () => {
    const response = await DELETE(makeRequest('DELETE') as never, makeContext())
    expect(response.status).toBe(200)
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('does not delete another user draft (cross-user isolation)', async () => {
    const other = seedDraft({ userId: USER_B })
    const response = await DELETE(makeRequest('DELETE') as never, makeContext())
    expect(response.status).toBe(200)
    expect(other.deletedAt).toBeNull()
  })

  it('returns 400 for a non-uuid id', async () => {
    const response = await DELETE(makeRequest('DELETE') as never, makeContext('new'))
    expect(response.status).toBe(400)
  })

  it('returns 403 without the edit feature', async () => {
    mockRbacService.userHasAllFeatures.mockResolvedValue(false)
    const response = await DELETE(makeRequest('DELETE') as never, makeContext())
    expect(response.status).toBe(403)
  })
})
