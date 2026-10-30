/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'

jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => undefined),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(
    async (em: { findOne: (entity: unknown, where: unknown) => Promise<unknown> }, entity: unknown, where: unknown) =>
      em.findOne(entity, where),
  ),
  findWithDecryption: jest.fn(
    async (em: { find: (entity: unknown, where: unknown) => Promise<unknown> }, entity: unknown, where: unknown) =>
      em.find(entity, where),
  ),
}))

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { POST as runPost } from '../api/agents/[id]/run/route'
import { POST as rerunPost } from '../api/runs/[id]/rerun/route'
import { aiTools } from '../ai-tools'
import { DELEGATE_TOOL_ID, defineAgent } from '../lib/sdk/defineAgent'
import { AgentWorkflowBridgeService } from '../lib/runtime/invokeAgentForWorkflow'
import { executeCaseRun, resetEvalSetManifestCache } from '../lib/eval/evalReplayService'
import { AgentInvokeDeniedError, AGENT_INVOKE_DENIED_CODE } from '../lib/runtime/errors'
import { invokerFromAuth } from '../lib/access/invokeDenial'
import { AgentEvalCase, AgentEvalCaseRun, AgentEvalSuiteRun, AgentRun } from '../data/entities'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '44444444-4444-4444-8444-444444444444'
const KEY_ID = '77777777-7777-4777-8777-777777777777'
const KEY_OWNER = '88888888-8888-4888-8888-888888888888'
const SOURCE_RUN_ID = '55555555-5555-4555-8555-555555555555'
const AGENT_ID = 'test.invoke_gated'
const SECRET_FEATURE = 'secret_module.secret_feature'

type Row = Record<string, unknown>
type RunCtx = Record<string, unknown>

function createFakeEm(seed: Map<unknown, Row[]> = new Map()) {
  const stores = new Map<unknown, Row[]>(seed)
  const storeFor = (entity: unknown) => {
    if (!stores.has(entity)) stores.set(entity, [])
    return stores.get(entity) as Row[]
  }
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => {
      if (value !== null && typeof value === 'object') return true
      return (row[key] ?? null) === value
    })
  const em = {
    fork: () => em,
    async flush() {
      return undefined
    },
    async findOne(entity: unknown, where: Row) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Row) {
      return storeFor(entity).filter((row) => matches(row, where))
    },
  }
  return { em: em as unknown as EntityManager, storeFor }
}

function deniedRuntime() {
  const calls: RunCtx[] = []
  const run = jest.fn(async (agentId: string, _input: unknown, ctx: RunCtx) => {
    calls.push(ctx)
    throw new AgentInvokeDeniedError(agentId)
  })
  return { run, calls }
}

async function mockHttpCaller(auth: Record<string, unknown>) {
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId: TENANT, orgId: ORG, ...auth })
  ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
    selectedId: ORG,
    filterIds: [ORG],
    allowedIds: [ORG],
    tenantId: TENANT,
  })
}

function mockRequestContainer(runtime: { run: jest.Mock }, em: EntityManager) {
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => {
      if (token === 'agentRuntime') return runtime
      if (token === 'em') return em
      return null
    },
  })
}

const SESSION_AUTH = { sub: USER }
const API_KEY_AUTH = { sub: `api_key:${KEY_ID}`, isApiKey: true, keyId: KEY_ID, userId: KEY_OWNER }

type AdapterOutcome = { code: unknown; ctx: RunCtx; status?: number; body?: Record<string, unknown> }

async function viaRunRoute(auth: Record<string, unknown> = SESSION_AUTH): Promise<AdapterOutcome> {
  await mockHttpCaller(auth)
  const runtime = deniedRuntime()
  mockRequestContainer(runtime, createFakeEm().em)
  const response = await runPost(
    new Request(`http://localhost/api/agent_orchestrator/agents/${AGENT_ID}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { question: 'q' } }),
    }),
    { params: Promise.resolve({ id: AGENT_ID }) },
  )
  const body = (await response.json()) as Record<string, unknown>
  return { code: body.code, ctx: runtime.calls[0], status: response.status, body }
}

async function viaRerunRoute(auth: Record<string, unknown> = SESSION_AUTH): Promise<AdapterOutcome> {
  await mockHttpCaller(auth)
  const runtime = deniedRuntime()
  const { em } = createFakeEm(
    new Map<unknown, Row[]>([
      [
        AgentRun,
        [{ id: SOURCE_RUN_ID, tenantId: TENANT, organizationId: ORG, agentId: AGENT_ID, input: { question: 'q' }, deletedAt: null }],
      ],
    ]),
  )
  mockRequestContainer(runtime, em)
  const response = await rerunPost(
    new Request(`http://localhost/api/agent_orchestrator/runs/${SOURCE_RUN_ID}/rerun`, { method: 'POST' }),
    { params: Promise.resolve({ id: SOURCE_RUN_ID }) },
  )
  const body = (await response.json()) as Record<string, unknown>
  return { code: body.code, ctx: runtime.calls[0], status: response.status, body }
}

async function viaDelegateTool(): Promise<AdapterOutcome> {
  const delegateTool = aiTools.find((tool) => tool.name === DELEGATE_TOOL_ID)
  if (!delegateTool) throw new Error('[internal] delegate_agent tool missing')
  const runtime = deniedRuntime()
  const container = {
    resolve: (name: string) => {
      if (name === 'agentRuntime') return runtime
      if (name === 'agentRunSessionStore') return { resolveActiveRunId: async () => null }
      return undefined
    },
  }
  const result = (await delegateTool.handler({ agentId: AGENT_ID, input: { question: 'q' } }, {
    tenantId: TENANT,
    organizationId: ORG,
    userId: USER,
    container,
    userFeatures: [],
    isSuperAdmin: false,
  } as never)) as Record<string, unknown>
  return { code: result.error, ctx: runtime.calls[0], body: result }
}

async function viaWorkflowBridge(): Promise<AdapterOutcome> {
  const runtime = deniedRuntime()
  const { em } = createFakeEm()
  const bridge = new AgentWorkflowBridgeService({
    container: { resolve: (token: string) => (token === 'em' ? em : undefined) } as unknown as AwilixContainer,
    agentRuntime: runtime as never,
    dispositionService: { dispose: jest.fn() } as never,
  })
  try {
    await bridge.invokeAgentForWorkflow({
      agentId: AGENT_ID,
      input: {},
      onResult: { alwaysAsk: true },
      ctx: { tenantId: TENANT, organizationId: ORG, userId: USER, workflowInstanceId: 'wf-1', stepId: 'step-1' },
    })
  } catch (err) {
    return { code: (err as { code?: unknown }).code, ctx: runtime.calls[0] }
  }
  throw new Error('[internal] expected the workflow bridge to reject')
}

async function viaEvalReplay(): Promise<AdapterOutcome> {
  const runtime = deniedRuntime()
  const caseRun: Row = {
    id: 'case-run-1',
    suiteRunId: 'suite-run-1',
    tenantId: TENANT,
    organizationId: ORG,
    evalCaseId: 'case-1',
    status: 'pending',
  }
  const { em } = createFakeEm(
    new Map<unknown, Row[]>([
      [AgentEvalCaseRun, [caseRun]],
      [AgentEvalSuiteRun, [{ id: 'suite-run-1', tenantId: TENANT, organizationId: ORG, agentDefinitionId: AGENT_ID, summary: null }]],
      [
        AgentEvalCase,
        [{ id: 'case-1', tenantId: TENANT, organizationId: ORG, agentDefinitionId: AGENT_ID, input: { question: 'q' }, deletedAt: null }],
      ],
    ]),
  )
  const container = {
    resolve: (name: string) => (name === 'em' ? em : runtime),
  } as unknown as AwilixContainer
  const outcome = await executeCaseRun(container, 'case-run-1', { tenantId: TENANT, organizationId: ORG }, USER)
  const message = String(caseRun.errorMessage ?? '')
  const code = message.includes(AGENT_INVOKE_DENIED_CODE) ? AGENT_INVOKE_DENIED_CODE : message
  return { code, ctx: runtime.calls[0], body: { status: outcome.status, errorMessage: message } }
}

beforeAll(() => {
  defineAgent({
    id: AGENT_ID,
    moduleId: 'agent_orchestrator',
    label: 'Invoke-gated researcher',
    description: 'Researcher sub-agent gated by a feature.',
    instructions: 'BASE',
    requiredFeatures: [SECRET_FEATURE],
    result: { kind: 'research', schema: z.object({ kind: z.literal('research'), data: z.unknown() }) },
  })
})

beforeEach(() => {
  jest.clearAllMocks()
  resetEvalSetManifestCache()
})

describe('invokerFromAuth', () => {
  it('maps a session to a user invoker', () => {
    expect(invokerFromAuth({ sub: USER, tenantId: TENANT, orgId: ORG })).toEqual({ kind: 'user', userId: USER })
  })

  it('maps an API key to an api_key invoker carrying its owner', () => {
    expect(invokerFromAuth({ tenantId: TENANT, orgId: ORG, ...API_KEY_AUTH })).toEqual({
      kind: 'api_key',
      apiKeyId: KEY_ID,
      ownerUserId: KEY_OWNER,
    })
  })

  it('maps an ownerless API key to a null owner', () => {
    expect(
      invokerFromAuth({ sub: `api_key:${KEY_ID}`, tenantId: TENANT, orgId: ORG, isApiKey: true, keyId: KEY_ID }),
    ).toEqual({ kind: 'api_key', apiKeyId: KEY_ID, ownerUserId: null })
  })
})

describe('run and rerun routes map an invoke denial to 403', () => {
  it.each([
    ['run', viaRunRoute, 'run_api'],
    ['rerun', viaRerunRoute, 'rerun'],
  ] as const)('%s: session caller is the user invoker and a denial answers 403', async (_name, adapter, entryPoint) => {
    const outcome = await adapter(SESSION_AUTH)
    expect(outcome.status).toBe(403)
    expect(outcome.body).toEqual({ error: expect.any(String), code: 'agent_invoke_denied', agentId: AGENT_ID })
    expect(JSON.stringify(outcome.body)).not.toContain(SECRET_FEATURE)
    expect(outcome.ctx.invoker).toEqual({ kind: 'user', userId: USER })
    expect(outcome.ctx.entryPoint).toBe(entryPoint)
  })

  it.each([
    ['run', viaRunRoute],
    ['rerun', viaRerunRoute],
  ] as const)('%s: an API-key caller is the api_key invoker', async (_name, adapter) => {
    const outcome = await adapter(API_KEY_AUTH)
    expect(outcome.status).toBe(403)
    expect(outcome.ctx.invoker).toEqual({ kind: 'api_key', apiKeyId: KEY_ID, ownerUserId: KEY_OWNER })
  })
})

describe('non-HTTP entry points', () => {
  it('delegate_agent returns the denial as data with no internal message', async () => {
    const outcome = await viaDelegateTool()
    expect(outcome.body).toEqual({ ok: false, agentId: AGENT_ID, error: 'agent_invoke_denied' })
    expect(outcome.ctx.entryPoint).toBe('delegate')
  })

  it('the workflow bridge runs as the acting identity and rejects with the typed code', async () => {
    const outcome = await viaWorkflowBridge()
    expect(outcome.code).toBe('agent_invoke_denied')
    expect(outcome.ctx.invoker).toEqual({ kind: 'workflow', actingUserId: USER })
    expect(outcome.ctx.entryPoint).toBe('workflow')
  })

  it('eval replay invokes as the operator and records the case run as error with the reason', async () => {
    const outcome = await viaEvalReplay()
    expect(outcome.body).toMatchObject({ status: 'error' })
    expect(String(outcome.body?.errorMessage)).toContain('agent_invoke_denied')
    expect(String(outcome.body?.errorMessage)).not.toContain(SECRET_FEATURE)
    expect(outcome.ctx.invoker).toEqual({ kind: 'user', userId: USER })
    expect(outcome.ctx.entryPoint).toBe('eval')
    expect(outcome.ctx.source).toBe('eval')
  })
})

describe('entry-point parity', () => {
  const adapters: Array<[string, () => Promise<AdapterOutcome>]> = [
    ['run route', () => viaRunRoute()],
    ['rerun route', () => viaRerunRoute()],
    ['delegate_agent', viaDelegateTool],
    ['workflow INVOKE_AGENT', viaWorkflowBridge],
    ['eval replay', viaEvalReplay],
  ]

  it.each(adapters)('%s surfaces agent_invoke_denied for a denied invoker', async (_name, adapter) => {
    const outcome = await adapter()
    expect(outcome.code).toBe(AGENT_INVOKE_DENIED_CODE)
    expect(outcome.ctx.entryPoint).toEqual(expect.any(String))
  })
})
