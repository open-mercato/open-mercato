import type { IntegrityRuleInput } from '@open-mercato/enterprise/modules/agent_orchestrator/data/validators'
import { SUPPORT_POLICY_RESOLVER_ID } from './supportPolicies'

export const GET_SUPPORT_POLICY_TOOL_ID = 'agent_examples.get_support_policy'

/**
 * Output-integrity rules of the `support.policy_check` example agent. Paths are
 * relative to the result envelope (`{ kind, data }`):
 * - `quotes` drops an evidence quote that is not verbatim in the reply, and
 *   rewrites `start`/`end` to the real offsets;
 * - `policy-ids` drops a finding whose policy id does not exist at the
 *   policy-set version given in the input;
 * - `policies-read` flags a finding whose policy the agent never fetched with
 *   the `agent_examples.get_support_policy` tool.
 */
export const policyCheckIntegrity: IntegrityRuleInput[] = [
  {
    id: 'quotes',
    kind: 'evidence_quote',
    items: 'data.findings[*].evidence[*]',
    quote: 'quote',
    offsets: { start: 'start', end: 'end' },
    source: { input: 'reply' },
    onViolation: 'drop',
  },
  {
    id: 'policy-ids',
    kind: 'reference_exists',
    ids: 'data.findings[*].policyId',
    resolver: SUPPORT_POLICY_RESOLVER_ID,
    version: { input: 'policySetVersion' },
    onViolation: 'drop',
  },
  {
    id: 'policies-read',
    kind: 'tool_consulted',
    cites: 'data.findings[*].policyId',
    tools: [GET_SUPPORT_POLICY_TOOL_ID],
    returned: ['policy.id'],
    onViolation: 'flag',
  },
]
