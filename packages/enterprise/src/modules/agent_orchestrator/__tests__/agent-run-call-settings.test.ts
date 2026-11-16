/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'

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
}))

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { POST as runPost } from '../api/agents/[id]/run/route'
import { POST as rerunPost } from '../api/runs/[id]/rerun/route'
import { AgentWorkflowBridgeService } from '../lib/runtime/invokeAgentForWorkflow'
import { AgentCallSettingsUnsupportedError, hasCallSettings } from '../lib/runtime/errors'
import { parseAgentRunRequest } from '../lib/runtime/agentRunHttp'
import { AgentRun } from '../data/entities'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '44444444-4444-4444-8444-444444444444'
const SOURCE_RUN_ID = '55555555-5555-4555-8555-555555555555'
const AGENT_ID = 'test.call_settings'

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
  return em as unknown as EntityManager
}

let runtimeFailure: Error | null = null

function recordingRuntime() {
  const calls: RunCtx[] = []
  const run = jest.fn(async (_agentId: string, _input: unknown, ctx: RunCtx) => {
    calls.push(ctx)
    if (runtimeFailure) throw runtimeFailure
    return { kind: 'research', data: { ok: true } }
  })
  return { run, calls }
}

function mockCaller(runtime: { run: jest.Mock }, em: EntityManager) {
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: USER, tenantId: TENANT, orgId: ORG })
  ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
    selectedId: ORG,
    filterIds: [ORG],
    allowedIds: [ORG],
    tenantId: TENANT,
  })
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => {
      if (token === 'agentRuntime') return runtime
      if (token === 'em') return em
      return null
    },
  })
}

async function callRun(body: unknown) {
  const runtime = recordingRuntime()
  mockCaller(runtime, createFakeEm())
  const response = await runPost(
    new Request(`http://localhost/api/agent_orchestrator/agents/${AGENT_ID}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: AGENT_ID }) },
  )
  return { status: response.status, body: (await response.json()) as Row, runtime }
}

async function callRerun(body?: unknown) {
  const runtime = recordingRuntime()
  const em = createFakeEm(
    new Map<unknown, Row[]>([
      [
        AgentRun,
        [{ id: SOURCE_RUN_ID, tenantId: TENANT, organizationId: ORG, agentId: AGENT_ID, input: { q: 1 }, deletedAt: null }],
      ],
    ]),
  )
  mockCaller(runtime, em)
  const init: RequestInit = { method: 'POST' }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const response = await rerunPost(
    new Request(`http://localhost/api/agent_orchestrator/runs/${SOURCE_RUN_ID}/rerun`, init),
    { params: Promise.resolve({ id: SOURCE_RUN_ID }) },
  )
  return { status: response.status, body: (await response.json()) as Row, runtime }
}

beforeEach(() => {
  jest.clearAllMocks()
  runtimeFailure = null
})

describe('parseAgentRunRequest', () => {
  it('keeps the input-only body unchanged (no callSettings key)', () => {
    expect(parseAgentRunRequest({ input: { a: 1 } })).toEqual({ ok: true, input: { a: 1 } })
  })

  it('returns validated callSettings alongside the input', () => {
    expect(parseAgentRunRequest({ input: 'x', callSettings: { temperature: 0, seed: 7 } })).toEqual({
      ok: true,
      input: 'x',
      callSettings: { temperature: 0, seed: 7 },
    })
  })

  it.each([
    ['an unknown key', { temperature: 0.2, notARealSetting: true }],
    ['providerOptions (not accepted over HTTP)', { providerOptions: { openai: { store: true } } }],
    ['temperature above the cap', { temperature: 3 }],
    ['maxOutputTokens above the cap', { maxOutputTokens: 32_769 }],
    ['too many stop sequences', { stopSequences: ['a', 'b', 'c', 'd', 'e'] }],
    ['a non-integer seed', { seed: 1.5 }],
  ])('rejects %s with 422', (_label, callSettings) => {
    const parsed = parseAgentRunRequest({ input: {}, callSettings })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.response.status).toBe(422)
  })
})

describe('POST /agents/:id/run — call-time overrides', () => {
  it('forwards callSettings into the run ctx', async () => {
    const { status, runtime } = await callRun({ input: { q: 1 }, callSettings: { temperature: 0.1, maxOutputTokens: 256 } })
    expect(status).toBe(200)
    expect(runtime.calls[0].callSettings).toEqual({ temperature: 0.1, maxOutputTokens: 256 })
    expect(runtime.calls[0].tenantId).toBe(TENANT)
    expect(runtime.calls[0].organizationId).toBe(ORG)
  })

  it('leaves callSettings off the ctx when the body has none', async () => {
    const { status, runtime } = await callRun({ input: { q: 1 } })
    expect(status).toBe(200)
    expect(runtime.calls[0]).not.toHaveProperty('callSettings')
  })

  it('rejects invalid callSettings before the runtime is reached', async () => {
    const { status, runtime } = await callRun({ input: {}, callSettings: { providerOptions: { x: 1 } } })
    expect(status).toBe(422)
    expect(runtime.run).not.toHaveBeenCalled()
  })

  it('maps a runtime that cannot apply call settings to a typed 422', async () => {
    runtimeFailure = new AgentCallSettingsUnsupportedError(AGENT_ID)
    const { status, body } = await callRun({ input: {}, callSettings: { temperature: 0 } })
    expect(status).toBe(422)
    expect(body).toEqual({ error: expect.any(String), code: 'call_settings_unsupported' })
  })
})

describe('POST /runs/:id/rerun — call-time overrides', () => {
  it('keeps working with no body and passes no callSettings', async () => {
    const { status, runtime } = await callRerun()
    expect(status).toBe(200)
    expect(runtime.calls[0]).not.toHaveProperty('callSettings')
    expect(runtime.calls[0].entryPoint).toBe('rerun')
  })

  it.each([null, [], 'text'])('treats a non-object body (%p) as no body', async (body) => {
    const { status, runtime } = await callRerun(body)
    expect(status).toBe(200)
    expect(runtime.calls[0]).not.toHaveProperty('callSettings')
  })

  it('forwards callSettings from the optional body', async () => {
    const { status, runtime } = await callRerun({ callSettings: { seed: 3 } })
    expect(status).toBe(200)
    expect(runtime.calls[0].callSettings).toEqual({ seed: 3 })
  })

  it('rejects invalid callSettings with 422 before running', async () => {
    const { status, runtime } = await callRerun({ callSettings: { topP: 2 } })
    expect(status).toBe(422)
    expect(runtime.run).not.toHaveBeenCalled()
  })

  it('maps the unsupported-runtime error to a typed 422', async () => {
    runtimeFailure = new AgentCallSettingsUnsupportedError(AGENT_ID)
    const { status, body } = await callRerun({ callSettings: { temperature: 0 } })
    expect(status).toBe(422)
    expect(body.code).toBe('call_settings_unsupported')
  })
})

describe('workflow bridge — INVOKE_AGENT callSettings', () => {
  function bridgeWith(runtime: { run: jest.Mock }) {
    return new AgentWorkflowBridgeService({
      container: { resolve: (token: string) => (token === 'em' ? createFakeEm() : undefined) } as unknown as AwilixContainer,
      agentRuntime: runtime as never,
      dispositionService: { dispose: jest.fn() } as never,
    })
  }
  const baseCtx = { tenantId: TENANT, organizationId: ORG, userId: USER, workflowInstanceId: 'wf-1', stepId: 'step-1' }

  it('forwards valid callSettings to the run', async () => {
    const runtime = recordingRuntime()
    await bridgeWith(runtime).invokeAgentForWorkflow({
      agentId: AGENT_ID,
      input: {},
      onResult: { alwaysAsk: true },
      ctx: { ...baseCtx, callSettings: { temperature: 0, seed: 11 } },
    })
    expect(runtime.calls[0].callSettings).toEqual({ temperature: 0, seed: 11 })
    expect(runtime.calls[0].entryPoint).toBe('workflow')
  })

  it('passes no callSettings when the step declares none', async () => {
    const runtime = recordingRuntime()
    await bridgeWith(runtime).invokeAgentForWorkflow({ agentId: AGENT_ID, input: {}, onResult: { alwaysAsk: true }, ctx: baseCtx })
    expect(runtime.calls[0]).not.toHaveProperty('callSettings')
  })

  it('fails the step on callSettings that do not validate after the queue boundary', async () => {
    const runtime = recordingRuntime()
    await expect(
      bridgeWith(runtime).invokeAgentForWorkflow({
        agentId: AGENT_ID,
        input: {},
        onResult: { alwaysAsk: true },
        ctx: { ...baseCtx, callSettings: { providerOptions: { openai: {} } } },
      }),
    ).rejects.toThrow('INVOKE_AGENT callSettings are invalid')
    expect(runtime.run).not.toHaveBeenCalled()
  })
})

describe('hasCallSettings', () => {
  it('treats a missing or all-undefined object as no settings', () => {
    expect(hasCallSettings(undefined)).toBe(false)
    expect(hasCallSettings({})).toBe(false)
    expect(hasCallSettings({ temperature: undefined })).toBe(false)
    expect(hasCallSettings({ temperature: 0 })).toBe(true)
  })
})
