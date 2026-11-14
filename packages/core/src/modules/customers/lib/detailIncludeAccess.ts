import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

type DetailIncludeContainer = { resolve: (name: string) => unknown }

type DetailIncludeAuth = {
  sub?: string | null
  tenantId?: string | null
  orgId?: string | null
}

type DetailIncludeScope = {
  tenantId?: string | null
  selectedId?: string | null
} | null | undefined

export const DETAIL_INCLUDE_REQUIRED_FEATURES: Readonly<Record<string, readonly string[]>> = {
  deals: ['customers.deals.view'],
  people: ['customers.people.view'],
}

export async function dropUnauthorizedDetailIncludes(input: {
  includeTokens: Set<string>
  container: DetailIncludeContainer
  auth: DetailIncludeAuth
  scope: DetailIncludeScope
}): Promise<void> {
  const gatedTokens = Object.keys(DETAIL_INCLUDE_REQUIRED_FEATURES).filter((token) => input.includeTokens.has(token))
  if (!gatedTokens.length) return
  const subject = input.auth.sub ?? null
  const rbac = subject ? (input.container.resolve('rbacService') as RbacService | undefined) : undefined
  const featureScope = {
    tenantId: input.scope?.tenantId ?? input.auth.tenantId ?? null,
    organizationId: input.scope?.selectedId ?? input.auth.orgId ?? null,
  }
  for (const token of gatedTokens) {
    const allowed = subject && rbac
      ? await rbac.userHasAllFeatures(subject, [...DETAIL_INCLUDE_REQUIRED_FEATURES[token]], featureScope)
      : false
    if (!allowed) input.includeTokens.delete(token)
  }
}
