import { z } from 'zod'
import { aiAgentHttpCallSettingsSchema } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-call-contract'
import { invokeAgentCallSettingsSchema, invokeAgentConfigSchema } from '../../data/activity-config-schemas'

describe('INVOKE_AGENT callSettings schema', () => {
  it('mirrors the ai-assistant HTTP call-settings contract exactly', () => {
    expect(z.toJSONSchema(invokeAgentCallSettingsSchema)).toEqual(z.toJSONSchema(aiAgentHttpCallSettingsSchema))
  })

  it('keeps an INVOKE_AGENT config without callSettings valid', () => {
    expect(invokeAgentConfigSchema.safeParse({ agentId: 'a', onResult: { alwaysAsk: true } }).success).toBe(true)
  })

  it('rejects an interpolated string where a number is expected', () => {
    const parsed = invokeAgentConfigSchema.safeParse({
      agentId: 'a',
      onResult: { alwaysAsk: true },
      callSettings: { temperature: '{{context.temperature}}' },
    })
    expect(parsed.success).toBe(false)
  })
})
