import {
  AiAgentRun,
  AiAgentRunStep,
  AiAgentRunToolCall,
  AiChatConversation,
  AiChatConversationParticipant,
} from '../../../../data/entities'
import { createAgentRunReader } from '../../../../lib/agent-run-reader'

const authMock = jest.fn()
const loadAclMock = jest.fn()
const createRequestContainerMock = jest.fn()
const findMock = jest.fn()
const findOneMock = jest.fn()
const findAndCountMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => authMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneMock(...args),
  findAndCountWithDecryption: (...args: unknown[]) => findAndCountMock(...args),
}))

import { GET as listRuns, metadata as listMetadata, openApi as listOpenApi } from '../route'
import {
  GET as getRun,
  metadata as detailMetadata,
  openApi as detailOpenApi,
} from '../[id]/route'
import {
  GET as listConversationRuns,
  metadata as conversationMetadata,
  openApi as conversationOpenApi,
} from '../../conversations/[conversationId]/runs/route'

type Row = Record<string, unknown>
type Where = Record<string, unknown>

const TENANT = '00000000-0000-4000-8000-0000000000a1'
const ORG = '00000000-0000-4000-8000-0000000000b1'
const OTHER_ORG = '00000000-0000-4000-8000-0000000000b2'
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000a2'
const USER_A = '00000000-0000-4000-8000-0000000000c1'
const USER_B = '00000000-0000-4000-8000-0000000000c2'
const USER_C = '00000000-0000-4000-8000-0000000000c3'

function compare(actual: unknown, operator: string, expected: unknown): boolean {
  if (operator === '$in') return (expected as unknown[]).includes(actual)
  if (operator === '$ne') return actual !== expected
  const left = actual instanceof Date ? actual.getTime() : Number(actual)
  const right = expected instanceof Date ? expected.getTime() : Number(expected)
  if (operator === '$gte') return left >= right
  if (operator === '$lte') return left <= right
  if (operator === '$lt') return left < right
  throw new Error(`[internal] unsupported operator ${operator}`)
}

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === '$or') return (expected as Where[]).some((branch) => matches(row, branch))
    const actual = row[key] ?? null
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      return Object.entries(expected as Where).every(([operator, value]) => compare(actual, operator, value))
    }
    return actual === expected
  })
}

let runs: Row[] = []
let steps: Row[] = []
let toolCalls: Row[] = []
let conversations: Row[] = []
let participants: Row[] = []

function rowsFor(entity: unknown): Row[] {
  if (entity === AiAgentRun) return runs
  if (entity === AiAgentRunStep) return steps
  if (entity === AiAgentRunToolCall) return toolCalls
  if (entity === AiChatConversation) return conversations
  if (entity === AiChatConversationParticipant) return participants
  throw new Error('[internal] unexpected entity')
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  const clauses = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []
  return [...rows].sort((left, right) => {
    for (const clause of clauses as Array<Record<string, 'asc' | 'desc'>>) {
      for (const [field, direction] of Object.entries(clause)) {
        const a = left[field] instanceof Date ? (left[field] as Date).getTime() : (left[field] as number | string)
        const b = right[field] instanceof Date ? (right[field] as Date).getTime() : (right[field] as number | string)
        if (a === b) continue
        const delta = a < b ? -1 : 1
        return direction === 'desc' ? -delta : delta
      }
    }
    return 0
  })
}

const em = { fork: () => em }

let rowCounter = 0

function nextId(): string {
  rowCounter += 1
  return `00000000-0000-4000-8000-${String(rowCounter).padStart(12, '0')}`
}

function makeRun(overrides: Row = {}): Row {
  const index = rowCounter + 1
  const startedAt = new Date(Date.now() - (100 - index) * 60_000)
  return {
    id: nextId(),
    tenantId: TENANT,
    organizationId: ORG,
    userId: USER_A,
    apiKeyId: null,
    agentId: 'catalog.assistant',
    moduleId: 'catalog',
    agentVersion: '1',
    agentDefinitionHash: 'hash',
    promptOverrideId: null,
    promptOverrideVersion: null,
    executionMode: 'chat',
    channel: 'chat',
    conversationId: null,
    turnId: 'turn',
    correlationId: null,
    providerId: 'openai',
    modelId: 'gpt-test',
    baseUrlHost: null,
    modelParams: {},
    effectiveMutationPolicy: 'confirm',
    toolNames: [],
    status: 'completed',
    stopReason: null,
    finishReason: 'stop',
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: null,
    reasoningTokens: null,
    stepCount: 1,
    toolCallCount: 0,
    durationMs: 100,
    startedAt,
    completedAt: new Date(startedAt.getTime() + 100),
    inputText: 'secret input',
    outputText: 'secret output',
    contentTruncated: false,
    systemPromptHash: 'sp',
    systemPrompt: null,
    citations: null,
    errorCode: null,
    errorMessage: null,
    captureLevel: 'full',
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
    ...overrides,
  }
}

function makeConversation(conversationId: string, overrides: Row = {}): Row {
  return {
    id: nextId(),
    tenantId: TENANT,
    organizationId: ORG,
    conversationId,
    ownerUserId: USER_A,
    visibility: 'private',
    deletedAt: null,
    ...overrides,
  }
}

function grant(features: string[], isSuperAdmin = false) {
  loadAclMock.mockResolvedValue({ features, isSuperAdmin })
}

function signIn(userId: string, orgId: string | null = ORG, tenantId: string | null = TENANT) {
  authMock.mockResolvedValue({ sub: userId, tenantId, orgId })
}

function request(path: string): Request {
  return new Request(`http://localhost/api/ai_assistant/ai${path}`, { method: 'GET' })
}

async function listIds(query = ''): Promise<string[]> {
  const response = await listRuns(request(`/runs${query}`) as never)
  expect(response.status).toBe(200)
  const body = await response.json()
  return (body.items as Array<{ id: string }>).map((item) => item.id)
}

async function detail(id: string): Promise<Response> {
  return getRun(request(`/runs/${id}`) as never, { params: Promise.resolve({ id }) })
}

async function conversationRuns(conversationId: string, query = ''): Promise<Response> {
  return listConversationRuns(request(`/conversations/${conversationId}/runs${query}`) as never, {
    params: Promise.resolve({ conversationId }),
  })
}

describe('AI agent runs API', () => {
  let ownRun: Row
  let otherPrivateRun: Row
  let sharedRun: Row
  let orgVisibleRun: Row
  let otherOrgRun: Row
  let otherTenantRun: Row
  let deletedRun: Row

  beforeEach(() => {
    jest.clearAllMocks()
    rowCounter = 0
    signIn(USER_A)
    grant(['ai_assistant.runs.view'])
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rbacService') return { loadAcl: loadAclMock }
        if (name === 'em') return em
        if (name === 'aiAgentRunReader') return createAgentRunReader(() => em as never)
        return null
      },
    })
    findMock.mockImplementation(async (_em: unknown, entity: unknown, where: Where, options?: Row) =>
      sortRows(rowsFor(entity).filter((row) => matches(row, where)), options?.orderBy),
    )
    findOneMock.mockImplementation(
      async (_em: unknown, entity: unknown, where: Where) =>
        rowsFor(entity).find((row) => matches(row, where)) ?? null,
    )
    findAndCountMock.mockImplementation(
      async (_em: unknown, entity: unknown, where: Where, options: { limit: number; offset: number; orderBy: unknown }) => {
        const matching = sortRows(rowsFor(entity).filter((row) => matches(row, where)), options.orderBy)
        return [matching.slice(options.offset, options.offset + options.limit), matching.length]
      },
    )

    conversations = [
      makeConversation('conv-a', { ownerUserId: USER_A }),
      makeConversation('conv-b-private', { ownerUserId: USER_B }),
      makeConversation('conv-b-shared', { ownerUserId: USER_B, visibility: 'shared' }),
      makeConversation('conv-b-org', { ownerUserId: USER_B, visibility: 'organization' }),
      makeConversation('conv-other-org', { ownerUserId: USER_B, organizationId: OTHER_ORG, visibility: 'organization' }),
    ]
    participants = [
      { tenantId: TENANT, organizationId: ORG, conversationId: 'conv-b-shared', userId: USER_A, deletedAt: null },
      { tenantId: TENANT, organizationId: ORG, conversationId: 'conv-b-private', userId: USER_C, deletedAt: null },
    ]
    ownRun = makeRun({ conversationId: 'conv-a' })
    otherPrivateRun = makeRun({ userId: USER_B, conversationId: 'conv-b-private', agentId: 'sales.assistant' })
    sharedRun = makeRun({ userId: USER_B, conversationId: 'conv-b-shared', channel: 'playground', status: 'failed' })
    orgVisibleRun = makeRun({ userId: USER_B, conversationId: 'conv-b-org' })
    otherOrgRun = makeRun({ organizationId: OTHER_ORG, conversationId: 'conv-other-org' })
    otherTenantRun = makeRun({ tenantId: OTHER_TENANT })
    deletedRun = makeRun({ deletedAt: new Date() })
    runs = [ownRun, otherPrivateRun, sharedRun, orgVisibleRun, otherOrgRun, otherTenantRun, deletedRun]
    steps = [
      { id: nextId(), tenantId: TENANT, organizationId: ORG, runId: ownRun.id, stepIndex: 0, modelId: 'gpt-test', finishReason: 'tool-calls', inputTokens: 1, outputTokens: 1, text: 'step text', textTruncated: false, endedAt: new Date(), durationMs: 5, updatedAt: new Date() },
    ]
    toolCalls = [
      { id: nextId(), tenantId: TENANT, organizationId: ORG, runId: ownRun.id, stepIndex: 0, callIndex: 0, toolCallId: 'call-1', toolName: 'catalog.update_product', isMutation: true, pendingActionId: 'pa-1', argKeys: ['id'], args: { id: 'p1' }, result: { ok: true }, argsTruncated: false, resultTruncated: false, resultBytes: 11, errorCode: null, errorMessage: null, durationMs: 3, updatedAt: new Date() },
    ]
  })

  it('declares runs.view metadata and OpenAPI docs on every route', () => {
    for (const routeMetadata of [listMetadata, detailMetadata, conversationMetadata]) {
      expect(routeMetadata.GET).toEqual({ requireAuth: true, requireFeatures: ['ai_assistant.runs.view'] })
    }
    for (const doc of [listOpenApi, detailOpenApi, conversationOpenApi]) {
      expect(doc.methods?.GET).toBeDefined()
    }
  })

  describe('auth', () => {
    it('returns 401 without a session on every route', async () => {
      authMock.mockResolvedValue(null)
      expect((await listRuns(request('/runs') as never)).status).toBe(401)
      expect((await detail(ownRun.id as string)).status).toBe(401)
      expect((await conversationRuns('conv-a')).status).toBe(401)
    })

    it('returns 403 without ai_assistant.runs.view on every route', async () => {
      grant(['ai_assistant.view'])
      expect((await listRuns(request('/runs') as never)).status).toBe(403)
      expect((await detail(ownRun.id as string)).status).toBe(403)
      expect((await conversationRuns('conv-a')).status).toBe(403)
    })

    it('accepts the ai_assistant.* wildcard', async () => {
      grant(['ai_assistant.*'])
      expect(await listIds()).toHaveLength(4)
    })
  })

  describe('GET /runs', () => {
    it('lists own runs plus shared-participant and org-visible conversation runs, never others', async () => {
      const ids = await listIds()
      expect(ids.sort()).toEqual([ownRun.id, sharedRun.id, orgVisibleRun.id].sort())
    })

    it('lists every run of the tenant/org with runs.view_all, never other orgs, tenants or deleted rows', async () => {
      grant(['ai_assistant.runs.view', 'ai_assistant.runs.view_all'])
      const ids = await listIds()
      expect(ids.sort()).toEqual([ownRun.id, otherPrivateRun.id, sharedRun.id, orgVisibleRun.id].sort())
    })

    it('scopes a participant to their conversations', async () => {
      signIn(USER_C)
      expect(await listIds()).toEqual(expect.arrayContaining([otherPrivateRun.id, orgVisibleRun.id]))
      expect(await listIds()).not.toContain(ownRun.id)
    })

    it('omits content fields and returns updatedAt', async () => {
      const response = await listRuns(request('/runs') as never)
      const body = await response.json()
      const item = body.items.find((row: Row) => row.id === ownRun.id)
      expect(item.updatedAt).toBe((ownRun.updatedAt as Date).toISOString())
      expect(item).not.toHaveProperty('inputText')
      expect(item).not.toHaveProperty('outputText')
      expect(item).not.toHaveProperty('systemPrompt')
      expect(item).not.toHaveProperty('citations')
    })

    it('paginates newest first', async () => {
      grant(['ai_assistant.runs.view', 'ai_assistant.runs.view_all'])
      const response = await listRuns(request('/runs?page=2&pageSize=3') as never)
      const body = await response.json()
      expect(body).toMatchObject({ total: 4, page: 2, pageSize: 3, totalPages: 2 })
      expect(body.items.map((row: Row) => row.id)).toEqual([ownRun.id])
    })

    it('applies agent, channel, status, user, conversation and date filters', async () => {
      grant(['ai_assistant.runs.view', 'ai_assistant.runs.view_all'])
      expect(await listIds('?agentId=sales.assistant')).toEqual([otherPrivateRun.id])
      expect(await listIds('?channel=playground')).toEqual([sharedRun.id])
      expect(await listIds('?status=failed')).toEqual([sharedRun.id])
      expect((await listIds(`?userId=${USER_A}`))).toEqual([ownRun.id])
      expect(await listIds('?conversationId=conv-b-org')).toEqual([orgVisibleRun.id])
      const from = (sharedRun.startedAt as Date).toISOString()
      expect((await listIds(`?from=${encodeURIComponent(from)}`)).sort()).toEqual([sharedRun.id, orgVisibleRun.id].sort())
      expect(await listIds(`?to=${encodeURIComponent((ownRun.startedAt as Date).toISOString())}`)).toEqual([ownRun.id])
    })

    it('cannot widen scope through the userId filter', async () => {
      expect(await listIds(`?userId=${USER_B}`)).toEqual(expect.not.arrayContaining([otherPrivateRun.id]))
    })

    it('rejects pageSize above 100 and invalid filters', async () => {
      expect((await listRuns(request('/runs?pageSize=101') as never)).status).toBe(400)
      expect((await listRuns(request('/runs?channel=bogus') as never)).status).toBe(400)
    })
  })

  describe('GET /runs/:id', () => {
    it('returns the run with decrypted content, steps, tool calls and links', async () => {
      const response = await detail(ownRun.id as string)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.run).toMatchObject({ id: ownRun.id, inputText: 'secret input', outputText: 'secret output' })
      expect(body.run.updatedAt).toBe((ownRun.updatedAt as Date).toISOString())
      expect(body.steps).toHaveLength(1)
      expect(body.toolCalls[0]).toMatchObject({ toolName: 'catalog.update_product', args: { id: 'p1' } })
      expect(body.links).toEqual({ conversationId: 'conv-a', pendingActionIds: ['pa-1'] })
    })

    it("returns 404 for another user's private-conversation run", async () => {
      expect((await detail(otherPrivateRun.id as string)).status).toBe(404)
    })

    it('returns 200 for runs of shared (participant) and org-visible conversations', async () => {
      expect((await detail(sharedRun.id as string)).status).toBe(200)
      expect((await detail(orgVisibleRun.id as string)).status).toBe(200)
    })

    it('returns 200 for any in-scope run with runs.view_all', async () => {
      grant(['ai_assistant.runs.view', 'ai_assistant.runs.view_all'])
      expect((await detail(otherPrivateRun.id as string)).status).toBe(200)
    })

    it('returns 404 out of org, out of tenant or deleted even with runs.view_all', async () => {
      grant(['ai_assistant.runs.view', 'ai_assistant.runs.view_all'])
      expect((await detail(otherOrgRun.id as string)).status).toBe(404)
      expect((await detail(otherTenantRun.id as string)).status).toBe(404)
      expect((await detail(deletedRun.id as string)).status).toBe(404)
    })

    it('returns 400 for a non-uuid id', async () => {
      expect((await detail('not-a-uuid')).status).toBe(400)
    })
  })

  describe('GET /conversations/:conversationId/runs', () => {
    it('lists runs of an owned conversation ordered by startedAt', async () => {
      const extra = makeRun({ conversationId: 'conv-a', userId: USER_B, startedAt: new Date((ownRun.startedAt as Date).getTime() + 1000) })
      runs.push(extra)
      const response = await conversationRuns('conv-a')
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.items.map((row: Row) => row.id)).toEqual([ownRun.id, extra.id])
      expect(body.items[0]).not.toHaveProperty('inputText')
    })

    it('allows participants and org-visible conversations', async () => {
      expect((await conversationRuns('conv-b-shared')).status).toBe(200)
      expect((await conversationRuns('conv-b-org')).status).toBe(200)
    })

    it('returns 404 for a conversation the caller cannot read', async () => {
      expect((await conversationRuns('conv-b-private')).status).toBe(404)
      expect((await conversationRuns('conv-other-org')).status).toBe(404)
    })

    it('returns 404 after a participant is revoked', async () => {
      participants[0].deletedAt = new Date()
      expect((await conversationRuns('conv-b-shared')).status).toBe(404)
    })

    it('allows any conversation of the org with runs.view_all but not other orgs', async () => {
      grant(['ai_assistant.runs.view', 'ai_assistant.runs.view_all'])
      const response = await conversationRuns('conv-b-private')
      expect(response.status).toBe(200)
      expect((await response.json()).items.map((row: Row) => row.id)).toEqual([otherPrivateRun.id])
      expect((await conversationRuns('conv-other-org')).status).toBe(404)
      expect((await conversationRuns('conv-missing')).status).toBe(404)
    })

    it('paginates and caps pageSize', async () => {
      expect((await conversationRuns('conv-a', '?pageSize=101')).status).toBe(400)
      const response = await conversationRuns('conv-a', '?page=2&pageSize=1')
      expect(await response.json()).toMatchObject({ total: 1, page: 2, items: [] })
    })
  })
})
