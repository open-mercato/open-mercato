import type { EntityManager } from '@mikro-orm/postgresql'
import type { z } from 'zod'
import type { impactTargetTypeSchema } from '../data/validators'

export type IncidentByTargetRow = {
  id: string
  number: string | null
  title: string | null
  status: string
  severityId: string | null
  impactStatus: string
}

export async function listOpenIncidentsByImpactTarget(params: {
  em: EntityManager
  organizationId: string
  tenantId: string
  targetType: z.infer<typeof impactTargetTypeSchema>
  targetId: string
}): Promise<IncidentByTargetRow[]> {
  return params.em.getConnection().execute<IncidentByTargetRow[]>(
    `select
        i.id::text as id,
        i.number as number,
        i.title as title,
        i.status as status,
        i.severity_id::text as "severityId",
        ii.impact_status as "impactStatus"
      from incident_impacts ii
      inner join incidents i
        on i.id = ii.incident_id
        and i.organization_id = ii.organization_id
        and i.tenant_id = ii.tenant_id
      where ii.organization_id = ?
        and ii.tenant_id = ?
        and ii.target_type = ?
        and ii.target_id = ?
        and ii.deleted_at is null
        and i.deleted_at is null
        and i.status not in ('closed')
      order by i.created_at desc
      limit 50`,
    [params.organizationId, params.tenantId, params.targetType, params.targetId],
  )
}
