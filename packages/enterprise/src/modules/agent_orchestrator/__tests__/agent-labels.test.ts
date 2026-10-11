import { agentLabelFor } from '../components/useAgentLabels'

describe('agentLabelFor', () => {
  it('prefers the registry label over the definition id', () => {
    const labels = new Map([['sample.assistant', 'Sample Assistant']])
    expect(agentLabelFor(labels, 'sample.assistant')).toBe('Sample Assistant')
  })

  it('keeps the id for an agent the registry does not know', () => {
    // A case can outlive its agent (renamed definition, uninstalled module). Showing
    // a blank cell there would lose the only handle the operator has on the record.
    expect(agentLabelFor(new Map(), 'deals.health_check')).toBe('deals.health_check')
  })

  it('falls back on an empty label rather than rendering nothing', () => {
    expect(agentLabelFor(new Map([['a.b', '']]), 'a.b')).toBe('a.b')
  })
})
