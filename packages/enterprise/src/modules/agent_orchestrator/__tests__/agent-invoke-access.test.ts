jest.setTimeout(60_000)

const loggerWarnMock = jest.fn()
jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = {
    warn: (...args: unknown[]) => loggerWarnMock(...args),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: () => logger,
  }
  return { createLogger: () => logger }
})

const runAiAgentObjectMock = jest.fn<Promise<unknown>, [Record<string, unknown>]>()
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime', () => ({
  runAiAgentObject: (args: Record<string, unknown>) => runAiAgentObjectMock(args),
}))

const createRunMock = jest.fn<Promise<string>, unknown[]>()
jest.mock('../lib/runtime/persistence', () => ({
  buildCommandContext: () => ({}),
  resolveCallerAcl: async () => ({ features: [], isSuperAdmin: false }),
  createRun: (...args: unknown[]) => createRunMock(...args),
  completeRun: jest.fn(async () => undefined),
  failRun: jest.fn(async () => undefined),
  createProposal: jest.fn(async () => undefined),
  shapeResult: (_kind: 'research', data: unknown) => {
    const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
    return { kind: 'research', data: 'data' in record ? record.data : data }
  },
}))

jest.mock('../lib/guardrails/guardrailService', () => ({
  GUARDRAIL_SET_VERSION: 'test-version',
  persistVerdict: jest.fn(async () => ({})),
  GuardrailService: class {
    async checkInput() {
      return { result: 'pass', checks: [] }
    }
    async checkOutput() {
      return { result: 'pass', checks: [] }
    }
  },
}))
jest.mock('../lib/guardrails/syncGroundingSets', () => ({
  resolveCurrentGroundingSet: jest.fn(async () => null),
}))

const acquireAgentRunSlotMock = jest.fn()
jest.mock('../lib/runtime/admission', () => {
  const actual = jest.requireActual('../lib/runtime/admission')
  return {
    ...actual,
    acquireAgentRunSlot: (...args: unknown[]) => {
      acquireAgentRunSlotMock(...args)
      return actual.acquireAgentRunSlot(...args)
    },
  }
})

import { z } from 'zod'
import { AgentRuntimeService, AgentInvokeDeniedError } from '../lib/runtime/agentRuntime'
import { registerFileAgent, getAgentEntry, DELEGATE_TOOL_ID, type AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { resetAgentAdmissionForTests } from '../lib/runtime/admission'
import { getCurrentRunInvoker, withRunContext } from '../lib/runtime/runContext'
import {
  assertAgentInvocable,
  loadInvokerAcl,
  resolveInvoker,
  isAgentInvokeEnforcementEnabled,
} from '../lib/access/agentInvokeAccess'
import type { AgentInvoker } from '../lib/runtime/persistence'
import { aiTools } from '../ai-tools'

type AclRecord = { isSuperAdmin: boolean; features: string[]; organizations?: string[] | null }

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const runCtx = { ...scope, userId: 'user-1' }
const VALID_MODEL_OUTPUT = { mode: 'generate', object: { kind: 'research', data: { ok: true } } }

function registerAgent(id: string, requiredFeatures?: string[]): AgentRegistryEntry {
  const existing = getAgentEntry(id)
  if (existing) return existing
  const entry: AgentRegistryEntry = {
    id,
    moduleId: 'agent_orchestrator',
    resultKind: 'research',
    schema: z.object({ kind: z.literal('research'), data: z.unknown() }),
    tools: [],
    skills: [],
    subAgents: [],
    label: 'Invoke access test agent',
    description: 'Researcher agent for invoke-access tests.',
    instructions: 'inform',
    runtime: 'in-process',
    ...(requiredFeatures ? { requiredFeatures } : {}),
  }
  registerFileAgent(entry)
  return entry
}

function makeContainer(aclByPrincipal: Record<string, AclRecord>) {
  const loadAcl = jest.fn(async (principalId: string) => {
    const acl = aclByPrincipal[principalId]
    if (!acl) return { isSuperAdmin: false, features: [], organizations: null }
    return acl
  })
  const registrations: Record<string, unknown> = {
    em: { fork: () => ({}) },
    rbacService: { loadAcl },
  }
  const container = {
    resolve(name: string) {
      if (name in registrations) return registrations[name]
      throw new Error(`[internal] unexpected resolve("${name}")`)
    },
  }
  return { container, loadAcl }
}

function makeService(aclByPrincipal: Record<string, AclRecord>) {
  const { container, loadAcl } = makeContainer(aclByPrincipal)
  const service = new AgentRuntimeService({ container: container as never, commandBus: {} as never })
  return { service, loadAcl }
}

let runSeq = 0

beforeEach(() => {
  runAiAgentObjectMock.mockReset().mockResolvedValue(VALID_MODEL_OUTPUT)
  createRunMock.mockReset().mockImplementation(async () => `run-${++runSeq}`)
  acquireAgentRunSlotMock.mockReset()
  loggerWarnMock.mockReset()
  delete process.env.OM_AGENT_INVOKE_ENFORCEMENT
})

afterEach(() => {
  resetAgentAdmissionForTests()
  delete process.env.OM_AGENT_INVOKE_ENFORCEMENT
})

describe('assertAgentInvocable', () => {
  const entry = { id: 'invoke.agent', requiredFeatures: ['sales.orders.view', 'customers.deals.view'] }

  it('allows an agent without requiredFeatures, even with no ACL', () => {
    expect(() => assertAgentInvocable({ id: 'open.agent' }, null)).not.toThrow()
    expect(() => assertAgentInvocable({ id: 'open.agent', requiredFeatures: [] }, null)).not.toThrow()
  })

  it('allows exact grants', () => {
    const acl = { features: ['sales.orders.view', 'customers.deals.view'], isSuperAdmin: false }
    expect(() => assertAgentInvocable(entry, acl)).not.toThrow()
  })

  it('allows wildcard grants through the shared matcher', () => {
    expect(() => assertAgentInvocable(entry, { features: ['sales.*', 'customers.*'], isSuperAdmin: false })).not.toThrow()
    expect(() => assertAgentInvocable(entry, { features: ['*'], isSuperAdmin: false })).not.toThrow()
  })

  it('allows a superadmin without explicit grants', () => {
    expect(() => assertAgentInvocable(entry, { features: [], isSuperAdmin: true })).not.toThrow()
  })

  it('denies a partial grant without naming the features', () => {
    let caught: unknown = null
    try {
      assertAgentInvocable(entry, { features: ['sales.orders.view'], isSuperAdmin: false })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(AgentInvokeDeniedError)
    const denied = caught as AgentInvokeDeniedError
    expect(denied.code).toBe('agent_invoke_denied')
    expect(denied.agentId).toBe('invoke.agent')
    expect(denied.message).toContain('[internal]')
    expect(denied.message).not.toContain('customers.deals.view')
  })

  it('denies when no invoker identity exists', () => {
    expect(() => assertAgentInvocable(entry, null)).toThrow(AgentInvokeDeniedError)
  })
})

describe('resolveInvoker', () => {
  it('keeps an explicit invoker', () => {
    const invoker: AgentInvoker = { kind: 'api_key', apiKeyId: 'key-1', ownerUserId: null }
    expect(resolveInvoker({ invoker, userId: 'user-1' })).toBe(invoker)
  })

  it('derives a user invoker from userId when absent', () => {
    expect(resolveInvoker({ userId: 'user-1' })).toEqual({ kind: 'user', userId: 'user-1' })
  })

  it('returns null when no identity is available', () => {
    expect(resolveInvoker({ userId: '' })).toBeNull()
  })
})

describe('loadInvokerAcl', () => {
  it.each<[AgentInvoker, string]>([
    [{ kind: 'user', userId: 'user-1' }, 'user-1'],
    [{ kind: 'api_key', apiKeyId: 'key-1', ownerUserId: 'user-9' }, 'api_key:key-1'],
    [{ kind: 'workflow', actingUserId: 'user-2' }, 'user-2'],
    [{ kind: 'agent_token', agentUserId: 'agent-user-1', onBehalfOfUserId: 'user-3', grantId: 'grant-1' }, 'agent-user-1'],
  ])('loads the ACL for %o under principal %s', async (invoker, principalId) => {
    const { container, loadAcl } = makeContainer({
      [principalId]: { isSuperAdmin: false, features: ['sales.orders.view'], organizations: null },
    })
    const acl = await loadInvokerAcl(container as never, invoker, scope)
    expect(loadAcl).toHaveBeenCalledWith(principalId, scope)
    expect(acl).toEqual({ features: ['sales.orders.view'], isSuperAdmin: false })
  })

  it('grants nothing when the organization restriction excludes the run organization', async () => {
    const { container } = makeContainer({
      'user-1': { isSuperAdmin: false, features: ['sales.*'], organizations: ['org-other'] },
    })
    const acl = await loadInvokerAcl(container as never, { kind: 'user', userId: 'user-1' }, scope)
    expect(acl).toEqual({ features: [], isSuperAdmin: false })
  })

  it('fails closed when the RBAC service throws', async () => {
    const container = {
      resolve() {
        throw new Error('[internal] no rbac')
      },
    }
    const acl = await loadInvokerAcl(container as never, { kind: 'user', userId: 'user-1' }, scope)
    expect(acl).toEqual({ features: [], isSuperAdmin: false })
  })
})

describe('AgentRuntimeService.run invoke gate', () => {
  it('runs an agent without requiredFeatures without loading any ACL', async () => {
    registerAgent('invoke.open_agent')
    const { service, loadAcl } = makeService({})
    const result = await service.run('invoke.open_agent', {}, runCtx)
    expect(result.kind).toBe('research')
    expect(loadAcl).not.toHaveBeenCalled()
  })

  it('allows an invoker holding the agent features', async () => {
    registerAgent('invoke.gated_agent', ['sales.orders.view'])
    const { service } = makeService({ 'user-1': { isSuperAdmin: false, features: ['sales.*'] } })
    const result = await service.run('invoke.gated_agent', {}, runCtx)
    expect(result.kind).toBe('research')
    expect(acquireAgentRunSlotMock).toHaveBeenCalledTimes(1)
  })

  it('checks an API-key invoker against the api key ACL', async () => {
    registerAgent('invoke.gated_agent', ['sales.orders.view'])
    const { service, loadAcl } = makeService({
      'api_key:key-1': { isSuperAdmin: false, features: ['sales.orders.view'] },
    })
    const result = await service.run('invoke.gated_agent', {}, {
      ...runCtx,
      invoker: { kind: 'api_key', apiKeyId: 'key-1', ownerUserId: 'user-1' },
    })
    expect(result.kind).toBe('research')
    expect(loadAcl).toHaveBeenCalledWith('api_key:key-1', scope)
  })

  it('throws AgentInvokeDeniedError before admission and before any run row', async () => {
    registerAgent('invoke.gated_agent', ['sales.orders.view'])
    const { service } = makeService({ 'user-1': { isSuperAdmin: false, features: ['customers.*'] } })
    await expect(service.run('invoke.gated_agent', {}, runCtx)).rejects.toBeInstanceOf(AgentInvokeDeniedError)
    expect(acquireAgentRunSlotMock).not.toHaveBeenCalled()
    expect(createRunMock).not.toHaveBeenCalled()
    expect(runAiAgentObjectMock).not.toHaveBeenCalled()
  })

  it('logs and allows the run when OM_AGENT_INVOKE_ENFORCEMENT=off', async () => {
    process.env.OM_AGENT_INVOKE_ENFORCEMENT = 'off'
    expect(isAgentInvokeEnforcementEnabled()).toBe(false)
    registerAgent('invoke.gated_agent', ['sales.orders.view'])
    const { service } = makeService({ 'user-1': { isSuperAdmin: false, features: [] } })
    const result = await service.run('invoke.gated_agent', {}, runCtx)
    expect(result.kind).toBe('research')
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'agent invoke denied but enforcement is off; allowing run',
      expect.objectContaining({ agentId: 'invoke.gated_agent' }),
    )
  })

  it('forwards callSettings to runAiAgentObject and binds the invoker on the run context', async () => {
    registerAgent('invoke.open_agent')
    let observedInvoker: AgentInvoker | undefined
    runAiAgentObjectMock.mockImplementation(async () => {
      observedInvoker = getCurrentRunInvoker()
      return VALID_MODEL_OUTPUT
    })
    const { service } = makeService({})
    const invoker: AgentInvoker = { kind: 'workflow', actingUserId: 'user-7' }
    await service.run('invoke.open_agent', {}, {
      ...runCtx,
      invoker,
      callSettings: { temperature: 0.2, seed: 7 },
    })
    expect(runAiAgentObjectMock.mock.calls[0][0]).toMatchObject({ callSettings: { temperature: 0.2, seed: 7 } })
    expect(observedInvoker).toEqual(invoker)
  })

  it('binds the userId-derived invoker on the run context when none is given', async () => {
    registerAgent('invoke.open_agent')
    let observedInvoker: AgentInvoker | undefined
    runAiAgentObjectMock.mockImplementation(async () => {
      observedInvoker = getCurrentRunInvoker()
      return VALID_MODEL_OUTPUT
    })
    const { service } = makeService({})
    await service.run('invoke.open_agent', {}, runCtx)
    expect(runAiAgentObjectMock.mock.calls[0][0]).not.toHaveProperty('callSettings')
    expect(observedInvoker).toEqual({ kind: 'user', userId: 'user-1' })
  })
})

describe('delegate_agent invoke inheritance', () => {
  const delegateTool = aiTools.find((tool) => tool.name === DELEGATE_TOOL_ID)

  it('checks the child run against the parent run invoker, not the tool caller', async () => {
    registerAgent('invoke.delegate_child', ['sales.orders.view'])
    const { service, loadAcl } = makeService({
      'user-1': { isSuperAdmin: false, features: ['sales.*'] },
      'api_key:key-parent': { isSuperAdmin: false, features: [] },
    })
    const container = {
      resolve: (name: string) => (name === 'agentRuntime' ? service : undefined),
    }
    const parentInvoker: AgentInvoker = { kind: 'api_key', apiKeyId: 'key-parent', ownerUserId: 'user-1' }
    const result = await withRunContext(
      'run-parent',
      () =>
        delegateTool!.handler(
          { agentId: 'invoke.delegate_child', input: {} },
          { ...runCtx, container, userFeatures: [], isSuperAdmin: false } as never,
        ),
      undefined,
      parentInvoker,
    )
    expect(result).toMatchObject({ ok: false, agentId: 'invoke.delegate_child' })
    expect(loadAcl).toHaveBeenCalledWith('api_key:key-parent', scope)
    expect(loadAcl).not.toHaveBeenCalledWith('user-1', scope)
    expect(createRunMock).not.toHaveBeenCalled()
  })

  it('passes the parent invoker and the delegate entry point to the nested run', async () => {
    registerAgent('invoke.delegate_child_open')
    let captured: Record<string, unknown> | undefined
    const agentRuntime = {
      run: async (_agentId: string, _input: unknown, opts: Record<string, unknown>) => {
        captured = opts
        return { kind: 'research' as const, data: { ok: true } }
      },
    }
    const container = {
      resolve: (name: string) => (name === 'agentRuntime' ? agentRuntime : undefined),
    }
    const parentInvoker: AgentInvoker = { kind: 'workflow', actingUserId: 'user-5' }
    await withRunContext(
      'run-parent',
      () =>
        delegateTool!.handler(
          { agentId: 'invoke.delegate_child_open', input: {} },
          { ...runCtx, container, userFeatures: [], isSuperAdmin: false } as never,
        ),
      undefined,
      parentInvoker,
    )
    expect(captured).toMatchObject({ invoker: parentInvoker, entryPoint: 'delegate', parentRunId: 'run-parent' })
  })
})
