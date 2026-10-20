import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { defineExplainConfig } from '@open-mercato/shared/modules/insights/explain'
import type { ExplainCauseDetail, ExplainLoadContext } from '@open-mercato/shared/modules/insights/explain'
import {
  normalizeExplainIds,
  resolveExplainDecryptionScope,
  resolveExplainOrganizationWhere,
  runExplainResolverSafely,
} from '@open-mercato/shared/modules/insights/helpers'
import { ApiKey } from './data/entities'

const API_KEYS_LIST_HREF = '/backend/api-keys'

async function resolveApiKeyCauses(ctx: ExplainLoadContext, ids: string[]): Promise<ExplainCauseDetail[]> {
  const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
  const keyIds = normalizeExplainIds(ids, { uuidOnly: true })
  if (!organizationWhere || keyIds.length === 0) return []
  const keys = await findWithDecryption(
    ctx.em,
    ApiKey,
    { id: { $in: keyIds }, tenantId: ctx.scope.tenantId, ...organizationWhere },
    undefined,
    resolveExplainDecryptionScope(ctx.scope),
  )
  return keys.map((key) => ({
    kind: 'api_key',
    id: key.id,
    label: key.name || key.keyPrefix,
    href: key.deletedAt ? null : API_KEYS_LIST_HREF,
    organizationId: key.organizationId ?? null,
  }))
}

export const explainConfig = defineExplainConfig({
  version: 1,
  causeResolvers: [
    {
      kind: 'api_key',
      requiredFeatures: ['api_keys.view'],
      resolve: (ctx, ids) =>
        runExplainResolverSafely(
          { module: 'api_keys', code: 'api_keys.insights_cause_failed', kind: 'api_key' },
          () => resolveApiKeyCauses(ctx, ids),
        ),
    },
  ],
})

export default explainConfig
