import { z } from 'zod'
import { aiTools } from '../ai-tools'
import { DELEGATE_TOOL_ID, defineAgent } from '../lib/sdk/defineAgent'

// On the OpenCode path the delegate_agent tool runs in the separate
// `mcp:serve-http` process, where the in-process run-context AsyncLocalStorage is
// never set (`getCurrentRunId()` is undefined). The handler must then resolve the
// parent run id from the caller's run session via `agentRunSessionStore` so the
// nested sub-agent run still records `parent_run_id`.
describe('delegate_agent parentRunId fallback (OpenCode/MCP path)', () => {
  const schema = z.object({ kind: z.literal('researcher'), data: z.unknown() })

  it('resolves parentRunId from the caller session when the run context is absent', async () => {
    defineAgent({
      id: 'test.delegate_target',
      moduleId: 'agent_orchestrator',
      label: 'Target',
      description: 'Researcher sub-agent.',
      instructions: 'BASE',
      result: { kind: 'researcher', schema },
    })

    const delegateTool = aiTools.find((tool) => tool.name === DELEGATE_TOOL_ID)
    expect(delegateTool).toBeDefined()

    let capturedParentRunId: string | undefined
    const agentRuntime = {
      run: async (_agentId: string, _input: unknown, opts: { parentRunId?: string }) => {
        capturedParentRunId = opts.parentRunId
        return { kind: 'researcher' as const, data: { ok: true } }
      },
    }
    const agentRunSessionStore = {
      resolveActiveRunId: async (token: string) =>
        token === 'sess_test' ? 'run-from-session' : null,
    }
    const container = {
      resolve: (name: string) =>
        name === 'agentRuntime'
          ? agentRuntime
          : name === 'agentRunSessionStore'
            ? agentRunSessionStore
            : undefined,
    }
    const ctx = {
      tenantId: 't1',
      organizationId: 'o1',
      userId: 'u1',
      sessionId: 'sess_test',
      container,
      userFeatures: [],
      isSuperAdmin: false,
    }

    const result = await delegateTool!.handler(
      { agentId: 'test.delegate_target', input: { foo: 1 } },
      ctx as never,
    )
    expect(result).toMatchObject({ ok: true, agentId: 'test.delegate_target' })
    expect(capturedParentRunId).toBe('run-from-session')
  })

  it('omits parentRunId when the caller session resolves no active run', async () => {
    defineAgent({
      id: 'test.delegate_target_2',
      moduleId: 'agent_orchestrator',
      label: 'Target 2',
      description: 'Researcher sub-agent.',
      instructions: 'BASE',
      result: { kind: 'researcher', schema },
    })

    const delegateTool = aiTools.find((tool) => tool.name === DELEGATE_TOOL_ID)
    let sawParentRunIdKey = true
    const agentRuntime = {
      run: async (_agentId: string, _input: unknown, opts: Record<string, unknown>) => {
        sawParentRunIdKey = 'parentRunId' in opts
        return { kind: 'researcher' as const, data: { ok: true } }
      },
    }
    const agentRunSessionStore = {
      resolveActiveRunId: async () => null,
    }
    const container = {
      resolve: (name: string) =>
        name === 'agentRuntime'
          ? agentRuntime
          : name === 'agentRunSessionStore'
            ? agentRunSessionStore
            : undefined,
    }
    const ctx = {
      tenantId: 't1',
      organizationId: 'o1',
      userId: 'u1',
      sessionId: 'sess_no_run',
      container,
      userFeatures: [],
      isSuperAdmin: false,
    }

    await delegateTool!.handler(
      { agentId: 'test.delegate_target_2', input: {} },
      ctx as never,
    )
    expect(sawParentRunIdKey).toBe(false)
  })
})
