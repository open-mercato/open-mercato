import { aiTools, LOAD_SKILL_TOOL_ID } from '../ai-tools'
import { InMemoryAgentRunSessionStore } from '../lib/runtime/agentRunSessionStore'
import { registerAgentSkills, clearAgentSkills } from '../lib/runtime/fileAgentSkills'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

// The load_skill MCP tool is the progressive-disclosure fallback. It resolves the
// active agent from the shared run-session store (ctx.sessionId — never trusted
// from the model), checks the requested skill is in that agent's allowed set, and
// returns the skill's instructions/template/examples. It must fail closed on no
// active run, and deny a skill not registered for the active agent.
describe('agent_orchestrator.load_skill', () => {
  const tool = aiTools.find((t) => t.name === LOAD_SKILL_TOOL_ID) as AiToolDefinition

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

  afterEach(() => clearAgentSkills())

  it('is registered with propose-only metadata and the run feature', () => {
    expect(tool).toBeDefined()
    expect(tool.isMutation).toBe(false)
    expect(tool.requiredFeatures).toEqual(['agent_orchestrator.agents.run'])
  })

  it('returns instructions/template/examples for an allowed skill', async () => {
    const store = new InMemoryAgentRunSessionStore()
    const key = 'sess_skill_ok'
    await store.open({ sessionToken: key, agentId: 'deals.health_check', tenantId: 't', organizationId: 'o' })
    registerAgentSkills('deals.health_check', [
      { id: 'stage_playbook', instructions: 'PLAYBOOK_BODY', template: 'TEMPLATE_BODY', examples: ['EX_ONE', 'EX_TWO'], tools: [] },
    ])
    const result = (await tool.handler!({ skillId: 'stage_playbook' }, makeCtx(store, key))) as {
      ok: boolean
      instructions?: string
      template?: string
      examples?: string[]
    }
    expect(result.ok).toBe(true)
    expect(result.instructions).toBe('PLAYBOOK_BODY')
    expect(result.template).toBe('TEMPLATE_BODY')
    expect(result.examples).toEqual(['EX_ONE', 'EX_TWO'])
  })

  it('denies a skill not in the active agent set', async () => {
    const store = new InMemoryAgentRunSessionStore()
    const key = 'sess_skill_deny'
    await store.open({ sessionToken: key, agentId: 'deals.health_check', tenantId: 't', organizationId: 'o' })
    registerAgentSkills('deals.health_check', [{ id: 'stage_playbook', instructions: 'x', examples: [], tools: [] }])
    const result = (await tool.handler!({ skillId: 'other_skill' }, makeCtx(store, key))) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('skill_not_allowed')
  })

  it('fails closed for an unknown/stale correlation key', async () => {
    const store = new InMemoryAgentRunSessionStore()
    const result = (await tool.handler!({ skillId: 'stage_playbook' }, makeCtx(store, 'sess_missing'))) as {
      ok: boolean
      code?: string
    }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('no_active_run')
  })

  it('fails closed when the context carries no session', async () => {
    const store = new InMemoryAgentRunSessionStore()
    const result = (await tool.handler!({ skillId: 'stage_playbook' }, makeCtx(store, undefined))) as {
      ok: boolean
      code?: string
    }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('no_active_run')
  })
})
