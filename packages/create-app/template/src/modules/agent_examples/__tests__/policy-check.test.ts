import { parseAgentIntegrityRules } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/guardrails/integrity/declaration'
import { agentReferenceResolverDiKey } from '@open-mercato/shared/lib/ai/referenceResolver'
import { createContainer, InjectionMode } from 'awilix'
import { policyCheckResult } from '../data/validators'
import { policyCheckIntegrity } from '../lib/policyCheckIntegrity'
import {
  SUPPORT_POLICY_RESOLVER_ID,
  SUPPORT_POLICY_SET_VERSION,
  findSupportPolicy,
  supportPolicyResolver,
} from '../lib/supportPolicies'
import { register } from '../di'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('agent_examples support policy resolver', () => {
  it('resolves known ids, unknown ids and version mismatches in one batch', async () => {
    const resolutions = await supportPolicyResolver.resolve(
      [
        { id: 'refund-window', version: SUPPORT_POLICY_SET_VERSION },
        { id: 'no-credentials' },
        { id: 'made-up-policy', version: SUPPORT_POLICY_SET_VERSION },
        { id: 'escalate-outages', version: '1999.1' },
      ],
      scope,
    )
    expect(resolutions.get('refund-window')).toEqual({ status: 'exists', version: SUPPORT_POLICY_SET_VERSION })
    expect(resolutions.get('no-credentials')).toEqual({ status: 'exists', version: SUPPORT_POLICY_SET_VERSION })
    expect(resolutions.get('made-up-policy')).toEqual({ status: 'not_found' })
    expect(resolutions.get('escalate-outages')).toEqual({
      status: 'version_mismatch',
      currentVersion: SUPPORT_POLICY_SET_VERSION,
    })
  })

  it('compares ids exactly', async () => {
    const resolutions = await supportPolicyResolver.resolve([{ id: 'Refund-Window' }], scope)
    expect(resolutions.get('Refund-Window')).toEqual({ status: 'not_found' })
    expect(findSupportPolicy('Refund-Window')).toBeNull()
  })

  it('is registered in DI under the agentReferenceResolver key', () => {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    register(container as unknown as AppContainer)
    expect(container.resolve(agentReferenceResolverDiKey(SUPPORT_POLICY_RESOLVER_ID))).toBe(supportPolicyResolver)
  })
})

describe('support.policy_check integrity declaration', () => {
  it('validates against the agent result schema', () => {
    const rules = parseAgentIntegrityRules('support.policy_check', policyCheckResult, policyCheckIntegrity)
    expect(rules?.map((rule) => rule.kind)).toEqual(['evidence_quote', 'reference_exists', 'tool_consulted'])
  })
})
