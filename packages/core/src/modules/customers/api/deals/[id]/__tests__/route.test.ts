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

    const dealRow = {
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
    }
    const pipelineRow = {
      id: '550e8400-e29b-41d4-a716-446655440010',
      name: 'Default Pipeline',
      stageProbabilitiesEnabled: true,
    }
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: { name?: string }, where: Record<string, unknown>) => {
      if (entity?.name === 'User') {
        if (where?.id === 'user-1') {
          return { id: 'user-1', name: 'Viewer User', email: 'viewer@example.com' }
        }
        if (where?.id === 'owner-1') {
          return { id: 'owner-1', name: 'Owner User', email: 'owner@example.com' }
        }
        return null
      }
      if (entity?.name === 'CustomerPipeline') {
        return pipelineRow
      }
      if (entity?.name === 'CustomerDeal') {
        return dealRow
      }
      return null
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
      if (entity?.name === 'CustomerDictionaryEntry') {
        return [
          {
            normalizedValue: 'discovery',
            label: 'Discovery',
            color: '#2563eb',
            icon: 'search',
          },
        ]
      }
      return []
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
    expect(body.pipelineStageProbabilitiesEnabled).toBe(true)
    expect(body.stageTransitions).toEqual([
      {
        stageId: '550e8400-e29b-41d4-a716-446655440011',
        stageLabel: 'Discovery',
        stageOrder: 1,
        transitionedAt: '2026-04-11T09:00:00.000Z',
      },
    ])
  })

  it.each([
    { view: 'full', canViewPeople: false, canViewCompanies: true },
    { view: 'lite', canViewPeople: true, canViewCompanies: false },
  ])('checks related permissions independently for $view deal detail', async ({
    view,
    canViewPeople,
    canViewCompanies,
  }) => {
    const dealId = '550e8400-e29b-41d4-a716-446655440000'
    const pipelineId = '550e8400-e29b-41d4-a716-446655440010'
    const pipelineStageId = '550e8400-e29b-41d4-a716-446655440011'
    const person = {
      id: '550e8400-e29b-41d4-a716-446655440100',
      displayName: 'Example contact',
      deletedAt: null,
      personProfile: { jobTitle: 'Example job title' },
    }
    const company = {
      id: '550e8400-e29b-41d4-a716-446655440200',
      displayName: 'Example company',
      deletedAt: null,
      companyProfile: { domain: 'company.example' },
    }
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-home',
      isApiKey: false,
    })
    mockUserHasAllFeatures.mockImplementation(async (_userId: string, [feature]: string[]) => (
      (feature === 'customers.people.view' && canViewPeople)
      || (feature === 'customers.companies.view' && canViewCompanies)
    ))
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: { name: string }) => {
      if (entity.name === 'CustomerDeal') {
        return {
          id: dealId,
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          title: 'Example deal',
          pipelineId,
          pipelineStageId,
          pipelineStage: 'Discovery',
          createdAt: new Date('2026-04-10T08:00:00.000Z'),
          updatedAt: new Date('2026-04-14T16:30:00.000Z'),
        }
      }
      return null
    })
    mockFindWithDecryption.mockImplementation(async (
      _em: unknown,
      entity: { name: string },
      where: { id?: { $in?: string[] } },
      options?: { populate?: string[] },
    ) => {
      if (entity.name === 'CustomerDealPersonLink') {
        return [{ person: options?.populate?.length ? person : { id: person.id } }]
      }
      if (entity.name === 'CustomerDealCompanyLink') {
        return [{ company: options?.populate?.length ? company : { id: company.id } }]
      }
      if (entity.name === 'CustomerEntity') {
        return [person, company].filter((record) => where.id?.$in?.includes(record.id))
      }
      return []
    })

    const { GET } = await import('../route')
    const query = new URLSearchParams({ include: 'stages', view })
    const response = await GET(new Request(`http://localhost/api/customers/deals/${dealId}?${query}`), {
      params: { id: dealId },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      deal: { id: dealId, pipelineId, pipelineStageId, pipelineStage: 'Discovery' },
      people: canViewPeople ? [{ id: person.id, label: person.displayName, subtitle: person.personProfile.jobTitle }] : [],
      companies: canViewCompanies ? [{ id: company.id, label: company.displayName, subtitle: company.companyProfile.domain }] : [],
      linkedPersonIds: [person.id],
      linkedCompanyIds: [company.id],
      counts: { people: 1, companies: 1 },
      pipelineName: null,
      pipelineStages: [],
      pipelineStageProbabilitiesEnabled: false,
      stageTransitions: [],
    })
    for (const feature of ['customers.people.view', 'customers.companies.view', 'customers.pipelines.view']) {
      expect(mockUserHasAllFeatures).toHaveBeenCalledWith('user-1', [feature], {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })
    }
    const deniedLinkEntity = canViewPeople ? 'CustomerDealCompanyLink' : 'CustomerDealPersonLink'
    const deniedLinkReads = mockFindWithDecryption.mock.calls.filter(([, entity]) => entity.name === deniedLinkEntity)
    expect(deniedLinkReads).toHaveLength(1)
    expect(deniedLinkReads[0][3]?.populate ?? []).toEqual([])
    const deniedRecordId = canViewPeople ? company.id : person.id
    expect(mockFindWithDecryption.mock.calls
      .filter(([, entity]) => entity.name === 'CustomerEntity')
      .flatMap(([, , where]) => where.id?.$in ?? [])).not.toContain(deniedRecordId)
    const fetchedEntities = [...mockFindWithDecryption.mock.calls, ...mockFindOneWithDecryption.mock.calls]
      .map(([, entity]) => entity.name)
    expect(fetchedEntities).not.toContain('CustomerPipeline')
    expect(fetchedEntities).not.toContain('CustomerPipelineStage')
    expect(fetchedEntities).not.toContain('CustomerDealStageTransition')
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
    expect(body.pipelineStageProbabilitiesEnabled).toBe(false)
    expect(body.pipelineStages).toHaveLength(3)
  })
})
