import { extractResponseEnricherNamespaces, isResponseEnricherNamespace } from '../response-enricher-namespaces'

describe('response enricher namespaces', () => {
  it('retains legacy and module namespaces without native fields, metadata or flat edits', () => {
    const record = JSON.parse('{"id":"person","_example":{"priority":"high"},"_carrierInstructions":{"text":"leave at desk"},"_meta":{},"__proto__":{},"_example.priority":"critical"}') as Record<string, unknown>
    expect(extractResponseEnricherNamespaces(record)).toEqual({
      _example: { priority: 'high' },
      _carrierInstructions: { text: 'leave at desk' },
    })
    expect(isResponseEnricherNamespace('_')).toBe(false)
    expect(isResponseEnricherNamespace('__constructor')).toBe(false)
  })
})
