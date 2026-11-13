import { InMemoryAgentRunSessionStore } from '../lib/runtime/agentRunSessionStore'
import { registerAgentSkills, clearAgentSkills } from '../lib/runtime/fileAgentSkills'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

// Mock the sandbox so the tool-handler ROUTING is tested deterministically
// without spinning an isolated-vm isolate (the real sandbox is exercised in
// sandboxed-script.test.ts). The mock echoes back what it was asked to run.
jest.mock('../lib/runtime/sandboxedScript', () => ({
  SKILL_SCRIPT_TIMEOUT_MS: 30_000,
  runSandboxedScript: jest.fn(async (input: { source: string; args: unknown }) => ({
    ok: true as const,
    result: { ranSource: input.source, args: input.args },
  })),
}))

// The run_skill_script MCP tool resolves the active agent + its allowed skill/
// script set server-side from the per-run correlation store (ctx.sessionId) —
// never trusted from the model — then runs the script in the sandbox. It must
// fail closed on no active run, a skill the agent does not have, and an unknown
// script; and only reach the sandbox for an allowed (skillId, scriptName) pair.
describe('agent_orchestrator.run_skill_script', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { aiTools, RUN_SKILL_SCRIPT_TOOL_ID } = require('../ai-tools')
  const tool = (aiTools as AiToolDefinition[]).find(
    (t) => t.name === RUN_SKILL_SCRIPT_TOOL_ID,
  ) as AiToolDefinition

  function makeCtx(store: InMemoryAgentRunSessionStore, sessionId?: string) {
    return {
      sessionId,
      container: {
        resolve: (name: string) => {
          if (name === 'agentRunSessionStore') return store
          throw new Error(`unexpected resolve("${name}")`)
        },
      },
    } as unknown as Parameters<NonNullable<typeof tool.handler>>[1]
  }

  const agentId = 'demo.script_agent'

  beforeEach(() => {
    clearAgentSkills()
    registerAgentSkills(agentId, [
      {
        id: 'playbook',
        instructions: '',
        examples: [],
        tools: [],
        scripts: [{ name: 'score', source: 'function run(a){ return a }' }],
      },
    ])
  })

  afterEach(() => clearAgentSkills())

  it('is registered with propose-only metadata and the run feature', () => {
    expect(tool).toBeDefined()
    expect(tool.isMutation).toBe(false)
    expect(tool.requiredFeatures).toEqual(['agent_orchestrator.agents.run'])
  })

  it('runs an allowed script and returns its sandbox result', async () => {
    const store = new InMemoryAgentRunSessionStore()
    const key = 'sess_script_ok'
    await store.open({ sessionToken: key, agentId, tenantId: 't', organizationId: 'o' })
    const result = (await tool.handler!(
      { skillId: 'playbook', scriptName: 'score', args: { momentum: 1 } },
      makeCtx(store, key),
    )) as { ok: boolean; result?: { args?: unknown } }
    expect(result.ok).toBe(true)
    expect(result.result?.args).toEqual({ momentum: 1 })
  })

  it('fails closed when the context carries no active run', async () => {
    const store = new InMemoryAgentRunSessionStore()
    const result = (await tool.handler!(
      { skillId: 'playbook', scriptName: 'score' },
      makeCtx(store, undefined),
    )) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('no_active_run')
  })

  it('rejects a skill the active agent does not have', async () => {
    const store = new InMemoryAgentRunSessionStore()
    const key = 'sess_script_denyskill'
    await store.open({ sessionToken: key, agentId, tenantId: 't', organizationId: 'o' })
    const result = (await tool.handler!(
      { skillId: 'not_mine', scriptName: 'score' },
      makeCtx(store, key),
    )) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('skill_not_allowed')
  })

  it('rejects an unknown script within an allowed skill', async () => {
    const store = new InMemoryAgentRunSessionStore()
    const key = 'sess_script_unknown'
    await store.open({ sessionToken: key, agentId, tenantId: 't', organizationId: 'o' })
    const result = (await tool.handler!(
      { skillId: 'playbook', scriptName: 'missing' },
      makeCtx(store, key),
    )) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('script_not_found')
  })
})
