import type { executeRuleByRuleId } from '@open-mercato/core/modules/business_rules'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { reportError } from '@open-mercato/telemetry'
import { getRequestScopeContainer, runInRequestScope } from '@open-mercato/shared/lib/di/request-scope'
import { isBusinessRulesModuleEnabled } from './optional-modules'

export type WorkflowRuleContainer = {
  resolve: <T>(name: string, options?: { allowUnregistered?: boolean }) => T
}

type NamedWorkflowRuleRunner = { executeRuleByRuleId: typeof executeRuleByRuleId }

function resolveNamedRuleRunner(container: WorkflowRuleContainer | null): NamedWorkflowRuleRunner | undefined {
  const runner = container?.resolve<NamedWorkflowRuleRunner | undefined>('ruleEngine', { allowUnregistered: true })
  return typeof runner?.executeRuleByRuleId === 'function' ? runner : undefined
}

export function createNamedWorkflowRuleScope(container: WorkflowRuleContainer | null | undefined) {
  let ownedContainer: AppContainer | undefined
  let resolved: Promise<NamedWorkflowRuleRunner | undefined> | undefined

  async function resolve() {
    const activeContainer = container === undefined ? getRequestScopeContainer() : container
    if (activeContainer || container !== undefined) return resolveNamedRuleRunner(activeContainer)
    if (!isBusinessRulesModuleEnabled()) return undefined

    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    ownedContainer = await runInRequestScope(createRequestContainer)
    return resolveNamedRuleRunner(ownedContainer)
  }

  return {
    resolve: () => resolved ??= resolve(),
    async dispose() {
      try {
        await ownedContainer?.dispose()
      } catch (error) {
        reportError(error, { module: 'workflows', code: 'workflows.named_rule_scope_disposal_failed' })
      }
    },
  }
}

export async function withNamedWorkflowRuleRunner<Result>(
  container: WorkflowRuleContainer | null | undefined,
  useRunner: (runner: NamedWorkflowRuleRunner | undefined) => Promise<Result>,
): Promise<Result> {
  const scope = createNamedWorkflowRuleScope(container)
  try {
    return await useRunner(await scope.resolve())
  } finally {
    await scope.dispose()
  }
}
