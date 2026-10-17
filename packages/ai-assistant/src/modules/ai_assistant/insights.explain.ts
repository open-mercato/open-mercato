import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { defineExplainConfig } from '@open-mercato/shared/modules/insights/explain'
import type { ExplainCauseDetail, ExplainLoadContext } from '@open-mercato/shared/modules/insights/explain'
import {
  normalizeExplainIds,
  resolveExplainDecryptionScope,
  resolveExplainNullableOrganizationWhere,
  runExplainResolverSafely,
} from '@open-mercato/shared/modules/insights/helpers'
import { AiPendingAction } from './data/entities'

const AI_ASSISTANT_VIEW_FEATURE = 'ai_assistant.view'
const CAUSE_FAILURE_CODE = 'ai_assistant.insights_cause_failed'

function resolvePendingActionLabel(action: AiPendingAction): string {
  const agentId = action.agentId?.trim() ?? ''
  const toolName = action.toolName?.trim() ?? ''
  if (agentId && toolName) return `${agentId} / ${toolName}`
  return toolName || agentId || action.id
}

async function resolvePendingActionCauses(ctx: ExplainLoadContext, ids: string[]): Promise<ExplainCauseDetail[]> {
  const organizationWhere = resolveExplainNullableOrganizationWhere(ctx.scope)
  const actionIds = normalizeExplainIds(ids, { uuidOnly: true })
  if (!organizationWhere || actionIds.length === 0) return []
  const actions = await findWithDecryption(
    ctx.em,
    AiPendingAction,
    { id: { $in: actionIds }, tenantId: ctx.scope.tenantId, ...organizationWhere },
    undefined,
    resolveExplainDecryptionScope(ctx.scope),
  )
  return actions.map((action) => ({
    kind: 'ai_action',
    id: action.id,
    label: resolvePendingActionLabel(action),
    href: null,
    organizationId: action.organizationId ?? null,
  }))
}

function buildToolCauses(ids: string[]): ExplainCauseDetail[] {
  return normalizeExplainIds(ids).map((toolName) => ({
    kind: 'ai_tool',
    id: toolName,
    label: toolName,
    href: null,
    organizationId: null,
  }))
}

export const explainConfig = defineExplainConfig({
  version: 1,
  causeResolvers: [
    {
      kind: 'ai_action',
      requiredFeatures: [AI_ASSISTANT_VIEW_FEATURE],
      resolve: (ctx, ids) =>
        runExplainResolverSafely(
          { module: 'ai_assistant', code: CAUSE_FAILURE_CODE, kind: 'ai_action' },
          () => resolvePendingActionCauses(ctx, ids),
        ),
    },
    {
      kind: 'ai_tool',
      requiredFeatures: [AI_ASSISTANT_VIEW_FEATURE],
      resolve: (_ctx, ids) =>
        runExplainResolverSafely(
          { module: 'ai_assistant', code: CAUSE_FAILURE_CODE, kind: 'ai_tool' },
          async () => buildToolCauses(ids),
        ),
    },
  ],
})

export default explainConfig
