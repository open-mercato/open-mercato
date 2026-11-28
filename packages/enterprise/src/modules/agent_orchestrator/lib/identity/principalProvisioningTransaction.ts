import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, type AwilixContainer } from 'awilix'
import type { AgentPrincipalScope } from './agentPrincipalService'

/**
 * Legacy roles are shared by an agent's organizations within a tenant, so both
 * provisioning paths take the tenant-and-agent lock before reading the principal.
 * The auth helper forks its EM, so bind that fork to this transaction as well.
 */
export function inAgentPrincipalProvisioningTransaction<Result>(
  container: AwilixContainer,
  scope: AgentPrincipalScope,
  agentDefinitionId: string,
  provision: (em: EntityManager, transactionContainer: AwilixContainer) => Promise<Result>,
): Promise<Result> {
  const em = (container.resolve('em') as EntityManager).fork()
  const lockKey = `agent_principal:${scope.tenantId}:${agentDefinitionId.trim()}`

  return em.transactional(async (transactionEm) => {
    await transactionEm.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [lockKey])

    const transactionContainer = container.createScope().register({
      em: asValue({ fork: () => transactionEm.fork({ keepTransactionContext: true }) }),
    })
    return provision(transactionEm, transactionContainer)
  })
}
