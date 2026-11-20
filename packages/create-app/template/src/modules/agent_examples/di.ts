import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { agentReferenceResolverDiKey } from '@open-mercato/shared/lib/ai/referenceResolver'
import { SUPPORT_POLICY_RESOLVER_ID, supportPolicyResolver } from './lib/supportPolicies'

/**
 * Registers the `agent_examples.support_policy` reference resolver used by the
 * `reference_exists` integrity rule of `support.policy_check`. The agent
 * orchestrator resolves it soft-optionally from `agentReferenceResolver:<id>`.
 */
export function register(container: AppContainer) {
  container.register({
    [agentReferenceResolverDiKey(SUPPORT_POLICY_RESOLVER_ID)]: asValue(supportPolicyResolver),
  })
}
