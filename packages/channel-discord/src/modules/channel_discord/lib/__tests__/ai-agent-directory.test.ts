import { missingAgentFeatures } from '../ai-agent-directory'

/**
 * The authorization half of "can auto-reply invoke this agent" (issue #4778).
 *
 * `listDiscordEligibleAgents` only answers the shape question — object-mode, so
 * `runAiAgentObject` will take the call. The runtime then runs the agent's
 * `requiredFeatures` against the auto-reply principal, and an agent that clears
 * the first check but fails the second is exactly the setting that arms a channel
 * which then answers nothing, forever, inside a background subscriber.
 *
 * These cases pin the comparison against the platform's real `authorizeFeatures`
 * rather than a stub, because the wildcard rows are the ones a hand-rolled
 * `Set.has` would get wrong — and getting them wrong means refusing a channel-bot
 * user whose role legitimately covers the agent.
 */
describe('missingAgentFeatures', () => {
  const principal = (features: string[], isSuperAdmin = false) => ({ features, isSuperAdmin })

  it('treats an agent that requires nothing as invocable by anyone', () => {
    expect(missingAgentFeatures([], principal([]))).toEqual([])
    expect(missingAgentFeatures(undefined, principal([]))).toEqual([])
  })

  it('accepts an exact grant', () => {
    expect(missingAgentFeatures(['customers.view'], principal(['customers.view']))).toEqual([])
  })

  it('names every required feature the principal does not hold', () => {
    const missing = missingAgentFeatures(
      ['customers.view', 'customers.manage', 'sales.view'],
      principal(['customers.view']),
    )
    expect(missing).toEqual(['customers.manage', 'sales.view'])
  })

  it('honours a module wildcard grant the way the runtime does', () => {
    expect(missingAgentFeatures(['customers.view'], principal(['customers.*']))).toEqual([])
  })

  it('honours a global wildcard grant', () => {
    expect(missingAgentFeatures(['customers.view', 'sales.view'], principal(['*']))).toEqual([])
  })

  it('does not let a sibling-module grant stand in for the required one', () => {
    expect(missingAgentFeatures(['customers.view'], principal(['sales.*']))).toEqual(['customers.view'])
  })

  it('reports the provider agent as invocable under the service principal alone', () => {
    // The provider's own agent is what has to work with no operator setup at all.
    const missing = missingAgentFeatures(
      ['channel_discord.ai_auto_reply.run'],
      principal(['channel_discord.ai_auto_reply.run']),
    )
    expect(missing).toEqual([])
  })

  it('is not satisfied by an empty principal, which is what a features:[] regression looks like', () => {
    expect(missingAgentFeatures(['customers.view'], principal([]))).toEqual(['customers.view'])
  })
})
