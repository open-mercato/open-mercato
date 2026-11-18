import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

type DetailIncludeContainer = { resolve: (name: string) => unknown }

type DetailIncludeAuth = {
  sub?: string | null
}

export const DETAIL_INCLUDE_REQUIRED_FEATURES: Readonly<Record<string, readonly string[]>> = {
  deals: ['customers.deals.view'],
  people: ['customers.people.view'],
}

export async function dropUnauthorizedDetailIncludes(input: {
  includeTokens: Set<string>
  container: DetailIncludeContainer
  auth: DetailIncludeAuth
  recordScope: { tenantId: string | null; organizationId: string | null }
}): Promise<void> {
  const gatedTokens = Object.keys(DETAIL_INCLUDE_REQUIRED_FEATURES).filter((token) => input.includeTokens.has(token))
  if (!gatedTokens.length) return
  const subject = input.auth.sub ?? null
  const rbac = subject ? (input.container.resolve('rbacService') as RbacService | undefined) : undefined
  for (const token of gatedTokens) {
    const allowed = subject && rbac
      ? await rbac.userHasAllFeatures(subject, [...DETAIL_INCLUDE_REQUIRED_FEATURES[token]], input.recordScope)
      : false
    if (!allowed) input.includeTokens.delete(token)
  }
}
