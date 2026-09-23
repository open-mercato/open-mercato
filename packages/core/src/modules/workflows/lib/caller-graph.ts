/**
 * Workflows Module - Sub-workflow Caller Graph
 *
 * Finds the parent definitions that invoke a given sub-workflow and computes
 * which of their field mappings a port-schema change would break. Used by the
 * publish flow and the breaking-change preview endpoint.
 *
 * The caller scan uses a tenant-scoped jsonb `@>` containment query (backed by
 * the GIN index on `workflow_definitions.definition`); the impact diff is a pure
 * function so it can be unit-tested without a database.
 */

import type { EntityManager } from '@mikro-orm/core'
import { WorkflowDefinition } from '../data/entities'
import type { PortField, WorkflowIoContract } from '../data/validators'

export interface CallerImpact {
  workflowId: string
  version: number
  stepId: string
  brokenMappings: string[]
}

interface CallerDefinition {
  workflowId: string
  version: number
  definition: any
}

/**
 * Compute, for each caller, the mappings that reference a port no longer present
 * in `ports`. Input mappings are keyed by child INPUT port name; output mappings
 * are keyed by parent key with values that are dot-paths whose first segment is a
 * child OUTPUT port name.
 */
export function computeCallerImpacts(
  callers: CallerDefinition[],
  subWorkflowId: string,
  ports: WorkflowIoContract,
): CallerImpact[] {
  const inputNames = new Set((ports.inputs || []).map((port: PortField) => port.name))
  const outputNames = new Set((ports.outputs || []).map((port: PortField) => port.name))
  const impacts: CallerImpact[] = []

  for (const caller of callers) {
    const steps: any[] = Array.isArray(caller.definition?.steps) ? caller.definition.steps : []
    for (const step of steps) {
      if (step?.stepType !== 'SUB_WORKFLOW') continue
      if (step?.config?.subWorkflowId !== subWorkflowId) continue

      const broken: string[] = []

      const inputMapping: Record<string, string> = step.config?.inputMapping || {}
      for (const childPortKey of Object.keys(inputMapping)) {
        if (!inputNames.has(childPortKey)) broken.push(`input:${childPortKey}`)
      }

      const outputMapping: Record<string, string> = step.config?.outputMapping || {}
      for (const childPath of Object.values(outputMapping)) {
        const portName = String(childPath).split('.')[0]
        if (!outputNames.has(portName)) broken.push(`output:${childPath}`)
      }

      if (broken.length > 0) {
        impacts.push({
          workflowId: caller.workflowId,
          version: caller.version,
          stepId: step.stepId,
          brokenMappings: broken,
        })
      }
    }
  }

  return impacts
}

/**
 * Find parent definitions that invoke `subWorkflowId` and compute their breaking
 * mappings against the supplied published port contract. Tenant/org scoped.
 */
export async function findSubWorkflowCallers(
  em: EntityManager,
  options: { subWorkflowId: string; tenantId: string; organizationId: string; ports: WorkflowIoContract },
): Promise<CallerImpact[]> {
  const { subWorkflowId, tenantId, organizationId, ports } = options
  const containment = JSON.stringify({
    steps: [{ stepType: 'SUB_WORKFLOW', config: { subWorkflowId } }],
  })

  const rows = (await em.getConnection().execute(
    `select workflow_id, version, definition from workflow_definitions
     where tenant_id = ? and organization_id = ? and deleted_at is null and definition @> ?::jsonb`,
    [tenantId, organizationId, containment],
  )) as Array<{ workflow_id: string; version: number; definition: any }>

  const callers: CallerDefinition[] = rows.map((row) => ({
    workflowId: row.workflow_id,
    version: row.version,
    definition: typeof row.definition === 'string' ? JSON.parse(row.definition) : row.definition,
  }))

  return computeCallerImpacts(callers, subWorkflowId, ports)
}
