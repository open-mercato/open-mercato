import { AGENT_REFERENCE_RESOLVER_DI_PREFIX, agentReferenceResolverDiKey } from '../referenceResolver'

describe('agentReferenceResolverDiKey', () => {
  it('prefixes the resolver id with the reference resolver DI namespace', () => {
    expect(AGENT_REFERENCE_RESOLVER_DI_PREFIX).toBe('agentReferenceResolver:')
    expect(agentReferenceResolverDiKey('acme_compliance.rule')).toBe('agentReferenceResolver:acme_compliance.rule')
  })

  it('keeps the resolver id verbatim', () => {
    expect(agentReferenceResolverDiKey('Kb.Article@v2')).toBe('agentReferenceResolver:Kb.Article@v2')
  })
})
