/**
 * Shared context-ledger resolution for a workflow definition.
 *
 * Extracted verbatim from `api/definitions/[id]/context-schema/route.ts` so the
 * REST route and the `workflows.get_context_schema` AI tool serve the SAME
 * ledger from the SAME id forms. The output-contract seam stays single-sourced:
 * both callers reach `resolveServerOutputContract` through
 * {@link computeDefinitionContextLedger} and never resolve contracts a second
 * way (the browser editor deliberately pins the seam to `'unknown'` and
 * consumes this response instead).
 */

import type { EntityManager } from '@mikro-orm/core'
import { getDeclaredEvents } from '@open-mercato/shared/modules/events'
import { WorkflowDefinition, type WorkflowDefinitionData } from '../data/entities'
import {
  buildTriggerPayloadContracts,
  computeContextLedger,
  type ContextLedger,
  type LedgerStepView,
  type LedgerWorkflowDefinition,
} from './context-ledger'
import { ensureWorkflowEndpointCatalog } from './endpoint-catalog'
import {
  ensureWorkflowAgentOutcomeContracts,
  resolveServerOutputContract,
} from './server-output-contract'
import { getCodeWorkflow, getAllCodeWorkflows } from './code-registry'
import { codeWorkflowUuid } from './find-definition'

export type DefinitionLookupScope = {
  tenantId: string
  /**
   * Organization where-clause fragment. The route passes
   * `resolveOrganizationScopeFilter(...).where`; other callers pass
   * `{ organizationId }` (or `{}` when the caller is tenant-wide).
   */
  organizationWhere: Record<string, unknown>
}

/**
 * Warm the two sync-lookup caches the server output-contract seam reads.
 * MUST run before {@link computeDefinitionContextLedger} or CALL_API and
 * INVOKE_AGENT contracts silently degrade to `'unknown'`.
 */
export async function warmContextLedgerResolvers(container: {
  resolve: <T>(name: string) => T
}): Promise<void> {
  await ensureWorkflowEndpointCatalog()
  await ensureWorkflowAgentOutcomeContracts(container)
}

export function computeDefinitionContextLedger(definition: WorkflowDefinitionData): ContextLedger {
  const ledgerDefinition = definition as unknown as LedgerWorkflowDefinition
  return computeContextLedger(ledgerDefinition, {
    resolveOutputContract: resolveServerOutputContract,
    triggerPayloadContracts: buildTriggerPayloadContracts(
      ledgerDefinition.triggers ?? [],
      getDeclaredEvents(),
    ),
  })
}

export function narrowLedgerToStep(ledger: ContextLedger, stepId: string): LedgerStepView | null {
  return ledger.steps[stepId] ?? null
}

/**
 * Resolve a definition's `definition` JSON from any of the three id forms the
 * context-schema route accepts: `code:<workflowId>`, a tenant/org-scoped DB
 * UUID, and the synthetic `codeWorkflowUuid(workflowId)` fallback.
 *
 * Tenant scoping is not optional — a definition outside `scope.tenantId` is
 * INVISIBLE (returns `null`, indistinguishable from "does not exist"), never
 * merely unauthorized.
 */
export async function resolveDefinitionDataForLedger(
  em: EntityManager,
  id: string,
  scope: DefinitionLookupScope,
): Promise<WorkflowDefinitionData | null> {
  if (id.startsWith('code:')) {
    const codeDef = getCodeWorkflow(id.slice(5))
    if (!codeDef) return null
    return codeDef.definition as unknown as WorkflowDefinitionData
  }

  const definition = (await em.findOne(WorkflowDefinition, {
    id,
    tenantId: scope.tenantId,
    ...scope.organizationWhere,
    deletedAt: null,
  })) as WorkflowDefinition | null

  if (definition) return definition.definition

  const codeDef = getAllCodeWorkflows().find(
    (workflow) => codeWorkflowUuid(workflow.workflowId) === id,
  )
  if (codeDef) return codeDef.definition as unknown as WorkflowDefinitionData

  return null
}
