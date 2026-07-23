import {
  classifyDiscordMessage,
  isAiAutoReplyEnabled,
  resolveAiAgentId,
  isAiAssistantAvailable,
} from '../ai-reply'

describe('classifyDiscordMessage', () => {
  it('classifies a short simple question as easy', () => {
    const result = classifyDiscordMessage('What are your opening hours?')
    expect(result.tier).toBe('easy')
  })

  it('classifies mutation/escalation keywords as complex', () => {
    expect(classifyDiscordMessage('I want a refund please').tier).toBe('complex')
    expect(classifyDiscordMessage('cancel my order').tier).toBe('complex')
    expect(classifyDiscordMessage('let me talk to a human').tier).toBe('complex')
  })

  it('classifies long / multi-question messages as complex', () => {
    expect(classifyDiscordMessage('a'.repeat(700)).tier).toBe('complex')
    expect(classifyDiscordMessage('why? how? when? really?').tier).toBe('complex')
  })

  it('classifies an empty body as complex with zero confidence', () => {
    const result = classifyDiscordMessage('   ')
    expect(result.tier).toBe('complex')
    expect(result.confidence).toBe(0)
  })
})

describe('isAiAutoReplyEnabled', () => {
  it('is OFF by default', () => {
    expect(isAiAutoReplyEnabled({})).toBe(false)
    expect(isAiAutoReplyEnabled(null)).toBe(false)
  })
  it('is ON when explicitly enabled on channel state', () => {
    expect(isAiAutoReplyEnabled({ aiAutoReplyEnabled: true })).toBe(true)
  })
})

describe('resolveAiAgentId', () => {
  it('returns the configured agent id', () => {
    expect(resolveAiAgentId({ aiAgentId: 'customers.support' })).toBe('customers.support')
  })
  it('returns undefined when unset', () => {
    expect(resolveAiAgentId({})).toBeUndefined()
  })
})

describe('isAiAssistantAvailable', () => {
  it('is true when mcpToolRegistry resolves', () => {
    expect(isAiAssistantAvailable({ resolve: () => ({}) })).toBe(true)
  })

  it('is false when the resolver throws (ai_assistant absent → no-op)', () => {
    expect(
      isAiAssistantAvailable({
        resolve: () => {
          throw new Error('not registered')
        },
      }),
    ).toBe(false)
  })

  it('is false when there is no resolver', () => {
    expect(isAiAssistantAvailable({} as never)).toBe(false)
  })
})
