import { z } from 'zod'
import { defineAgent, getAgentEntry, DELEGATE_TOOL_ID } from '../lib/sdk/defineAgent'

// The sub-agent-as-tool pattern: declaring `subAgents` on an agent must add the
// read-only delegation tool to its allowlist, record the sub-agent ids, and
// inject a "Sub-agents" prompt section that nudges parallel fan-out.
describe('agent_orchestrator sub-agents', () => {
  const schema = z.object({ kind: z.literal('informative'), data: z.unknown() })

  it('adds the delegate tool, records subAgents, and injects the prompt section', () => {
    const def = defineAgent({
      id: 'test.manager_agent',
      moduleId: 'agent_orchestrator',
      label: 'Manager',
      description: 'Delegates to workers.',
      instructions: 'BASE',
      subAgents: ['test.worker_a', 'test.worker_b'],
      result: { kind: 'informative', schema },
    })
    expect(def.allowedTools).toContain(DELEGATE_TOOL_ID)
    expect(def.systemPrompt).toContain('## Sub-agents')
    expect(def.systemPrompt).toContain('test.worker_a')
    expect(def.systemPrompt).toContain('in the SAME step') // parallel fan-out hint
    const entry = getAgentEntry('test.manager_agent')
    expect(entry?.subAgents).toEqual(['test.worker_a', 'test.worker_b'])
  })

  it('does not add the delegate tool when no subAgents are declared', () => {
    const def = defineAgent({
      id: 'test.solo_agent',
      moduleId: 'agent_orchestrator',
      label: 'Solo',
      description: 'No delegation.',
      instructions: 'BASE',
      result: { kind: 'informative', schema },
    })
    expect(def.allowedTools).not.toContain(DELEGATE_TOOL_ID)
    expect(getAgentEntry('test.solo_agent')?.subAgents).toEqual([])
  })
})
