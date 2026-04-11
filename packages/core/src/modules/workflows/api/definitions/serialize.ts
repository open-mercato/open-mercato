import type { WorkflowDefinition } from '../../data/entities'

const PLAIN_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function formatPlainDate(value: Date | null | undefined): string | null {
  if (!value) return null
  return PLAIN_DATE_FORMATTER.format(value)
}

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
    effectiveFrom: formatPlainDate(definition.effectiveFrom),
    effectiveTo: formatPlainDate(definition.effectiveTo),
    tenantId: definition.tenantId,
    organizationId: definition.organizationId,
    createdBy: definition.createdBy ?? null,
    updatedBy: definition.updatedBy ?? null,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
    deletedAt: definition.deletedAt ?? null,
  }
}
