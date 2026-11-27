import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  CatalogProductCategoryAssignment,
  CatalogProductCategorySuggestion,
  type CatalogCategorySuggestionTrigger,
} from '../../data/entities'
import type { AiCategorizationSettings } from '../../data/validators'

const logger = createLogger('catalog')

const AUTO_APPLY_REQUIRED_FEATURE = 'catalog.products.manage'

const USER_STARTED_TRIGGERS: ReadonlySet<CatalogCategorySuggestionTrigger> = new Set(['manual', 'bulk'])

export type AutoApplyDecision =
  | { apply: true }
  | { apply: false; reason: 'mode_suggest' | 'trigger_not_user_started' | 'not_suggested' | 'below_threshold' | 'not_pending' }

type AutoApplyPermissionReason = 'missing_manage_permission'

export function decideAutoApply(params: {
  settings: Pick<AiCategorizationSettings, 'applyMode' | 'autoApplyThreshold'>
  trigger: CatalogCategorySuggestionTrigger
  suggestion: Pick<CatalogProductCategorySuggestion, 'outcome' | 'categoryId' | 'confidence' | 'status'>
}): AutoApplyDecision {
  const { settings, trigger, suggestion } = params
  if (settings.applyMode !== 'auto_apply') return { apply: false, reason: 'mode_suggest' }
  if (!USER_STARTED_TRIGGERS.has(trigger)) return { apply: false, reason: 'trigger_not_user_started' }
  if (suggestion.outcome !== 'suggested' || !suggestion.categoryId || suggestion.confidence == null) {
    return { apply: false, reason: 'not_suggested' }
  }
  if (suggestion.status !== 'pending') return { apply: false, reason: 'not_pending' }
  if (Number(suggestion.confidence) < settings.autoApplyThreshold) return { apply: false, reason: 'below_threshold' }
  return { apply: true }
}

export type AutoAppliedProduct = { id: string; categoryIds: string[]; updatedAt: string }

type SkippedReason = Extract<AutoApplyDecision, { apply: false }>['reason']

export type AutoApplyResult =
  | { applied: true; logEntry: unknown; product: AutoAppliedProduct | null }
  | { applied: false; reason: SkippedReason | AutoApplyPermissionReason | 'already_categorized' | 'accept_failed' }

async function initiatorMayManageProducts(params: {
  container: AwilixContainer
  suggestion: CatalogProductCategorySuggestion
  commandContext: CommandRuntimeContext
}): Promise<boolean> {
  const { container, suggestion, commandContext } = params
  const userId = commandContext.auth?.sub
  if (!userId) return false
  const rbacService = container.resolve('rbacService') as RbacService
  return rbacService.userHasAllFeatures(userId, [AUTO_APPLY_REQUIRED_FEATURE], {
    tenantId: suggestion.tenantId,
    organizationId: suggestion.organizationId,
  })
}

/**
 * Applies a freshly persisted suggestion through the accept command when the
 * tenant opted into `auto_apply` (spec D2). Only user-started triggers
 * (`manual`, `bulk`) ever apply; `on_create` runs never do. The initiating
 * user must currently hold `catalog.products.manage` (checked per call, so a
 * permission revoked while a bulk job waited stops applying). Never throws: any
 * failure, including a failed permission lookup, leaves the suggestion `pending` for human review.
 */
export async function maybeAutoApplySuggestion(params: {
  container: AwilixContainer
  em: EntityManager
  suggestion: CatalogProductCategorySuggestion
  trigger: CatalogCategorySuggestionTrigger
  settings: Pick<AiCategorizationSettings, 'applyMode' | 'autoApplyThreshold'>
  commandContext: CommandRuntimeContext
}): Promise<AutoApplyResult> {
  const { container, em, suggestion, trigger, settings, commandContext } = params
  const decision = decideAutoApply({ settings, trigger, suggestion })
  if (!decision.apply) return { applied: false, reason: decision.reason }

  const productId = typeof suggestion.product === 'string' ? suggestion.product : suggestion.product.id
  try {
    const actorMayManage = await initiatorMayManageProducts({ container, suggestion, commandContext })
    if (!actorMayManage) {
      logger.info('catalog.ai_categorization.auto_apply skipped: initiator lacks catalog.products.manage', {
        suggestionId: suggestion.id,
        productId,
        userId: commandContext.auth?.sub ?? null,
      })
      return { applied: false, reason: 'missing_manage_permission' }
    }
    const assignmentCount = await em.count(CatalogProductCategoryAssignment, {
      product: productId,
      tenantId: suggestion.tenantId,
      organizationId: suggestion.organizationId,
    })
    if (assignmentCount > 0) return { applied: false, reason: 'already_categorized' }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute('catalog.category_suggestions.accept', {
      input: { id: suggestion.id, autoApplied: true },
      ctx: commandContext,
    })
    const product = (result as { product?: AutoAppliedProduct } | undefined)?.product ?? null
    return { applied: true, logEntry, product }
  } catch (err) {
    if (isCrudHttpError(err) && err.body?.code === 'product_already_categorized') {
      return { applied: false, reason: 'already_categorized' }
    }
    logger.error('catalog.ai_categorization.auto_apply failed', { err, suggestionId: suggestion.id })
    getTelemetryRuntime()?.reportError(err, {
      module: 'catalog',
      code: 'catalog.ai_categorization_auto_apply_failed',
    })
    return { applied: false, reason: 'accept_failed' }
  }
}
