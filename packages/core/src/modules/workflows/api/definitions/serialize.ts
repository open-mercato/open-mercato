import type { WorkflowDefinition } from '../../data/entities'
import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'
import { getCodeWorkflow } from '../../lib/code-registry'

export type WorkflowDefinitionSource = 'code' | 'code_override' | 'user'

function resolveSource(definition: WorkflowDefinition): WorkflowDefinitionSource {
  if (definition.codeWorkflowId) return 'code_override'
  return 'user'
}

export function serializeWorkflowDefinition(definition: WorkflowDefinition) {
  const source = resolveSource(definition)
  const codeModuleId =
    source === 'code_override' && definition.codeWorkflowId
      ? getCodeWorkflow(definition.codeWorkflowId)?.moduleId ?? null
      : null
  return {
    id: definition.id,
    workflowId: definition.workflowId,
    workflowName: definition.workflowName,
    description: definition.description ?? null,
    version: definition.version,
    definition: definition.definition,
    metadata: definition.metadata ?? null,
    enabled: definition.enabled,
    kind: definition.kind,
    lifecycle: definition.lifecycle,
    effectiveFrom: definition.effectiveFrom ?? null,
    effectiveTo: definition.effectiveTo ?? null,
    tenantId: definition.tenantId,
    organizationId: definition.organizationId,
    createdBy: definition.createdBy ?? null,
    updatedBy: definition.updatedBy ?? null,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
    deletedAt: definition.deletedAt ?? null,
    source,
    isCodeBased: source === 'code' || source === 'code_override',
    codeModuleId,
  }
}

export function serializeCodeWorkflowDefinition(codeDef: CodeWorkflowDefinition, syntheticId: string) {
  return {
    id: syntheticId,
    workflowId: codeDef.workflowId,
    workflowName: codeDef.workflowName,
    description: codeDef.description ?? null,
    version: codeDef.version,
    definition: codeDef.definition,
    metadata: codeDef.metadata ?? null,
    enabled: codeDef.enabled,
    // Code-based definitions are normal, published workflows (never components).
    kind: 'workflow' as const,
    lifecycle: 'published' as const,
    effectiveFrom: null,
    effectiveTo: null,
    tenantId: null,
    organizationId: null,
    createdBy: null,
    updatedBy: null,
    createdAt: null,
    updatedAt: null,
    deletedAt: null,
    source: 'code' as const,
    isCodeBased: true,
    codeModuleId: codeDef.moduleId,
  }
}
