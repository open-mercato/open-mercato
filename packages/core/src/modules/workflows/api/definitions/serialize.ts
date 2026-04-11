import type { WorkflowDefinition } from '../../data/entities'

export function serializeWorkflowDefinition(definition: WorkflowDefinition) {
  return {
    id: definition.id,
    workflowId: definition.workflowId,
    workflowName: definition.workflowName,
    description: definition.description ?? null,
    version: definition.version,
    definition: definition.definition,
    metadata: definition.metadata ?? null,
    enabled: definition.enabled,
    effectiveFrom: definition.effectiveFrom ? definition.effectiveFrom.toISOString().slice(0, 10) : null,
    effectiveTo: definition.effectiveTo ? definition.effectiveTo.toISOString().slice(0, 10) : null,
    tenantId: definition.tenantId,
    organizationId: definition.organizationId,
    createdBy: definition.createdBy ?? null,
    updatedBy: definition.updatedBy ?? null,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
    deletedAt: definition.deletedAt ?? null,
  }
}
