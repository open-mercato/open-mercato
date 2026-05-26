import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'

export type SchedulerJobsFilterContext = {
  auth?: {
    tenantId?: string | null
    orgId?: string | null
    roles?: unknown
  } | null
  organizationIds?: string[] | null
}

export type SchedulerJobsFilterQuery = {
  id?: string
  scopeType?: string
  isEnabled?: boolean
  sourceType?: string
  sourceModule?: string
  search?: string
}

export async function buildSchedulerJobsFilters(
  query: SchedulerJobsFilterQuery,
  ctx: SchedulerJobsFilterContext,
): Promise<Record<string, unknown>> {
  const filters: Record<string, unknown> = {}
  const tenantId = ctx.auth?.tenantId
  if (!tenantId) {
    filters.id = { $eq: '00000000-0000-0000-0000-000000000000' }
    return filters
  }

  const isSuperAdmin =
    Array.isArray(ctx.auth?.roles) &&
    ctx.auth.roles.some((role) => typeof role === 'string' && role.trim().toLowerCase() === 'superadmin')

  const rawOrgIds = Array.isArray(ctx.organizationIds)
    ? ctx.organizationIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  const orgIdsForVisibility =
    rawOrgIds.length > 0 ? rawOrgIds : ctx.auth?.orgId ? [ctx.auth.orgId] : []

  const visibilityBranches: Record<string, unknown>[] = []
  if (orgIdsForVisibility.length === 1) {
    visibilityBranches.push({
      organization_id: { $eq: orgIdsForVisibility[0] },
      tenant_id: { $eq: tenantId },
    })
  } else if (orgIdsForVisibility.length > 1) {
    visibilityBranches.push({
      organization_id: { $in: orgIdsForVisibility },
      tenant_id: { $eq: tenantId },
    })
  }
  visibilityBranches.push({
    organization_id: { $eq: null },
    tenant_id: { $eq: tenantId },
    scope_type: { $eq: 'tenant' },
  })
  if (isSuperAdmin) {
    visibilityBranches.push({
      organization_id: { $eq: null },
      tenant_id: { $eq: null },
      scope_type: { $eq: 'system' },
    })
  }

  const searchNeedle = query.search?.trim()
    ? `%${escapeLikePattern(query.search.trim())}%`
    : null

  const visibilityOr: Record<string, unknown>[] = searchNeedle
    ? visibilityBranches.flatMap((branch) => [
        { ...branch, name: { $ilike: searchNeedle } },
        { ...branch, description: { $ilike: searchNeedle } },
      ])
    : visibilityBranches

  filters.$or = visibilityOr

  if (query.id) {
    filters.id = { $eq: query.id }
  }

  if (query.scopeType) {
    filters.scope_type = { $eq: query.scopeType }
  }

  if (query.isEnabled !== undefined) {
    filters.is_enabled = { $eq: query.isEnabled }
  }

  if (query.sourceType) {
    filters.source_type = { $eq: query.sourceType }
  }

  if (query.sourceModule) {
    filters.source_module = { $eq: query.sourceModule }
  }

  return filters
}
