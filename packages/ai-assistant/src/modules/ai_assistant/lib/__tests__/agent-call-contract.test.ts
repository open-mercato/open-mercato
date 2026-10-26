import {
  aiAgentCallSettingsSchema,
  mergeCallSettings,
  type AiAgentCallSettings,
} from '../agent-call-contract'

describe('mergeCallSettings', () => {
  it('returns an empty object when both inputs are absent', () => {
    expect(mergeCallSettings(undefined, undefined)).toEqual({})
  })

  it('lets call settings win key by key over model settings', () => {
    const modelSettings: AiAgentCallSettings = { temperature: 0.2, topP: 0.9, maxOutputTokens: 512 }
    const callSettings: AiAgentCallSettings = { temperature: 0.7, seed: 42 }
    expect(mergeCallSettings(modelSettings, callSettings)).toEqual({
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 512,
      seed: 42,
    })
  })

  it('drops undefined keys and keeps the lower-priority value for them', () => {
    const merged = mergeCallSettings(
      { temperature: 0.3, topK: undefined },
      { temperature: undefined, frequencyPenalty: 0.5 },
    )
    expect(merged).toEqual({ temperature: 0.3, frequencyPenalty: 0.5 })
    expect(Object.keys(merged)).not.toContain('topK')
  })

  it('returns a new object without mutating inputs', () => {
    const modelSettings: AiAgentCallSettings = { temperature: 0.1 }
    const callSettings: AiAgentCallSettings = { topP: 0.5 }
    const merged = mergeCallSettings(modelSettings, callSettings)
    expect(merged).not.toBe(modelSettings)
    expect(merged).not.toBe(callSettings)
    expect(mergeCallSettings(modelSettings, undefined)).not.toBe(modelSettings)
    expect(modelSettings).toEqual({ temperature: 0.1 })
    expect(callSettings).toEqual({ topP: 0.5 })
  })

  it('replaces providerOptions as a whole value', () => {
    const merged = mergeCallSettings(
      { providerOptions: { openai: { reasoningEffort: 'low' } } },
      { providerOptions: { anthropic: { thinking: { type: 'enabled' } } } },
    )
    expect(merged.providerOptions).toEqual({ anthropic: { thinking: { type: 'enabled' } } })
  })
})

describe('aiAgentCallSettingsSchema', () => {
  it('accepts a full valid settings object', () => {
    const settings = {
      temperature: 0.4,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 1024,
      seed: 7,
      stopSequences: ['END'],
      presencePenalty: 0.1,
      frequencyPenalty: -0.1,
      providerOptions: { openai: { user: 'abc' } },
    }
    expect(aiAgentCallSettingsSchema.parse(settings)).toEqual(settings)
  })

  it('accepts an empty object', () => {
    expect(aiAgentCallSettingsSchema.safeParse({}).success).toBe(true)
  })

  it('rejects unknown keys', () => {
    expect(aiAgentCallSettingsSchema.safeParse({ temperature: 0.2, maxTokens: 100 }).success).toBe(false)
  })

  it.each([
    [{ temperature: -1 }],
    [{ topP: 1.5 }],
    [{ topK: 0 }],
    [{ topK: 2.5 }],
    [{ maxOutputTokens: 0 }],
    [{ seed: 1.5 }],
    [{ temperature: 'hot' }],
    [{ stopSequences: [''] }],
    [{ providerOptions: 'openai' }],
  ])('rejects invalid value %j', (value) => {
    expect(aiAgentCallSettingsSchema.safeParse(value).success).toBe(false)
  })
})
