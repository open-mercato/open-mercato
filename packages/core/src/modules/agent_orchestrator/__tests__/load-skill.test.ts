import { z } from 'zod'
import { aiTools, LOAD_SKILL_TOOL_ID } from '../ai-tools'
import * as openCodeRunRegistry from '../lib/runtime/openCodeRunRegistry'
import { registerAgentSkills, clearAgentSkills } from '../lib/runtime/fileAgentSkills'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

// The load_skill MCP tool is the progressive-disclosure fallback. It resolves the
// active agent from the per-run correlation store (ctx.sessionId — never trusted
// from the model), checks the requested skill is in that agent's allowed set, and
// returns the skill's instructions/template/examples. It must fail closed on no
// active run, and deny a skill not registered for the active agent.
describe('agent_orchestrator.load_skill', () => {
  const tool = aiTools.find((t) => t.name === LOAD_SKILL_TOOL_ID) as AiToolDefinition
  const resultSchema = z.object({ kind: z.literal('informative'), data: z.unknown() })

  function makeCtx(sessionId?: string) {
    return { sessionId } as unknown as Parameters<NonNullable<typeof tool.handler>>[1]
  }

  afterEach(() => clearAgentSkills())

  it('is registered with propose-only metadata and the run feature', () => {
    expect(tool).toBeDefined()
    expect(tool.isMutation).toBe(false)
    expect(tool.requiredFeatures).toEqual(['agent_orchestrator.agents.run'])
  })

  it('returns instructions/template/examples for an allowed skill', async () => {
    const key = 'sess_skill_ok'
    openCodeRunRegistry.register(key, { agentId: 'deals.health_check', resultSchema })
    registerAgentSkills('deals.health_check', [
      {
        id: 'stage_playbook',
        instructions: 'PLAYBOOK_BODY',
        template: 'TEMPLATE_BODY',
        examples: ['EX_ONE', 'EX_TWO'],
        tools: [],
      },
    ])
    try {
      const result = (await tool.handler!({ skillId: 'stage_playbook' }, makeCtx(key))) as {
        ok: boolean
        instructions?: string
        template?: string
        examples?: string[]
      }
      expect(result.ok).toBe(true)
      expect(result.instructions).toBe('PLAYBOOK_BODY')
      expect(result.template).toBe('TEMPLATE_BODY')
      expect(result.examples).toEqual(['EX_ONE', 'EX_TWO'])
    } finally {
      openCodeRunRegistry.dispose(key)
    }
  })

  it('denies a skill not in the active agent set', async () => {
    const key = 'sess_skill_deny'
    openCodeRunRegistry.register(key, { agentId: 'deals.health_check', resultSchema })
    registerAgentSkills('deals.health_check', [
      { id: 'stage_playbook', instructions: 'x', examples: [], tools: [] },
    ])
    try {
      const result = (await tool.handler!({ skillId: 'other_skill' }, makeCtx(key))) as {
        ok: boolean
        code?: string
      }
      expect(result.ok).toBe(false)
      expect(result.code).toBe('skill_not_allowed')
    } finally {
      openCodeRunRegistry.dispose(key)
    }
  })

  it('fails closed for an unknown/stale correlation key', async () => {
    const result = (await tool.handler!(
      { skillId: 'stage_playbook' },
      makeCtx('sess_missing'),
    )) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('no_active_run')
  })

  it('fails closed when the context carries no session', async () => {
    const result = (await tool.handler!({ skillId: 'stage_playbook' }, makeCtx(undefined))) as {
      ok: boolean
      code?: string
    }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('no_active_run')
  })
})
