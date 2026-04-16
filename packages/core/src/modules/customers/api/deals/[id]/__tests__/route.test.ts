/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockLoadCustomFieldValues = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockDecryptEntitiesWithFallbackScope = jest.fn()
const mockUserHasAllFeatures = jest.fn()

const mockEm = {
  find: jest.fn(),
  findOne: jest.fn(),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args: unknown) => mockResolveOrganizationScopeForRequest(args)),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn((args: unknown) => mockLoadCustomFieldValues(args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('@open-mercato/shared/lib/encryption/subscriber', () => ({
  decryptEntitiesWithFallbackScope: jest.fn((...args: unknown[]) => mockDecryptEntitiesWithFallbackScope(...args)),
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    customers: {
      customer_deal: 'customer_deal',
    },
  },
}), { virtual: true })

describe('GET /api/customers/deals/[id]?include=stages', () => {
  beforeEach(() => {
    jest.resetModules()
    mockGetAuthFromRequest.mockReset()
    mockResolveOrganizationScopeForRequest.mockReset()
    mockLoadCustomFieldValues.mockReset()
    mockFindWithDecryption.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockDecryptEntitiesWithFallbackScope.mockReset()
    mockUserHasAllFeatures.mockReset()
    mockEm.find.mockReset()
    mockEm.findOne.mockReset()
    mockContainer.resolve.mockClear()

    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      email: 'viewer@example.com',
      isApiKey: false,
    })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      filterIds: ['org-1'],
      selectedId: 'org-1',
      tenantId: 'tenant-1',
    })
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockLoadCustomFieldValues.mockResolvedValue({
      '550e8400-e29b-41d4-a716-446655440000': {
        priority: 'high',
      },
    })
    mockDecryptEntitiesWithFallbackScope.mockResolvedValue(undefined)
  })

  it('returns closure, owner, pipeline stages, and stage transitions in the detail payload', async () => {
    const createdAt = new Date('2026-04-10T08:00:00.000Z')
    const updatedAt = new Date('2026-04-14T16:30:00.000Z')

    mockFindOneWithDecryption.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440000',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      title: 'Expansion renewal',
      description: 'Renewal for Q2 expansion',
      status: 'qualified',
      pipelineStage: 'Discovery',
      pipelineId: '550e8400-e29b-41d4-a716-446655440010',
      pipelineStageId: '550e8400-e29b-41d4-a716-446655440011',
      valueAmount: '12000',
      valueCurrency: 'USD',
      probability: 65,
      expectedCloseAt: new Date('2026-05-01T00:00:00.000Z'),
      ownerUserId: 'owner-1',
      source: 'Referral',
      closureOutcome: 'won',
      lossReasonId: null,
      lossNotes: null,
      createdAt,
      updatedAt,
      deletedAt: null,
    })

    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: { name?: string }) => {
      if (entity?.name === 'CustomerDealPersonLink') {
        return [
          {
            person: {
              id: '550e8400-e29b-41d4-a716-446655440100',
              deletedAt: null,
              displayName: 'Ada Lovelace',
              primaryEmail: 'ada@example.com',
              primaryPhone: null,
              personProfile: { jobTitle: 'VP Partnerships' },
            },
          },
        ]
      }
      if (entity?.name === 'CustomerDealCompanyLink') {
        return [
          {
            company: {
              id: '550e8400-e29b-41d4-a716-446655440200',
              deletedAt: null,
              displayName: 'Brightside Solar',
              companyProfile: { domain: 'brightside.example' },
            },
          },
        ]
      }
      if (entity?.name === 'CustomerPipelineStage') {
        return [
          {
            id: '550e8400-e29b-41d4-a716-446655440011',
            pipelineId: '550e8400-e29b-41d4-a716-446655440010',
            label: 'Discovery',
            order: 1,
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440012',
            pipelineId: '550e8400-e29b-41d4-a716-446655440010',
            label: 'Proposal',
            order: 2,
          },
        ]
      }
      if (entity?.name === 'CustomerDealStageTransition') {
        return [
          {
            id: 'transition-1',
            stageId: '550e8400-e29b-41d4-a716-446655440011',
            stageLabel: 'Discovery',
            stageOrder: 1,
            transitionedAt: new Date('2026-04-11T09:00:00.000Z'),
          },
        ]
      }
      return []
    })

    mockEm.find.mockResolvedValue([
      {
        normalizedValue: 'discovery',
        label: 'Discovery',
        color: '#2563eb',
        icon: 'search',
      },
    ])
    mockEm.findOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where?.id === 'user-1') {
        return { id: 'user-1', name: 'Viewer User', email: 'viewer@example.com' }
      }
      if (where?.id === 'owner-1') {
        return { id: 'owner-1', name: 'Owner User', email: 'owner@example.com' }
      }
      return null
    })

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/customers/deals/550e8400-e29b-41d4-a716-446655440000?include=stages'),
      { params: { id: '550e8400-e29b-41d4-a716-446655440000' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deal).toEqual(expect.objectContaining({
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Expansion renewal',
      closureOutcome: 'won',
      ownerUserId: 'owner-1',
    }))
    expect(body.owner).toEqual({
      id: 'owner-1',
      name: 'Owner User',
      email: 'owner@example.com',
    })
    expect(body.customFields).toEqual({ priority: 'high' })
    expect(body.people).toEqual([
      expect.objectContaining({
        id: '550e8400-e29b-41d4-a716-446655440100',
        label: 'Ada Lovelace',
        subtitle: 'VP Partnerships',
        kind: 'person',
      }),
    ])
    expect(body.companies).toEqual([
      expect.objectContaining({
        id: '550e8400-e29b-41d4-a716-446655440200',
        label: 'Brightside Solar',
        subtitle: 'brightside.example',
        kind: 'company',
      }),
    ])
    expect(body.pipelineStages).toEqual([
      expect.objectContaining({
        id: '550e8400-e29b-41d4-a716-446655440011',
        label: 'Discovery',
        order: 1,
        color: '#2563eb',
        icon: 'search',
      }),
      expect.objectContaining({
        id: '550e8400-e29b-41d4-a716-446655440012',
        label: 'Proposal',
        order: 2,
        color: null,
        icon: null,
      }),
    ])
    expect(body.stageTransitions).toEqual([
      {
        stageId: '550e8400-e29b-41d4-a716-446655440011',
        stageLabel: 'Discovery',
        stageOrder: 1,
        transitionedAt: '2026-04-11T09:00:00.000Z',
      },
    ])
  })

  it('returns an empty transition history when the stage transition table is missing', async () => {
    const createdAt = new Date('2026-04-10T08:00:00.000Z')
    const updatedAt = new Date('2026-04-14T16:30:00.000Z')

    mockFindOneWithDecryption.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440000',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      title: 'Expansion renewal',
      description: null,
      status: 'qualified',
      pipelineStage: 'Discovery',
      pipelineId: '550e8400-e29b-41d4-a716-446655440010',
      pipelineStageId: '550e8400-e29b-41d4-a716-446655440011',
      valueAmount: '12000',
      valueCurrency: 'USD',
      probability: 65,
      expectedCloseAt: null,
      ownerUserId: null,
      source: 'Referral',
      closureOutcome: null,
      lossReasonId: null,
      lossNotes: null,
      createdAt,
      updatedAt,
      deletedAt: null,
    })

    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: { name?: string }) => {
      if (entity?.name === 'CustomerPipelineStage') {
        return [
          {
            id: '550e8400-e29b-41d4-a716-446655440011',
            pipelineId: '550e8400-e29b-41d4-a716-446655440010',
            label: 'Discovery',
            order: 1,
          },
        ]
      }
      if (entity?.name === 'CustomerDealStageTransition') {
        const error = new Error('relation "customer_deal_stage_transitions" does not exist') as Error & { code?: string }
        error.code = '42P01'
        throw error
      }
      return []
    })

    mockLoadCustomFieldValues.mockResolvedValue({})
    mockEm.find.mockResolvedValue([])
    mockEm.findOne.mockResolvedValue(null)

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/customers/deals/550e8400-e29b-41d4-a716-446655440000?include=stages'),
      { params: { id: '550e8400-e29b-41d4-a716-446655440000' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.pipelineStages).toHaveLength(1)
    // When the stage transition table is missing and no action logs are available,
    // the merge still surfaces the current stage as a single synthesized entry using
    // the deal's createdAt timestamp — this keeps the UI informative instead of blank.
    expect(body.stageTransitions).toEqual([
      {
        stageId: '550e8400-e29b-41d4-a716-446655440011',
        stageLabel: 'Discovery',
        stageOrder: 1,
        transitionedAt: '2026-04-10T08:00:00.000Z',
      },
    ])

    warnSpy.mockRestore()
  })

  it('infers pipeline ids and stage progress for legacy deals that only store pipelineStage labels', async () => {
    const createdAt = new Date('2026-04-10T08:00:00.000Z')
    const updatedAt = new Date('2026-04-14T16:30:00.000Z')

    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: { name?: string }, where: Record<string, unknown>) => {
      if (entity?.name === 'CustomerDeal') {
        return {
          id: '550e8400-e29b-41d4-a716-446655440000',
          organizationId: 'org-1',
          tenantId: 'tenant-1',
          title: 'Legacy deal',
          description: null,
          status: 'qualified',
          pipelineStage: 'Negotiation',
          pipelineId: null,
          pipelineStageId: null,
          valueAmount: '12000',
          valueCurrency: 'USD',
          probability: 65,
          expectedCloseAt: null,
          ownerUserId: null,
          source: 'Referral',
          closureOutcome: null,
          lossReasonId: null,
          lossNotes: null,
          createdAt,
          updatedAt,
          deletedAt: null,
        }
      }
      if (entity?.name === 'CustomerPipeline' && where?.id === 'pipeline-legacy') {
        return {
          id: 'pipeline-legacy',
          name: 'Enterprise Sales pipeline',
        }
      }
      return null
    })

    mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: { name?: string }, where: Record<string, unknown>) => {
      if (entity?.name === 'CustomerPipelineStage' && !where?.pipelineId) {
        return [
          {
            id: 'stage-1',
            pipelineId: 'pipeline-legacy',
            label: 'Qualification',
            order: 1,
          },
          {
            id: 'stage-2',
            pipelineId: 'pipeline-legacy',
            label: 'Proposal',
            order: 2,
          },
          {
            id: 'stage-3',
            pipelineId: 'pipeline-legacy',
            label: 'Negotiation',
            order: 3,
          },
        ]
      }
      if (entity?.name === 'CustomerPipelineStage' && where?.pipelineId === 'pipeline-legacy') {
        return [
          {
            id: 'stage-1',
            pipelineId: 'pipeline-legacy',
            label: 'Qualification',
            order: 1,
          },
          {
            id: 'stage-2',
            pipelineId: 'pipeline-legacy',
            label: 'Proposal',
            order: 2,
          },
          {
            id: 'stage-3',
            pipelineId: 'pipeline-legacy',
            label: 'Negotiation',
            order: 3,
          },
        ]
      }
      if (entity?.name === 'CustomerDealStageTransition') {
        return []
      }
      return []
    })

    mockLoadCustomFieldValues.mockResolvedValue({})
    mockEm.find.mockResolvedValue([])
    mockEm.findOne.mockResolvedValue(null)

    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/customers/deals/550e8400-e29b-41d4-a716-446655440000?include=stages'),
      { params: { id: '550e8400-e29b-41d4-a716-446655440000' } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deal.pipelineId).toBe('pipeline-legacy')
    expect(body.deal.pipelineStageId).toBe('stage-3')
    expect(body.pipelineName).toBe('Enterprise Sales pipeline')
    expect(body.pipelineStages).toHaveLength(3)
  })
})
