/** @jest-environment node */
import {
  computePrincipalDeniedTools,
  resolvePrincipalToolAclRecord,
  type ToolRequiredFeaturesResolver,
} from '../lib/identity/principalDeniedTools'
import type { EffectiveToolAcl } from '../lib/identity/resolveEffectiveToolAcl'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'

const TOOL_FEATURES: Record<string, string[]> = {
  'customers.get_deal': ['customers.deals.view'],
  'customers.update_deal': ['customers.deals.manage'],
  'sales.get_order': ['sales.orders.view'],
  'search.query': [],
}

const resolveFeatures: ToolRequiredFeaturesResolver = (toolName) => TOOL_FEATURES[toolName] ?? null

const callerAcl = { features: ['customers.deals.*', 'catalog.products.view'], isSuperAdmin: false }
const effectiveAcl = { features: ['customers.deals.view'], isSuperAdmin: false }

function entryWithTools(tools: string[]): AgentRegistryEntry {
  return { id: 'acl_test.agent', tools, skills: [], subAgents: [], runtime: 'native' } as unknown as AgentRegistryEntry
}

describe('computePrincipalDeniedTools', () => {
  it('reports tools the caller may use but the intersected ACL may not', () => {
    const denied = computePrincipalDeniedTools(
      ['customers.update_deal', 'customers.get_deal', 'sales.get_order', 'search.query', 'unknown.tool'],
      callerAcl,
      effectiveAcl,
      resolveFeatures,
    )
    expect(denied).toEqual(['customers.update_deal'])
  })

  it('treats a super-admin caller as holding every feature', () => {
    const denied = computePrincipalDeniedTools(
      ['customers.update_deal', 'sales.get_order', 'customers.get_deal'],
      { features: [], isSuperAdmin: true },
      effectiveAcl,
      resolveFeatures,
    )
    expect(denied).toEqual(['customers.update_deal', 'sales.get_order'])
  })
})

describe('resolvePrincipalToolAclRecord', () => {
  const entry = entryWithTools(['customers.update_deal', 'customers.get_deal'])

  it('returns null in caller mode', () => {
    const acl: EffectiveToolAcl = { ...callerAcl, mode: 'caller' }
    expect(resolvePrincipalToolAclRecord(entry, acl, resolveFeatures)).toBeNull()
  })

  it('records an empty list in intersect mode without a bound principal', () => {
    const acl: EffectiveToolAcl = { ...callerAcl, mode: 'intersect' }
    expect(resolvePrincipalToolAclRecord(entry, acl, resolveFeatures)).toEqual({ mode: 'intersect', deniedByPrincipal: [] })
  })

  it('records the principal-denied tools in intersect mode', () => {
    const acl: EffectiveToolAcl = { ...effectiveAcl, mode: 'intersect', callerAcl }
    expect(resolvePrincipalToolAclRecord(entry, acl, resolveFeatures)).toEqual({
      mode: 'intersect',
      deniedByPrincipal: ['customers.update_deal'],
    })
  })
})
