import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { buildFeatureNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'business_rules.rule.execution_failed',
  persistent: true,
  id: 'business_rules:rule-execution-failed-notification',
}

type RuleExecutionFailedPayload = {
  ruleId: string
  ruleName: string
  entityType?: string | null
  errorMessage?: string | null
  tenantId: string
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: RuleExecutionFailedPayload, ctx: ResolverContext) {
  try {
    const notificationService = resolveNotificationService(ctx)
    const typeDef = notificationTypes.find((type) => type.type === 'business_rules.rule.execution_failed')
    if (!typeDef) return

    const notificationInput = buildFeatureNotificationFromType(typeDef, {
      requiredFeature: 'business_rules.manage',
      bodyVariables: {
        ruleName: payload.ruleName,
        entityType: payload.entityType ?? '',
        errorMessage: payload.errorMessage ?? 'Unknown error',
      },
      sourceEntityType: 'business_rules:rule',
      sourceEntityId: payload.ruleId,
      linkHref: `/backend/business-rules/${payload.ruleId}`,
    })

    await notificationService.createForFeature(notificationInput, {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId ?? null,
    })
  } catch (err) {
    console.error('[business_rules:rule-execution-failed-notification] Failed to create notification:', err)
  }
}
