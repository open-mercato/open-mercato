import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { runtimeDisplayLabel, runtimeLabelKey } from '../components/runtimeLabel'

const messages: Record<string, string> = {
  'agent_orchestrator.agents.list.runtime.business-harness': 'Business Harness',
  'agent_orchestrator.agents.list.runtime.business-harness-standalone': 'Business Harness (standalone)',
}

const t: TranslateFn = (key, fallbackOrParams) =>
  messages[key] ?? (typeof fallbackOrParams === 'string' ? fallbackOrParams : key)

describe('runtime labels', () => {
  it('uses the regular label for the default one-off process', () => {
    expect(runtimeLabelKey('business-harness', 'one-off')).toBe(
      'agent_orchestrator.agents.list.runtime.business-harness',
    )
    expect(runtimeDisplayLabel(t, 'business-harness', 'one-off')).toBe('Business Harness')
  })

  it('marks the served HTTP deployment as standalone', () => {
    expect(runtimeLabelKey('business-harness', 'standalone')).toBe(
      'agent_orchestrator.agents.list.runtime.business-harness-standalone',
    )
    expect(runtimeDisplayLabel(t, 'business-harness', 'standalone')).toBe(
      'Business Harness (standalone)',
    )
  })
})
