const mockProbeAiAvailability = jest.fn()
const mockRunIncidentsObjectAgent = jest.fn()
const mockFindSimilarIncidents = jest.fn()
const mockLoadIncidentCatalogs = jest.fn()
const mockLoadIncidentAiContext = jest.fn()
const mockResolveTranslations = jest.fn()

type AwilixContainerForTest = import('awilix').AwilixContainer
type ProbeResult =
  | { available: true }
  | { available: false; reason: 'no_provider' | 'runtime_missing' }
type FactoryUnavailableCode = 'no_provider_configured' | 'api_key_missing'
type ErrorWithCode = Error & { code?: string }

jest.mock('../lib/aiRuntime', () => ({
  probeAiAvailability: (...args: unknown[]) => mockProbeAiAvailability(...args),
  runIncidentsObjectAgent: (...args: unknown[]) => mockRunIncidentsObjectAgent(...args),
  findSimilarIncidents: (...args: unknown[]) => mockFindSimilarIncidents(...args),
  loadIncidentCatalogs: (...args: unknown[]) => mockLoadIncidentCatalogs(...args),
  loadIncidentAiContext: (...args: unknown[]) => mockLoadIncidentAiContext(...args),
}))

const mockCreateRequestContainer = jest.fn()
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => mockResolveTranslations(...args),
}))

const mockGetAuthFromRequest = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

const mockResolveOrganizationScopeForRequest = jest.fn()
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
}))

import { GET as availabilityGET, metadata as availabilityMetadata } from '../api/ai/availability/route'
import { POST as triagePOST, metadata as triageMetadata } from '../api/ai/triage/route'
import { POST as summaryPOST, metadata as summaryMetadata } from '../api/[id]/ai/summary/route'
import { POST as customerUpdatePOST, metadata as customerUpdateMetadata } from '../api/[id]/ai/customer-update/route'
import { metadata as postmortemDraftMetadata } from '../api/[id]/ai/postmortem-draft/route'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const incidentId = '44444444-4444-4444-8444-444444444444'

const expectedAiFeatures = ['incidents.incident.view', 'incidents.ai.use']

const mockLoadAcl = jest.fn()
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'rbacService') {
      return { loadAcl: mockLoadAcl }
    }
    throw new Error(`Unexpected dependency: ${name}`)
  }),
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function emptyPostRequest(url: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
}

function fakeIncidentContext() {
  return {
    incident: {
      id: incidentId,
      number: 'INC-1001',
      title: 'Checkout outage',
      description: 'Checkout is failing',
      status: 'investigating',
      severityId: '55555555-5555-4555-8555-555555555555',
      incidentTypeId: null,
      priority: null,
      visibility: 'internal',
      isDrill: false,
      isMajor: true,
      ownerUserId: null,
      owningTeamId: null,
      reporterUserId: userId,
      detectedAt: null,
      acknowledgedAt: null,
      startedAt: null,
      resolvedAt: null,
      closedAt: null,
      escalationLevel: 0,
      nextEscalationAt: null,
      escalationStatus: 'inactive',
      customerImpactSummary: null,
      revenueAtRiskMinor: null,
      revenueAtRiskCurrency: null,
      createdAt: '2026-07-02T10:00:00.000Z',
      updatedAt: '2026-07-02T10:05:00.000Z',
    },
    timeline: [],
    impacts: [],
    participants: [],
  }
}

class TestAiModelFactoryError extends Error {
  readonly code: FactoryUnavailableCode

  constructor(code: FactoryUnavailableCode) {
    super(code)
    this.name = 'AiModelFactoryError'
    this.code = code
  }
}

async function probeWithResolveModel(resolveModel: () => unknown): Promise<ProbeResult> {
  const createModelFactory = jest.fn(() => ({ resolveModel }))
  let result: ProbeResult | null = null

  await jest.isolateModulesAsync(async () => {
    jest.unmock('../lib/aiRuntime')
    jest.doMock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime', () => ({
      runAiAgentObject: jest.fn(),
    }))
    jest.doMock('@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory', () => ({
      createModelFactory,
    }))
    const runtime = await import('../lib/aiRuntime')
    result = await runtime.probeAiAvailability(
      container as unknown as AwilixContainerForTest,
      {
        tenantId,
        organizationId,
        userId,
        features: expectedAiFeatures,
        isSuperAdmin: false,
      },
    )
  })

  if (!result) throw new Error('probe did not return a result')
  return result
}

async function probeWithRuntimeImportError(error: ErrorWithCode): Promise<ProbeResult> {
  let result: ProbeResult | null = null

  await jest.isolateModulesAsync(async () => {
    jest.unmock('../lib/aiRuntime')
    jest.doMock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime', () => ({
      runAiAgentObject: jest.fn(),
    }))
    jest.doMock('@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory', () => {
      throw error
    })
    const runtime = await import('../lib/aiRuntime')
    result = await runtime.probeAiAvailability(
      container as unknown as AwilixContainerForTest,
      {
        tenantId,
        organizationId,
        userId,
        features: expectedAiFeatures,
        isSuperAdmin: false,
      },
    )
  })

  if (!result) throw new Error('probe did not return a result')
  return result
}

describe('incidents AI routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateRequestContainer.mockResolvedValue(container)
    mockGetAuthFromRequest.mockResolvedValue({
      sub: userId,
      tenantId,
      orgId: organizationId,
    })
    mockResolveTranslations.mockResolvedValue({
      locale: 'en',
      dict: {},
      t: (key: string, fallback?: string) => fallback ?? key,
      translate: (key: string, fallback?: string) => fallback ?? key,
    })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
      tenantId,
    })
    mockLoadAcl.mockResolvedValue({
      features: expectedAiFeatures,
      isSuperAdmin: false,
    })
    mockLoadIncidentCatalogs.mockResolvedValue({
      severities: [{ id: '55555555-5555-4555-8555-555555555555', key: 'sev1', label: 'Critical', rank: 1 }],
      types: [{ id: '66666666-6666-4666-8666-666666666666', key: 'availability', label: 'Availability' }],
      priorities: [
        { id: 'medium', key: 'medium', label: 'Medium', rank: 20, isDefault: true },
        { id: 'high', key: 'high', label: 'High', rank: 30 },
      ],
    })
    mockFindSimilarIncidents.mockResolvedValue([
      { id: incidentId, number: 'INC-1001', title: 'Checkout outage', status: 'resolved' },
    ])
    mockLoadIncidentAiContext.mockResolvedValue(fakeIncidentContext())
    mockRunIncidentsObjectAgent.mockResolvedValue({
      ok: true,
      data: { summary: 'INC-1001 is being investigated.', keyEvents: [] },
    })
  })

  afterAll(() => {
    mockConsoleError.mockRestore()
  })

  it('returns no_provider availability reason when the factory has no provider configured', async () => {
    await expect(probeWithResolveModel(() => {
      throw new TestAiModelFactoryError('no_provider_configured')
    })).resolves.toEqual({ available: false, reason: 'no_provider' })
  })

  it('returns no_provider availability reason when the factory has no API key', async () => {
    await expect(probeWithResolveModel(() => {
      throw new TestAiModelFactoryError('api_key_missing')
    })).resolves.toEqual({ available: false, reason: 'no_provider' })
  })

  it('returns runtime_missing availability reason when the AI runtime module is missing', async () => {
    const error: ErrorWithCode = new Error("Cannot find module '@open-mercato/ai-assistant'")
    error.code = 'MODULE_NOT_FOUND'

    await expect(probeWithRuntimeImportError(error)).resolves.toEqual({
      available: false,
      reason: 'runtime_missing',
    })
  })

  it('returns availability=false when the AI provider probe is unavailable', async () => {
    mockProbeAiAvailability.mockResolvedValue({ available: false, reason: 'no_provider' })

    const response = await availabilityGET(new Request('http://localhost/api/incidents/ai/availability'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ available: false, reason: 'no_provider' })
    expect(mockProbeAiAvailability).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        features: expectedAiFeatures,
      }),
    )
  })

  it('returns the structured 503 AI-unavailable body from the summary route', async () => {
    const error = new Error('runtime missing')
    mockRunIncidentsObjectAgent.mockResolvedValueOnce({ ok: false, reason: 'unavailable', error })

    const response = await summaryPOST(
      emptyPostRequest(`http://localhost/api/incidents/${incidentId}/ai/summary`),
      { params: { id: incidentId } },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: '[internal] ai_unavailable',
      code: 'ai_unavailable',
    })
    expect(mockConsoleError).toHaveBeenCalledWith('[incidents.ai.summary] failed', { incidentId }, error)
    expect(mockRunIncidentsObjectAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'incidents.summarizer',
        container,
        authContext: expect.objectContaining({ tenantId, organizationId, userId }),
      }),
    )
  })

  it('returns typed factory error code from the summary route', async () => {
    const error = new TestAiModelFactoryError('no_provider_configured')
    mockRunIncidentsObjectAgent.mockResolvedValueOnce({
      ok: false,
      reason: 'unavailable',
      code: 'no_provider_configured',
      error,
    })

    const response = await summaryPOST(
      emptyPostRequest(`http://localhost/api/incidents/${incidentId}/ai/summary`),
      { params: { id: incidentId } },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: '[internal] no_provider_configured',
      code: 'no_provider_configured',
    })
    expect(mockConsoleError).toHaveBeenCalledWith('[incidents.ai.summary] failed', { incidentId }, error)
  })

  it('forwards the active locale to the summary object agent', async () => {
    mockResolveTranslations.mockResolvedValueOnce({
      locale: 'pl',
      dict: {},
      t: (key: string, fallback?: string) => fallback ?? key,
      translate: (key: string, fallback?: string) => fallback ?? key,
    })

    const response = await summaryPOST(
      emptyPostRequest(`http://localhost/api/incidents/${incidentId}/ai/summary`),
      { params: { id: incidentId } },
    )

    expect(response.status).toBe(200)
    expect(mockRunIncidentsObjectAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'incidents.summarizer',
        authContext: expect.objectContaining({ locale: 'pl' }),
      }),
    )
  })

  it('returns generic AI failure from the summary route for non-factory errors', async () => {
    const error = new Error('model failed')
    mockRunIncidentsObjectAgent.mockResolvedValueOnce({ ok: false, reason: 'failed', error })

    const response = await summaryPOST(
      emptyPostRequest(`http://localhost/api/incidents/${incidentId}/ai/summary`),
      { params: { id: incidentId } },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: '[internal] ai_failed',
      code: 'ai_failed',
    })
    expect(mockConsoleError).toHaveBeenCalledWith('[incidents.ai.summary] failed', { incidentId }, error)
  })

  it('returns structured 503 AI-unavailable body from the triage route', async () => {
    const error = new Error('runtime missing')
    mockRunIncidentsObjectAgent.mockResolvedValueOnce({ ok: false, reason: 'unavailable', error })

    const response = await triagePOST(
      jsonRequest('http://localhost/api/incidents/ai/triage', {
        title: 'Checkout failing for card payments',
        description: 'Customers report payment failures.',
      }),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: '[internal] ai_unavailable',
      code: 'ai_unavailable',
    })
    expect(mockConsoleError).toHaveBeenCalledWith('[incidents.ai.triage] failed', { incidentId: 'triage' }, error)
    expect(mockFindSimilarIncidents).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ tenantId, organizationId }),
      expect.stringContaining('Checkout failing'),
      5,
    )
  })

  it('returns triage priorityKey when the agent supplies one', async () => {
    mockRunIncidentsObjectAgent.mockResolvedValueOnce({
      ok: true,
      data: {
        severityKey: 'sev1',
        typeKey: 'availability',
        priorityKey: 'high',
        rationale: 'Checkout failures affect payment completion.',
        possibleDuplicateIds: [incidentId],
      },
    })

    const response = await triagePOST(
      jsonRequest('http://localhost/api/incidents/ai/triage', {
        title: 'Checkout failing for card payments',
        description: 'Customers report payment failures.',
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      suggestion: {
        severityKey: 'sev1',
        typeKey: 'availability',
        priorityKey: 'high',
        rationale: 'Checkout failures affect payment completion.',
        possibleDuplicateIds: [incidentId],
      },
      similar: [{ id: incidentId, number: 'INC-1001', title: 'Checkout outage', status: 'resolved' }],
    })
    expect(mockRunIncidentsObjectAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.stringContaining('Priority catalog:'),
      }),
    )
  })

  it('omits triage priorityKey when the agent does not supply one', async () => {
    mockRunIncidentsObjectAgent.mockResolvedValueOnce({
      ok: true,
      data: {
        severityKey: 'sev1',
        typeKey: 'availability',
        rationale: 'Checkout failures affect payment completion.',
        possibleDuplicateIds: [],
      },
    })

    const response = await triagePOST(
      jsonRequest('http://localhost/api/incidents/ai/triage', {
        title: 'Checkout failing for card payments',
      }),
    )

    expect(response.status).toBe(200)
    const body = await response.json() as { suggestion: Record<string, unknown> }
    expect(body.suggestion).toEqual({
      severityKey: 'sev1',
      typeKey: 'availability',
      rationale: 'Checkout failures affect payment completion.',
      possibleDuplicateIds: [],
    })
    expect(body.suggestion).not.toHaveProperty('priorityKey')
  })

  it('declares expected RBAC metadata features on every AI route', () => {
    expect(availabilityMetadata.GET).toEqual({ requireAuth: true, requireFeatures: expectedAiFeatures })
    expect(triageMetadata.POST).toEqual({ requireAuth: true, requireFeatures: expectedAiFeatures })
    expect(summaryMetadata.POST).toEqual({ requireAuth: true, requireFeatures: expectedAiFeatures })
    expect(customerUpdateMetadata.POST).toEqual({ requireAuth: true, requireFeatures: expectedAiFeatures })
    expect(postmortemDraftMetadata.POST).toEqual({ requireAuth: true, requireFeatures: expectedAiFeatures })
  })

  it('rejects invalid triage bodies with zod validation', async () => {
    const response = await triagePOST(
      jsonRequest('http://localhost/api/incidents/ai/triage', {
        title: '',
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: '[internal] invalid_request',
      code: 'invalid_request',
    })
    expect(mockRunIncidentsObjectAgent).not.toHaveBeenCalled()
  })

  it('rejects invalid customer-update bodies with zod validation', async () => {
    const response = await customerUpdatePOST(
      jsonRequest(`http://localhost/api/incidents/${incidentId}/ai/customer-update`, {
        tone: 'casual',
      }),
      { params: { id: incidentId } },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: '[internal] invalid_request',
      code: 'invalid_request',
    })
    expect(mockLoadIncidentAiContext).not.toHaveBeenCalled()
  })
})
