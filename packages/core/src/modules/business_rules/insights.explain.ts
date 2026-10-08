import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { defineExplainConfig } from '@open-mercato/shared/modules/insights/explain'
import type { ExplainCauseDetail, ExplainLoadContext } from '@open-mercato/shared/modules/insights/explain'
import {
  normalizeExplainIds,
  resolveExplainDecryptionScope,
  resolveExplainOrganizationWhere,
  runExplainResolverSafely,
} from '@open-mercato/shared/modules/insights/helpers'
import { BusinessRule } from './data/entities'

async function resolveBusinessRuleCauses(ctx: ExplainLoadContext, ids: string[]): Promise<ExplainCauseDetail[]> {
  const organizationWhere = resolveExplainOrganizationWhere(ctx.scope)
  const ruleIds = normalizeExplainIds(ids, { uuidOnly: true })
  if (!organizationWhere || ruleIds.length === 0) return []
  const rules = await findWithDecryption(
    ctx.em,
    BusinessRule,
    { id: { $in: ruleIds }, tenantId: ctx.scope.tenantId, ...organizationWhere },
    undefined,
    resolveExplainDecryptionScope(ctx.scope),
  )
  return rules.map((rule) => ({
    kind: 'business_rule',
    id: rule.id,
    label: rule.ruleName || rule.ruleId,
    href: rule.deletedAt ? null : `/backend/rules/${encodeURIComponent(rule.id)}`,
    organizationId: rule.organizationId,
  }))
}

export const explainConfig = defineExplainConfig({
  version: 1,
  causeResolvers: [
    {
      kind: 'business_rule',
      requiredFeatures: ['business_rules.view'],
      resolve: (ctx, ids) =>
        runExplainResolverSafely(
          { module: 'business_rules', code: 'business_rules.insights_cause_failed', kind: 'business_rule' },
          () => resolveBusinessRuleCauses(ctx, ids),
        ),
    },
  ],
})

export default explainConfig
