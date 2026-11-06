import type {
  AgentReferenceResolver,
  ReferenceLookup,
  ReferenceResolution,
} from '@open-mercato/shared/lib/ai/referenceResolver'

/**
 * A tiny, static support-policy catalogue used by the `support.policy_check`
 * example agent, its `agent_examples.get_support_policy` tool and the
 * `agent_examples.support_policy` reference resolver.
 *
 * It is global example data kept in code so the example needs no entity, no
 * migration and no seed. A real module would store policies per tenant and read
 * them through `findWithDecryption`, filtered by the resolver scope.
 */
export type SupportPolicy = {
  id: string
  version: string
  title: string
  rule: string
}

export const SUPPORT_POLICY_SET_VERSION = '2026.1'

export const SUPPORT_POLICIES: readonly SupportPolicy[] = [
  {
    id: 'no-credentials',
    version: SUPPORT_POLICY_SET_VERSION,
    title: 'Never ask for credentials',
    rule: 'A reply must never ask the customer for a password, a one-time code or full card details.',
  },
  {
    id: 'refund-window',
    version: SUPPORT_POLICY_SET_VERSION,
    title: 'Refund window',
    rule: 'A reply may promise a refund only for charges made within the last 30 days.',
  },
  {
    id: 'no-delivery-dates',
    version: SUPPORT_POLICY_SET_VERSION,
    title: 'No guaranteed dates',
    rule: 'A reply must not guarantee a fix, release or delivery date.',
  },
  {
    id: 'escalate-outages',
    version: SUPPORT_POLICY_SET_VERSION,
    title: 'Escalate outages',
    rule: 'A reply to a reported outage must say the issue was escalated to the on-call team.',
  },
]

export const SUPPORT_POLICY_RESOLVER_ID = 'agent_examples.support_policy'

export function findSupportPolicy(policyId: string): SupportPolicy | null {
  return SUPPORT_POLICIES.find((policy) => policy.id === policyId) ?? null
}

function resolveOne(lookup: ReferenceLookup): ReferenceResolution {
  const policy = findSupportPolicy(lookup.id)
  if (!policy) return { status: 'not_found' }
  if (lookup.version && lookup.version !== policy.version) {
    return { status: 'version_mismatch', currentVersion: policy.version }
  }
  return { status: 'exists', version: policy.version }
}

/**
 * Read-only resolver behind the `reference_exists` rule of `support.policy_check`.
 * Ids are compared exactly (no case folding). The scope argument is accepted and
 * ignored because the catalogue is global example data, not tenant data.
 */
export const supportPolicyResolver: AgentReferenceResolver = {
  id: SUPPORT_POLICY_RESOLVER_ID,
  contractVersion: 1,
  async resolve(refs) {
    const resolutions = new Map<string, ReferenceResolution>()
    for (const lookup of refs) resolutions.set(lookup.id, resolveOne(lookup))
    return resolutions
  },
}
