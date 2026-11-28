import { z } from 'zod'
import { aiTools, DELEGATE_NO_ACTIVE_RUN_CODE, DELEGATE_SUB_AGENT_NOT_ALLOWED_CODE } from '../ai-tools'
import { DELEGATE_TOOL_ID, defineAgent } from '../lib/sdk/defineAgent'
import { withRunContext } from '../lib/runtime/runContext'

const schema = z.object({ kind: z.literal('research'), data: z.unknown() })

const PARENT_ID = 'scope.parent'
const DECLARED_ID = 'scope.declared_child'
const UNDECLARED_ID = 'scope.undeclared_researcher'
const SESSION_TOKEN = 'sess_scope_parent'

const delegateTool = aiTools.find((tool) => tool.name === DELEGATE_TOOL_ID)

function defineResearcher(id: string, subAgents?: string[]) {
  defineAgent({
    id,
    moduleId: 'agent_orchestrator',
    label: id,
    description: 'Researcher agent for delegate scope tests.',
    instructions: 'BASE',
    result: { kind: 'research', schema },
    ...(subAgents ? { subAgents } : {}),
  })
}

function makeCtx(options: { sessionAgentId?: string | null; storeThrows?: boolean; sessionId?: string } = {}) {
  const run = jest.fn(async () => ({ kind: 'research' as const, data: { ok: true } }))
  const agentRunSessionStore = {
    resolveActiveRunId: async () => null,
    resolveActiveAgentId: async (token: string) => {
      if (options.storeThrows) throw new Error('store unavailable')
      return token === SESSION_TOKEN ? (options.sessionAgentId ?? null) : null
    },
  }
  const container = {
    resolve: (name: string) =>
      name === 'agentRuntime' ? { run } : name === 'agentRunSessionStore' ? agentRunSessionStore : undefined,
  }
  const ctx = {
    tenantId: 't1',
    organizationId: 'o1',
    userId: 'u1',
    container,
    userFeatures: [],
    isSuperAdmin: false,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
  }
  return { ctx, run }
}

function delegateAsNativeParent(parentId: string, agentId: string, ctx: unknown) {
  return withRunContext(
    'run-scope-parent',
    () => delegateTool!.handler({ agentId, input: {} }, ctx as never),
    undefined,
    undefined,
    undefined,
    parentId,
  )
}

beforeAll(() => {
  defineResearcher(DECLARED_ID)
  defineResearcher(UNDECLARED_ID)
  defineResearcher(PARENT_ID, [DECLARED_ID])
})

describe('delegate_agent is scoped to the calling agent declared subAgents', () => {
  it('runs a declared sub-agent of the native parent', async () => {
    const { ctx, run } = makeCtx()
    const result = await delegateAsNativeParent(PARENT_ID, DECLARED_ID, ctx)
    expect(result).toMatchObject({ ok: true, agentId: DECLARED_ID })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('refuses a registered researcher the native parent did not declare', async () => {
    const { ctx, run } = makeCtx()
    const result = await delegateAsNativeParent(PARENT_ID, UNDECLARED_ID, ctx)
    expect(result).toEqual({ ok: false, agentId: UNDECLARED_ID, error: DELEGATE_SUB_AGENT_NOT_ALLOWED_CODE })
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses an unknown target with the same code, without revealing whether it exists', async () => {
    const { ctx, run } = makeCtx()
    const result = await delegateAsNativeParent(PARENT_ID, 'scope.does_not_exist', ctx)
    expect(result).toEqual({ ok: false, agentId: 'scope.does_not_exist', error: DELEGATE_SUB_AGENT_NOT_ALLOWED_CODE })
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses when the resolved parent is not a registered agent', async () => {
    const { ctx, run } = makeCtx()
    const result = await delegateAsNativeParent('scope.unregistered_parent', DECLARED_ID, ctx)
    expect(result).toEqual({ ok: false, agentId: DECLARED_ID, error: DELEGATE_SUB_AGENT_NOT_ALLOWED_CODE })
    expect(run).not.toHaveBeenCalled()
  })

  it('a delegating sub-agent context cannot reach its own parent sub-agents', async () => {
    const { ctx, run } = makeCtx()
    const result = await delegateAsNativeParent(DECLARED_ID, UNDECLARED_ID, ctx)
    expect(result).toEqual({ ok: false, agentId: UNDECLARED_ID, error: DELEGATE_SUB_AGENT_NOT_ALLOWED_CODE })
    expect(run).not.toHaveBeenCalled()
  })

  it('resolves the OpenCode parent from the run session and runs a declared sub-agent', async () => {
    const { ctx, run } = makeCtx({ sessionAgentId: PARENT_ID, sessionId: SESSION_TOKEN })
    const result = await delegateTool!.handler({ agentId: DECLARED_ID, input: {} }, ctx as never)
    expect(result).toMatchObject({ ok: true, agentId: DECLARED_ID })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('refuses an undeclared target for the OpenCode parent resolved from the run session', async () => {
    const { ctx, run } = makeCtx({ sessionAgentId: PARENT_ID, sessionId: SESSION_TOKEN })
    const result = await delegateTool!.handler({ agentId: UNDECLARED_ID, input: {} }, ctx as never)
    expect(result).toEqual({ ok: false, agentId: UNDECLARED_ID, error: DELEGATE_SUB_AGENT_NOT_ALLOWED_CODE })
    expect(run).not.toHaveBeenCalled()
  })

  it('fails closed with no_active_run outside any run and without a session', async () => {
    const { ctx, run } = makeCtx()
    const result = await delegateTool!.handler({ agentId: DECLARED_ID, input: {} }, ctx as never)
    expect(result).toEqual({ ok: false, agentId: DECLARED_ID, error: DELEGATE_NO_ACTIVE_RUN_CODE })
    expect(run).not.toHaveBeenCalled()
  })

  it('fails closed with no_active_run when the session resolves no active agent', async () => {
    const { ctx, run } = makeCtx({ sessionAgentId: null, sessionId: SESSION_TOKEN })
    const result = await delegateTool!.handler({ agentId: DECLARED_ID, input: {} }, ctx as never)
    expect(result).toEqual({ ok: false, agentId: DECLARED_ID, error: DELEGATE_NO_ACTIVE_RUN_CODE })
    expect(run).not.toHaveBeenCalled()
  })

  it('fails closed with no_active_run when the run session store is unavailable', async () => {
    const { ctx, run } = makeCtx({ storeThrows: true, sessionId: SESSION_TOKEN })
    const result = await delegateTool!.handler({ agentId: DECLARED_ID, input: {} }, ctx as never)
    expect(result).toEqual({ ok: false, agentId: DECLARED_ID, error: DELEGATE_NO_ACTIVE_RUN_CODE })
    expect(run).not.toHaveBeenCalled()
  })
})
