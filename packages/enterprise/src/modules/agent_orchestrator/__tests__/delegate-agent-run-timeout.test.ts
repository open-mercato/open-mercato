import { z } from 'zod'
import { aiTools } from '../ai-tools'
import { DELEGATE_TOOL_ID, defineAgent } from '../lib/sdk/defineAgent'

// A hung sub-agent tool (e.g. a wedged web_search browser navigation) must not
// pin the orchestrator for the full top-level deadline: delegate_agent bounds the
// nested run with a short wall-clock budget so it fails fast and returns an error
// to the parent instead of blocking it.
describe('delegate_agent delegated-run wall-clock budget', () => {
  const schema = z.object({ kind: z.literal('researcher'), data: z.unknown() })

  it('passes a short runTimeoutMs (default 3m, env-overridable) to the delegated run', async () => {
    defineAgent({
      id: 'test.delegate_timeout_target',
      moduleId: 'agent_orchestrator',
      label: 'Timeout target',
      description: 'Researcher sub-agent.',
      instructions: 'BASE',
      result: { kind: 'researcher', schema },
    })

    const delegateTool = aiTools.find((tool) => tool.name === DELEGATE_TOOL_ID)
    expect(delegateTool).toBeDefined()

    let capturedRunTimeoutMs: unknown
    const agentRuntime = {
      run: async (_agentId: string, _input: unknown, opts: { runTimeoutMs?: number }) => {
        capturedRunTimeoutMs = opts.runTimeoutMs
        return { kind: 'researcher' as const, data: { ok: true } }
      },
    }
    const container = {
      resolve: (name: string) => (name === 'agentRuntime' ? agentRuntime : undefined),
    }
    const ctx = {
      tenantId: 't1',
      organizationId: 'o1',
      userId: 'u1',
      container,
      userFeatures: [],
      isSuperAdmin: false,
    }

    const prev = process.env.OM_AGENT_DELEGATE_RUN_TIMEOUT_MS
    try {
      delete process.env.OM_AGENT_DELEGATE_RUN_TIMEOUT_MS
      const result = await delegateTool!.handler(
        { agentId: 'test.delegate_timeout_target', input: { foo: 1 } },
        ctx as never,
      )
      expect(result).toMatchObject({ ok: true, agentId: 'test.delegate_timeout_target' })
      expect(capturedRunTimeoutMs).toBe(3 * 60_000)

      process.env.OM_AGENT_DELEGATE_RUN_TIMEOUT_MS = '45000'
      await delegateTool!.handler(
        { agentId: 'test.delegate_timeout_target', input: { foo: 1 } },
        ctx as never,
      )
      expect(capturedRunTimeoutMs).toBe(45000)

      // A non-positive / non-numeric override is ignored → back to the default.
      process.env.OM_AGENT_DELEGATE_RUN_TIMEOUT_MS = 'not-a-number'
      await delegateTool!.handler(
        { agentId: 'test.delegate_timeout_target', input: { foo: 1 } },
        ctx as never,
      )
      expect(capturedRunTimeoutMs).toBe(3 * 60_000)
    } finally {
      if (prev === undefined) delete process.env.OM_AGENT_DELEGATE_RUN_TIMEOUT_MS
      else process.env.OM_AGENT_DELEGATE_RUN_TIMEOUT_MS = prev
    }
  })
})
