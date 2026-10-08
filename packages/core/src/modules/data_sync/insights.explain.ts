import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import { defineExplainConfig } from '@open-mercato/shared/modules/insights/explain'
import type { ExplainCauseDetail, ExplainLoadContext } from '@open-mercato/shared/modules/insights/explain'
import {
  normalizeExplainIds,
  resolveExplainDecryptionScope,
  resolveExplainOrganizationWhere,
  runExplainResolverSafely,
} from '@open-mercato/shared/modules/insights/helpers'
import { SyncRun } from './data/entities'

function resolveSyncRunLabel(run: SyncRun): string {
  const integrationTitle = getIntegration(run.integrationId)?.title || run.integrationId
  return run.entityType ? `${integrationTitle} (${run.entityType})` : integrationTitle
}

async function resolveSyncRunCauses(ctx: ExplainLoadContext, ids: string[]): Promise<ExplainCauseDetail[]> {
  const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
  const runIds = normalizeExplainIds(ids, { uuidOnly: true })
  if (!organizationWhere || runIds.length === 0) return []
  const runs = await findWithDecryption(
    ctx.em,
    SyncRun,
    { id: { $in: runIds }, tenantId: ctx.scope.tenantId, ...organizationWhere },
    undefined,
    resolveExplainDecryptionScope(ctx.scope),
  )
  return runs.map((run) => ({
    kind: 'sync_run',
    id: run.id,
    label: resolveSyncRunLabel(run),
    href: run.deletedAt ? null : `/backend/data-sync/runs/${encodeURIComponent(run.id)}`,
    organizationId: run.organizationId,
  }))
}

export const explainConfig = defineExplainConfig({
  version: 1,
  causeResolvers: [
    {
      kind: 'sync_run',
      requiredFeatures: ['data_sync.view'],
      resolve: (ctx, ids) =>
        runExplainResolverSafely(
          { module: 'data_sync', code: 'data_sync.insights_cause_failed', kind: 'sync_run' },
          () => resolveSyncRunCauses(ctx, ids),
        ),
    },
  ],
})

export default explainConfig
