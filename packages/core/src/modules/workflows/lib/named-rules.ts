import type { executeRuleByRuleId } from '@open-mercato/core/modules/business_rules'
import { getRequestScopeContainer } from '@open-mercato/shared/lib/di/request-scope'
import { isBusinessRulesModuleEnabled } from './optional-modules'

export type WorkflowRuleContainer = {
  resolve: <T>(name: string, options?: { allowUnregistered?: boolean }) => T
}

type NamedWorkflowRuleRunner = { executeRuleByRuleId: typeof executeRuleByRuleId }

function resolveNamedRuleRunner(container: WorkflowRuleContainer | null): NamedWorkflowRuleRunner | undefined {
  const runner = container?.resolve<NamedWorkflowRuleRunner | undefined>('ruleEngine', { allowUnregistered: true })
  return typeof runner?.executeRuleByRuleId === 'function' ? runner : undefined
}

export async function withNamedWorkflowRuleRunner<Result>(
  container: WorkflowRuleContainer | null | undefined,
  useRunner: (runner: NamedWorkflowRuleRunner | undefined) => Promise<Result>,
): Promise<Result> {
  const activeContainer = container === undefined ? getRequestScopeContainer() : container
  if (activeContainer || container !== undefined) return useRunner(resolveNamedRuleRunner(activeContainer))
  if (!isBusinessRulesModuleEnabled()) return useRunner(undefined)

  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const legacyContainer = await createRequestContainer()
  try {
    return await useRunner(resolveNamedRuleRunner(legacyContainer))
  } finally {
    await legacyContainer.dispose()
  }
}
