/** @jest-environment node */

import { z } from 'zod'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { GET } from '../route'
import { WorkflowDefinition } from '../../../../../data/entities'

const TENANT_A = '123e4567-e89b-12d3-a456-426614174001'
const TENANT_B = '123e4567-e89b-12d3-a456-426614174009'
const ORG_A = '123e4567-e89b-12d3-a456-426614174002'
const ORG_B = '123e4567-e89b-12d3-a456-426614174008'
const USER_A = '123e4567-e89b-12d3-a456-426614174010'
const DEFINITION_ID = '123e4567-e89b-12d3-a456-426614174071'
const TEST_COMMAND_ID = 'workflows.test.context_schema_update_deal'

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

const diamondDefinition = {
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'left', stepName: 'Left', stepType: 'AUTOMATED' },
    { stepId: 'right', stepName: 'Right', stepType: 'AUTOMATED' },
    {
      stepId: 'join',
      stepName: 'Join',
      stepType: 'AUTOMATED',
      activities: [
        {
          activityId: 'update_deal',
          activityType: 'UPDATE_ENTITY',
          config: { commandId: TEST_COMMAND_ID, input: {} },
          async: true,
        },
      ],
    },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [
    {
      transitionId: 'start-left',
      fromStepId: 'start',
      toStepId: 'left',
      activities: [
        {
          activityId: 'set_left',
          activityType: 'SET_VARIABLE',
          config: { assignments: [{ path: 'leftOnly', value: 'yes' }] },
        },
      ],
    },
    { transitionId: 'start-right', fromStepId: 'start', toStepId: 'right' },
    { transitionId: 'left-join', fromStepId: 'left', toStepId: 'join' },
    { transitionId: 'right-join', fromStepId: 'right', toStepId: 'join' },
    { transitionId: 'join-end', fromStepId: 'join', toStepId: 'end' },
  ],
}

function makeRequest(query = ''): Request {
  return new Request(
    `http://localhost/api/workflows/definitions/${DEFINITION_ID}/context-schema${query}`,
    { method: 'GET' },
  )
}

function makeContext(id: string = DEFINITION_ID) {
  return { params: Promise.resolve({ id }) }
}

type LedgerEntryPayload = {
  path: string
  type: string
  presence: string
  source: { kind: string; label: string }
}

beforeAll(() => {
  commandRegistry.register({
    id: TEST_COMMAND_ID,
    execute: async () => ({ dealId: 'noop', amount: 0 }),
    outputSchema: z.object({ dealId: z.string().uuid(), amount: z.number() }),
  })
})

afterAll(() => {
  commandRegistry.clear()
})

beforeEach(() => {
  jest.clearAllMocks()
  definitionRecords = [
    {
      id: DEFINITION_ID,
      tenantId: TENANT_A,
      organizationId: ORG_A,
      deletedAt: null,
      definition: diamondDefinition,
    },
  ]
  mockGetAuthFromRequest.mockResolvedValue({ sub: USER_A, tenantId: TENANT_A, orgId: ORG_A })
  mockResolveScope.mockReturnValue({ selectedId: ORG_A })
  mockRbacService.userHasAllFeatures.mockResolvedValue(true)
})

describe('GET /api/workflows/definitions/[id]/context-schema', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)
    const response = await GET(makeRequest() as never, makeContext())
    expect(response.status).toBe(401)
  })

  it('returns 403 without the view feature and gates on workflows.definitions.view', async () => {
    mockRbacService.userHasAllFeatures.mockResolvedValue(false)
    const response = await GET(makeRequest() as never, makeContext())
    expect(response.status).toBe(403)
    expect(mockRbacService.userHasAllFeatures).toHaveBeenCalledWith(
      USER_A,
      ['workflows.definitions.view'],
      { tenantId: TENANT_A, organizationId: ORG_A },
    )
  })

  it('returns 404 for an unknown definition id', async () => {
    const response = await GET(
      makeRequest() as never,
      makeContext('123e4567-e89b-12d3-a456-426614174099'),
    )
    expect(response.status).toBe(404)
  })

  it('does not serve a definition from another tenant (cross-tenant isolation)', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: USER_A, tenantId: TENANT_B, orgId: ORG_B })
    mockResolveScope.mockReturnValue({ selectedId: ORG_B })
    const response = await GET(makeRequest() as never, makeContext())
    expect(response.status).toBe(404)
  })

  it('serves the per-step ledger with a maybe-at-join entry and typed async UPDATE_ENTITY entries', async () => {
    const response = await GET(makeRequest() as never, makeContext())
    expect(response.status).toBe(200)
    const payload = await response.json() as { steps: Record<string, { entries: LedgerEntryPayload[] }> }

    expect(Object.keys(payload.steps).sort()).toEqual(['end', 'join', 'left', 'right', 'start'])

    const joinEntries = payload.steps.join.entries
    const leftOnlyAtJoin = joinEntries.find((entry) => entry.path === 'leftOnly')
    expect(leftOnlyAtJoin).toMatchObject({ presence: 'maybe', source: { kind: 'setVariable' } })

    const endEntries = payload.steps.end.entries
    expect(endEntries.find((entry) => entry.path === 'update_deal_result.dealId')).toMatchObject({
      type: 'text',
      presence: 'always',
      source: { kind: 'asyncResult', activityId: 'update_deal' },
    })
    expect(endEntries.find((entry) => entry.path === 'update_deal_result.amount')).toMatchObject({
      type: 'number',
      presence: 'always',
    })
  })

  it('narrows the response to one step with ?stepId', async () => {
    const response = await GET(makeRequest('?stepId=join') as never, makeContext())
    expect(response.status).toBe(200)
    const payload = await response.json() as { steps: Record<string, { entries: LedgerEntryPayload[] }> }
    expect(Object.keys(payload.steps)).toEqual(['join'])
    expect(payload.steps.join.entries.some((entry) => entry.path === 'leftOnly')).toBe(true)
  })

  it('returns 404 for a stepId that does not exist in the definition', async () => {
    const response = await GET(makeRequest('?stepId=not-a-step') as never, makeContext())
    expect(response.status).toBe(404)
    const payload = await response.json()
    expect(payload.error).toBe('Step not found in workflow definition')
  })
})
