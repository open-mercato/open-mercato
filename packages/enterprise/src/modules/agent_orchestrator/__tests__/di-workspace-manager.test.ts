import { asValue, createContainer } from 'awilix'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getProcessDiRegistrar } from '@open-mercato/shared/lib/di/process-registrar'
import type { AgentWorkspaceManager } from '../lib/runtime/agentWorkspaceManager'
import { register } from '../di'

jest.mock('../lib/runtime/aiAgentRunDispatcher', () => ({ createAiAgentRunDispatcher: (container: unknown) => ({ container }) }))
jest.mock('../lib/runtime/mcpToolObservationBinder', () => ({ createMcpToolObservationBinder: (container: unknown) => ({ container }) }))
jest.mock('../lib/access/agentInvokeAccess', () => ({ warnIfAgentInvokeEnforcementDisabled: jest.fn() }))
jest.mock('../lib/guardrails/integrity/integritySets', () => ({ warnIfAgentIntegrityShadowMode: jest.fn() }))
jest.mock('../lib/trace/otel/exportIntegration', () => ({ OTEL_EXPORT_HEALTH_CHECK_SERVICE: 'otelHealth', createOtelExportHealthCheck: () => ({}) }))
jest.mock('../lib/trace/otel/exportDestination', () => ({ createOtelExportHealthDestinationResolver: () => ({}) }))

jest.mock('../data/entities', () => ({}))
jest.mock('../lib/identity/agentPrincipalService', () => ({}))
jest.mock('../lib/identity/agentDelegationGrantService', () => ({}))
jest.mock('../lib/identity/agentTokenService', () => ({}))
jest.mock('../lib/identity/agentAuthMdService', () => ({}))
jest.mock('../lib/runtime/agentRuntime', () => ({}))
jest.mock('../lib/guardrails/guardrailService', () => ({}))
jest.mock('../lib/runtime/agentRunSessionStore', () => ({}))
jest.mock('../lib/disposition/dispositionService', () => ({}))
jest.mock('../lib/runtime/invokeAgentForWorkflow', () => ({}))
jest.mock('../lib/context/contextResolver', () => ({}))
jest.mock('../lib/context/documentIngest', () => ({}))
jest.mock('../lib/context/documentOcrProvider', () => ({}))
jest.mock('../lib/webSearch/registry', () => ({}))
jest.mock('../lib/workInbox/agentDispositionSource', () => ({}))
jest.mock('@open-mercato/core/modules/workflows/lib/work-inbox/provider', () => ({ registerWorkInboxSources: jest.fn() }))

const managerKey = Symbol.for('@open-mercato/agent-orchestrator/workspace-manager')
const globals = globalThis as typeof globalThis & { [managerKey]?: AgentWorkspaceManager }

describe('agent workspace process ownership', () => {
  let workspace: string
  const originalRoot = process.env.OM_OPENCODE_WORKSPACE_ROOT
  const originalPoolSize = process.env.OM_OPENCODE_POOL_SIZE

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'om-workspace-manager-'))
    process.env.OM_OPENCODE_WORKSPACE_ROOT = workspace
    process.env.OM_OPENCODE_POOL_SIZE = '1'
    delete globals[managerKey]
  })

  afterEach(async () => {
    delete globals[managerKey]
    if (originalRoot === undefined) delete process.env.OM_OPENCODE_WORKSPACE_ROOT
    else process.env.OM_OPENCODE_WORKSPACE_ROOT = originalRoot
    if (originalPoolSize === undefined) delete process.env.OM_OPENCODE_POOL_SIZE
    else process.env.OM_OPENCODE_POOL_SIZE = originalPoolSize
    await rm(workspace, { recursive: true, force: true })
  })

  it('keeps a lease in an older generation within the process capacity limit', async () => {
    const previousRoot = createContainer()
    const nextRoot = createContainer()
    const processRegister = getProcessDiRegistrar(register)!
    processRegister(previousRoot)
    const previousCaller = previousRoot.createScope()
    const previousManager = previousCaller.resolve<AgentWorkspaceManager>('agentWorkspaceManager')
    const firstLease = await previousManager.acquire('previous-generation')
    let pendingLease: ReturnType<AgentWorkspaceManager['acquire']> | undefined
    try {
      processRegister(nextRoot)
      const nextManager = nextRoot.createScope().resolve<AgentWorkspaceManager>('agentWorkspaceManager')
      expect(nextManager).toBe(previousManager)
      let acquired = false
      pendingLease = nextManager.acquire('next-generation').then((lease) => {
        acquired = true
        return lease
      })
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(acquired).toBe(false)
      await firstLease.release()
      await pendingLease
      expect(acquired).toBe(true)
    } finally {
      await firstLease.release()
      await (await pendingLease)?.release()
      await previousRoot.dispose()
      await nextRoot.dispose()
    }
  })

  it('preserves independent legacy container registrations', () => {
    const first = createContainer()
    const second = createContainer()
    register(first)
    register(second)
    expect(first.resolve('agentWorkspaceManager')).not.toBe(second.resolve('agentWorkspaceManager'))
    expect(globals[managerKey]).toBeUndefined()
  })
})


it('binds merged dispatcher and MCP observer services to their resolving callers', async () => {
  const { AI_AGENT_RUN_DISPATCHER_DI_KEY } = await import('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-run-dispatcher')
  const { MCP_TOOL_EXECUTION_OBSERVER_DI_KEY } = await import('@open-mercato/ai-assistant/modules/ai_assistant/lib/mcp-tool-execution-observer')
  const root = createContainer()
  getProcessDiRegistrar(register)!(root)
  const first = root.createScope().register({ auth: asValue('first') })
  const second = root.createScope().register({ auth: asValue('second') })
  for (const key of [AI_AGENT_RUN_DISPATCHER_DI_KEY, MCP_TOOL_EXECUTION_OBSERVER_DI_KEY]) {
    expect(first.resolve<{ container: unknown }>(key).container).toBe(first)
    expect(second.resolve<{ container: unknown }>(key).container).toBe(second)
    expect(first.resolve(key)).not.toBe(second.resolve(key))
  }
  await Promise.all([first.dispose(), second.dispose(), root.dispose()])
})
