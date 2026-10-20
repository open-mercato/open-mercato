import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { defineExplainConfig } from '@open-mercato/shared/modules/insights/explain'
import type { ExplainCauseDetail, ExplainLoadContext } from '@open-mercato/shared/modules/insights/explain'
import {
  normalizeExplainIds,
  resolveExplainDecryptionScope,
  resolveExplainOrganizationWhere,
  runExplainResolverSafely,
} from '@open-mercato/shared/modules/insights/helpers'
import { WorkflowDefinition, WorkflowInstance } from './data/entities'
import { resolveCodeDefinitionForInstance } from './lib/find-definition'

function resolveWorkflowLabel(instance: WorkflowInstance, definitionsById: Map<string, WorkflowDefinition>): string {
  const persisted = definitionsById.get(instance.definitionId)
  if (persisted?.workflowName) return persisted.workflowName
  const codeDefinition = resolveCodeDefinitionForInstance(instance)
  if (codeDefinition?.workflowName) return codeDefinition.workflowName
  return instance.workflowId
}

async function resolveWorkflowCauses(ctx: ExplainLoadContext, ids: string[]): Promise<ExplainCauseDetail[]> {
  const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
  const instanceIds = normalizeExplainIds(ids, { uuidOnly: true })
  if (!organizationWhere || instanceIds.length === 0) return []
  const decryptionScope = resolveExplainDecryptionScope(ctx.scope)
  const instances = await findWithDecryption(
    ctx.em,
    WorkflowInstance,
    { id: { $in: instanceIds }, tenantId: ctx.scope.tenantId, ...organizationWhere },
    undefined,
    decryptionScope,
  )
  if (instances.length === 0) return []
  const definitionIds = normalizeExplainIds(instances.map((instance) => instance.definitionId), { uuidOnly: true })
  const definitions = definitionIds.length
    ? await findWithDecryption(
        ctx.em,
        WorkflowDefinition,
        { id: { $in: definitionIds }, tenantId: ctx.scope.tenantId, ...organizationWhere },
        undefined,
        decryptionScope,
      )
    : []
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]))
  return instances.map((instance) => ({
    kind: 'workflow',
    id: instance.id,
    label: resolveWorkflowLabel(instance, definitionsById),
    href: instance.deletedAt ? null : `/backend/instances/${encodeURIComponent(instance.id)}`,
    organizationId: instance.organizationId,
  }))
}

export const explainConfig = defineExplainConfig({
  version: 1,
  causeResolvers: [
    {
      kind: 'workflow',
      requiredFeatures: ['workflows.instances.view'],
      resolve: (ctx, ids) =>
        runExplainResolverSafely(
          { module: 'workflows', code: 'workflows.insights_cause_failed', kind: 'workflow' },
          () => resolveWorkflowCauses(ctx, ids),
        ),
    },
  ],
})

export default explainConfig
