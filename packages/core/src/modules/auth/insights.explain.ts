import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { defineExplainConfig } from '@open-mercato/shared/modules/insights/explain'
import type { ExplainLoadContext, ExplainReferenceDetail } from '@open-mercato/shared/modules/insights/explain'
import {
  normalizeExplainIds,
  resolveExplainDecryptionScope,
  resolveExplainNullableOrganizationWhere,
  runExplainResolverSafely,
} from '@open-mercato/shared/modules/insights/helpers'
import { User } from './data/entities'

export const AUTH_USER_REFERENCE_KIND = 'auth.user'

function resolveUserDisplayName(user: User): string | null {
  const name = typeof user.name === 'string' ? user.name.trim() : ''
  return name.length > 0 ? name : null
}

async function resolveUserReferences(ctx: ExplainLoadContext, ids: string[]): Promise<ExplainReferenceDetail[]> {
  const organizationWhere = resolveExplainNullableOrganizationWhere(ctx.scope)
  const userIds = normalizeExplainIds(ids, { uuidOnly: true })
  if (!organizationWhere || userIds.length === 0) return []
  const users = await findWithDecryption(
    ctx.em,
    User,
    { id: { $in: userIds }, tenantId: ctx.scope.tenantId, deletedAt: null, ...organizationWhere },
    undefined,
    resolveExplainDecryptionScope(ctx.scope),
  )
  return users.map((user) => ({
    kind: AUTH_USER_REFERENCE_KIND,
    id: user.id,
    label: resolveUserDisplayName(user),
    href: null,
    organizationId: user.organizationId ?? null,
  }))
}

export const explainConfig = defineExplainConfig({
  version: 1,
  referenceResolvers: [
    {
      kind: AUTH_USER_REFERENCE_KIND,
      requiredFeatures: ['auth.users.list'],
      resolve: (ctx, ids) =>
        runExplainResolverSafely(
          { module: 'auth', code: 'auth.insights_reference_failed', kind: AUTH_USER_REFERENCE_KIND },
          () => resolveUserReferences(ctx, ids),
        ),
    },
  ],
})

export default explainConfig
