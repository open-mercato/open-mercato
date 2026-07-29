/** @jest-environment node */

import { z } from 'zod'
import { POST } from '../route'
import { WorkflowDefinition } from '../../../../../data/entities'
import { getActivityType, registerActivityType } from '../../../../../lib/activity-registry'

const TENANT_A = '123e4567-e89b-12d3-a456-426614174001'
const TENANT_B = '123e4567-e89b-12d3-a456-426614174009'
const ORG_A = '123e4567-e89b-12d3-a456-426614174002'
const ORG_B = '123e4567-e89b-12d3-a456-426614174008'
const USER_A = '123e4567-e89b-12d3-a456-426614174010'
const DEFINITION_ID = '123e4567-e89b-12d3-a456-426614174081'
const NO_MOCK_ACTIVITY_TYPE = 'TEST_STEP_NO_MOCK'

const mockGetAuthFromRequest = jest.fn()
const mockResolveScope = jest.fn()

let definitionRecords: Array<Record<string, unknown>> = []

function matches(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === 'object' && '$in' in (value as Record<string, unknown>)) {
      return ((value as { $in: unknown[] }).$in).includes(record[key])
    }
    return record[key] === value
  })
}

const mockEm = {
  findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity === WorkflowDefinition) {
      return definitionRecords.find((record) => matches(record, where)) ?? null
    }
    return null
  }),
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

type TestStepBody = {
  stepId?: string
  activityType?: string
  config?: Record<string, unknown>
  context?: Record<string, unknown>
}

function makeRequest(body: TestStepBody): Request {
  return new Request(
    `http://localhost/api/workflows/definitions/${DEFINITION_ID}/test-step`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

function makeContext(id: string = DEFINITION_ID) {
  return { params: Promise.resolve({ id }) }
}

const validBody: TestStepBody = {
  activityType: 'SEND_EMAIL',
  config: { to: 'jane@example.com', subject: 'Hello' },
  context: {},
}

beforeAll(() => {
  if (!getActivityType(NO_MOCK_ACTIVITY_TYPE)) {
    registerActivityType({
      id: NO_MOCK_ACTIVITY_TYPE,
      icon: 'TestTube',
      i18nKey: `workflows.activities.types.${NO_MOCK_ACTIVITY_TYPE}`,
      configSchema: z.object({}).passthrough(),
      form: [],
      execute: async () => ({}),
      async: { capable: true },
    })
  }
})

beforeEach(() => {
  jest.clearAllMocks()
  definitionRecords = [
    {
      id: DEFINITION_ID,
      workflowId: 'order_approval',
      version: 3,
      tenantId: TENANT_A,
      organizationId: ORG_A,
      deletedAt: null,
    },
  ]
  mockGetAuthFromRequest.mockResolvedValue({ sub: USER_A, tenantId: TENANT_A, orgId: ORG_A })
  mockResolveScope.mockReturnValue({ selectedId: ORG_A })
  mockRbacService.userHasAllFeatures.mockResolvedValue(true)
})

describe('POST /api/workflows/definitions/[id]/test-step', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)
    const response = await POST(makeRequest(validBody) as never, makeContext())
    expect(response.status).toBe(401)
  })

  it('returns 400 when the auth context has no tenant', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: USER_A, tenantId: null, orgId: ORG_A })
    const response = await POST(makeRequest(validBody) as never, makeContext())
    expect(response.status).toBe(400)
  })

  it('returns 403 without the exact test_run feature', async () => {
    mockRbacService.userHasAllFeatures.mockResolvedValue(false)
    const response = await POST(makeRequest(validBody) as never, makeContext())
    expect(response.status).toBe(403)
    expect(mockRbacService.userHasAllFeatures).toHaveBeenCalledWith(
      USER_A,
      ['workflows.definitions.test_run'],
      { tenantId: TENANT_A, organizationId: ORG_A },
    )
  })

  it('returns 400 with issue details for a malformed body', async () => {
    const response = await POST(
      makeRequest({ config: { to: 'x' } }) as never,
      makeContext(),
    )
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.error).toBe('Validation failed')
    expect(Array.isArray(payload.details)).toBe(true)
  })

  it('returns 404 for an unknown definition id', async () => {
    const response = await POST(
      makeRequest(validBody) as never,
      makeContext('123e4567-e89b-12d3-a456-426614174099'),
    )
    expect(response.status).toBe(404)
  })

  it('does not resolve a definition from another tenant (cross-tenant isolation)', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: USER_A, tenantId: TENANT_B, orgId: ORG_B })
    mockResolveScope.mockReturnValue({ selectedId: ORG_B })
    const response = await POST(makeRequest(validBody) as never, makeContext())
    expect(response.status).toBe(404)
  })

  it('returns a structured 404 for an unknown activity type', async () => {
    const response = await POST(
      makeRequest({ ...validBody, activityType: 'NOT_A_TYPE' }) as never,
      makeContext(),
    )
    expect(response.status).toBe(404)
    const payload = await response.json()
    expect(payload).toMatchObject({ error: 'Unknown activity type', activityType: 'NOT_A_TYPE' })
  })

  it('returns a 200 refusal for EXECUTE_FUNCTION (mock: refuse)', async () => {
    const response = await POST(
      makeRequest({ activityType: 'EXECUTE_FUNCTION', config: { functionName: 'doIt' }, context: {} }) as never,
      makeContext(),
    )
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({ refused: true, reason: 'refused', activityType: 'EXECUTE_FUNCTION' })
  })

  it('returns a 200 refusal for CALL_API (mock: refuse)', async () => {
    const response = await POST(
      makeRequest({ activityType: 'CALL_API', config: { endpoint: '/api/example' }, context: {} }) as never,
      makeContext(),
    )
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({ refused: true, reason: 'refused', activityType: 'CALL_API' })
  })

  it('returns a 200 noMock refusal when the type declares no mock', async () => {
    const response = await POST(
      makeRequest({ activityType: NO_MOCK_ACTIVITY_TYPE, config: {}, context: {} }) as never,
      makeContext(),
    )
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({ refused: true, reason: 'noMock', activityType: NO_MOCK_ACTIVITY_TYPE })
  })

  it('simulates INVOKE_AGENT as a would-do naming the agent and the disposition it would request', async () => {
    const response = await POST(
      makeRequest({
        activityType: 'INVOKE_AGENT',
        config: { agentId: 'risk-scorer', onResult: { autoApproveThreshold: 0.8 } },
        context: {},
      }) as never,
      makeContext(),
    )
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.simulated).toBe(true)
    expect(payload.output).toEqual({
      simulated: true,
      invoked: false,
      kind: 'would_invoke',
      wouldInvokeAgent: 'risk-scorer',
      wouldRequestDisposition: 'human_review',
      reason: 'noConfidenceInSimulation',
      autoApproveThreshold: 0.8,
    })
  })

  it('simulates SEND_EMAIL with {{context.*}} and synthetic {{workflow.*}} interpolation', async () => {
    const response = await POST(
      makeRequest({
        stepId: 'notify',
        activityType: 'SEND_EMAIL',
        config: {
          to: '{{context.customerEmail}}',
          subject: 'Order {{context.orderId}} via instance {{workflow.instanceId}}',
        },
        context: { customerEmail: 'jane@example.com', orderId: 'ORD-42' },
      }) as never,
      makeContext(),
    )
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.simulated).toBe(true)
    expect(payload.activityType).toBe('SEND_EMAIL')
    expect(payload.output).toMatchObject({
      sent: false,
      simulated: true,
      wouldSendTo: 'jane@example.com',
      subject: 'Order ORD-42 via instance test',
    })
    expect(payload.interpolatedConfig).toEqual({
      to: 'jane@example.com',
      subject: 'Order ORD-42 via instance test',
    })
  })
})
