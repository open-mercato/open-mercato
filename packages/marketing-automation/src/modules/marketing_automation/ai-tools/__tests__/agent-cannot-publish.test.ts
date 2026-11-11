import { aiAgents } from '../../ai-agents'
import { aiTools } from '../../ai-tools'

/**
 * The agent's authority, asserted rather than trusted.
 *
 * The module's standing rule is that AI may author and only a human may publish. That rule lives in three
 * places — no enable tool exists, the agent's tool list is written out by hand, and every write is
 * confirm-required — and a test for each is the only thing that keeps all three true after somebody adds a tool.
 */
describe('the campaign author agent', () => {
  const agent = aiAgents[0]

  test('there is exactly one agent, and it is the author', () => {
    expect(aiAgents).toHaveLength(1)
    expect(agent.id).toBe('marketing_automation.campaign_author')
  })

  test('every tool it may call actually exists', () => {
    const available = new Set((aiTools as Array<{ name: string }>).map((tool) => tool.name))
    const missing = (agent.allowedTools ?? []).filter((name) => !available.has(name))
    // A tool name that does not exist is a capability the agent silently lacks, and the prompt tells it to use.
    expect(missing).toEqual([])
  })

  test('its tool list is written out rather than derived from the pack', () => {
    /**
     * This is the guard against a future tool arriving in the agent's hands for free. If somebody adds an
     * enable tool to the module, this test fails rather than the agent quietly gaining the power to publish.
     */
    const packNames = (aiTools as Array<{ name: string }>).map((tool) => tool.name).sort()
    expect([...(agent.allowedTools ?? [])].sort()).toEqual(packNames)
  })

  test('nothing it may call suggests publishing, enabling or sending', () => {
    const forbidden = /(enable|publish|disable|send|dispatch|delete)/i
    const offenders = (agent.allowedTools ?? []).filter((name) => forbidden.test(name))
    expect(offenders).toEqual([])
  })

  test('every write it makes is confirmed by a person', () => {
    expect(agent.mutationPolicy).toBe('confirm-required')
  })

  test('its prompt states plainly that it cannot publish', () => {
    // The prompt is the only place the agent itself learns this; the tool list is what enforces it.
    expect(agent.systemPrompt).toMatch(/cannot enable/i)
    expect(agent.systemPrompt).toMatch(/human decision/i)
  })

  test('it is bounded, so a confused agent stops instead of looping', () => {
    expect(agent.loop?.maxSteps).toBeGreaterThan(0)
    expect(agent.loop?.budget?.maxToolCalls).toBeGreaterThan(0)
    expect(agent.loop?.budget?.maxWallClockMs).toBeGreaterThan(0)
  })

  test('it requires the same grant as reading campaigns', () => {
    expect(agent.requiredFeatures).toEqual(['marketing_automation.campaigns.view'])
  })
})
