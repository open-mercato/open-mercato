import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import type { PlannerAvailabilityRule, PlannerAvailabilityRuleSet } from '../data/entities'

function buildCrudEvents<TEntity>(entity: string): CrudEventsConfig<TEntity> {
  return {
    module: 'planner',
    entity,
    persistent: true,
    buildPayload: (ctx) => ({
      id: ctx.identifiers.id,
      organizationId: ctx.identifiers.organizationId,
      tenantId: ctx.identifiers.tenantId,
    }),
  }
}

export const plannerAvailabilityRuleCrudEvents = buildCrudEvents<PlannerAvailabilityRule>('availability_rule')
export const plannerAvailabilityRuleSetCrudEvents = buildCrudEvents<PlannerAvailabilityRuleSet>('availability_rule_set')
