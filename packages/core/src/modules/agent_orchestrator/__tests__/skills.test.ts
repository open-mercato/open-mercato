import { z } from 'zod'
import { defineSkill, getSkillEntry, listSkillEntries } from '../lib/sdk/defineSkill'
import { defineAgent } from '../lib/sdk/defineAgent'

// Skills are a real capability pack, not a prompt marker: declaring a skill on an
// agent must (1) inject the skill's instructions into the system prompt and
// (2) union the skill's read-only tools into the agent's allowedTools.
describe('agent_orchestrator skills', () => {
  const schema = z.object({ kind: z.literal('informative'), data: z.unknown() })

  it('registers a skill and exposes it via the registry', () => {
    defineSkill({
      id: 'test.research_pack',
      moduleId: 'agent_orchestrator',
      label: 'Research pack',
      description: 'Adds research instructions and a read tool.',
      instructions: 'Always cross-check the record before proposing.',
      tools: ['customers.get_deal'],
    })
    const entry = getSkillEntry('test.research_pack')
    expect(entry).toBeDefined()
    expect(entry?.tools).toEqual(['customers.get_deal'])
    expect(listSkillEntries().some((skill) => skill.id === 'test.research_pack')).toBe(true)
  })

  it('rejects duplicate skill ids', () => {
    defineSkill({
      id: 'test.dupe_skill',
      moduleId: 'agent_orchestrator',
      label: 'Dupe',
      description: 'x',
      instructions: 'x',
    })
    expect(() =>
      defineSkill({
        id: 'test.dupe_skill',
        moduleId: 'agent_orchestrator',
        label: 'Dupe2',
        description: 'y',
        instructions: 'y',
      }),
    ).toThrow(/duplicate skill id/)
  })

  it('injects skill instructions and unions skill tools into the agent', () => {
    defineSkill({
      id: 'test.pipeline_pack',
      moduleId: 'agent_orchestrator',
      label: 'Pipeline pack',
      description: 'Pipeline expertise.',
      instructions: 'KNOW_THE_PIPELINE_STAGES',
      tools: ['customers.analyze_deals'],
    })
    const def = defineAgent({
      id: 'test.skilled_agent',
      moduleId: 'agent_orchestrator',
      label: 'Skilled agent',
      description: 'Agent that uses a skill.',
      instructions: 'BASE_INSTRUCTIONS',
      tools: ['customers.get_deal'],
      skills: ['test.pipeline_pack'],
      result: { kind: 'informative', schema },
    })
    // System prompt carries both the base instructions and the skill body.
    expect(def.systemPrompt).toContain('BASE_INSTRUCTIONS')
    expect(def.systemPrompt).toContain('KNOW_THE_PIPELINE_STAGES')
    // allowedTools is the union of the agent's own tool and the skill's tool.
    expect(def.allowedTools).toEqual(
      expect.arrayContaining(['customers.get_deal', 'customers.analyze_deals']),
    )
  })

  it('skips an unknown skill id without throwing', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const def = defineAgent({
      id: 'test.missing_skill_agent',
      moduleId: 'agent_orchestrator',
      label: 'Missing skill agent',
      description: 'References a skill that does not exist.',
      instructions: 'BASE',
      skills: ['test.does_not_exist'],
      result: { kind: 'informative', schema },
    })
    expect(def.allowedTools).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown skill "test.does_not_exist"'))
    warn.mockRestore()
  })
})
