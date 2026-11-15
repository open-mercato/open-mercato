export type ProgressOrganizationScope = {
  organizationId?: string | null
  organizationIds?: string[] | null
}

export function buildProgressOrganizationFilter(
  scope: ProgressOrganizationScope,
): Record<string, unknown> {
  if (scope.organizationIds !== undefined) {
    return scope.organizationIds === null
      ? {}
      : { organizationId: { $in: scope.organizationIds } }
  }
  return scope.organizationId
    ? { organizationId: scope.organizationId }
    : {}
}
