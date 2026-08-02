/** @jest-environment node */

import { CustomerPipelineStage, CustomerDictionaryEntry } from '../../../data/entities'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

const em = {
  find: jest.fn(),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) =>
    mockResolveOrganizationScopeForRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

import { GET } from '../route'

const makeStage = (overrides: Record<string, unknown> = {}) => ({
  id: '33333333-3333-4333-8333-333333333333',
  pipelineId: '44444444-4444-4444-8444-444444444444',
  label: 'Prospecting',
  order: 0,
  organizationId,
  tenantId,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
})

describe('customers pipeline-stages GET under All organizations scope (#3768)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId, orgId: null })
  })

  it('aggregates stages tenant-wide when no organization is selected (no organizationId filter)', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId,
    })
    let stageWhere: Record<string, unknown> | undefined
    let dictWhere: Record<string, unknown> | undefined
    em.find.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CustomerPipelineStage) {
        stageWhere = where
        return [makeStage()]
      }
      if (entity === CustomerDictionaryEntry) {
        dictWhere = where
        return []
      }
      return []
    })

    const response = await GET(new Request('http://localhost/api/customers/pipeline-stages'))

    expect(response.status).toBe(200)
    expect(stageWhere).toEqual({ tenantId })
    expect(stageWhere).not.toHaveProperty('organizationId')
    expect(dictWhere).toMatchObject({ tenantId, kind: 'pipeline_stage' })
    expect(dictWhere).not.toHaveProperty('organizationId')
  })

  it('scopes stages to the selected organization when one is active', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: null,
      tenantId,
    })
    let stageWhere: Record<string, unknown> | undefined
    em.find.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CustomerPipelineStage) {
        stageWhere = where
        return []
      }
      return []
    })

    const response = await GET(new Request('http://localhost/api/customers/pipeline-stages'))

    expect(response.status).toBe(200)
    expect(stageWhere).toEqual({ tenantId, organizationId: { $in: [organizationId] } })
  })

  it('still returns 400 when tenant context is missing', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: null, orgId: null })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: null,
    })

    const response = await GET(new Request('http://localhost/api/customers/pipeline-stages'))

    expect(response.status).toBe(400)
    expect(em.find).not.toHaveBeenCalled()
  })
})
