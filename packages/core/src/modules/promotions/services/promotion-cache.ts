import type { EntityManager } from '@mikro-orm/postgresql'
import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  Benefit,
  Promotion,
  Rule,
  RuleGroup,
  type PromotionBenefitAppliesTo,
  type PromotionRuleGroupOperator,
} from '../data/entities'
import type {
  NormalizedBenefit,
  NormalizedPromotion,
  NormalizedRule,
  NormalizedRuleGroup,
} from '../lib/types'

// SPEC-055 §Cache Build Contract + §Normalized Promotion Shape. This file is the ONLY
// place in the module that builds `NormalizedPromotion[]` from the database — the pure
// evaluation pipeline (`lib/evaluation-engine.ts` and friends) never touches the
// EntityManager, only ever receives the plain objects this file produces.

// ---------------------------------------------------------------------------
// Cache keys
// ---------------------------------------------------------------------------

// Literal format pinned by SPEC-055 §Evaluation Engine Data Flow pseudocode
// (`key: promotions:active:{tenantId}:{organizationId}`). Key and tag share the same
// value intentionally (one tree cache entry per tenant/org, mirrors
// `inbox_ops/lib/cache.ts`'s COUNTS/SETTINGS keys) so invalidation never needs a
// separate tag registry.
export function buildPromotionTreeCacheKey(tenantId: string, organizationId: string): string {
  return `promotions:active:${tenantId}:${organizationId}`
}

// Not specified verbatim by the spec (only "a separate, small counters key" is
// required, §Cache Build Contract item 4) — scoped per-promotion, not per-tenant, so
// a `usage.registered`/`usage.reverted` event for one promotion only ever evicts that
// promotion's own counter, never the whole tenant's budget-capped set and never the
// (expensive-to-rebuild) main tree cache.
export function buildPromotionUsageCounterCacheKey(
  tenantId: string,
  organizationId: string,
  promotionId: string,
): string {
  return `promotions:usage-counter:${tenantId}:${organizationId}:${promotionId}`
}

const PROMOTION_TREE_CACHE_TTL_MS = 5 * 60 * 1000
const PROMOTION_USAGE_COUNTER_CACHE_TTL_MS = 5 * 60 * 1000

async function readPromotionCacheEntry<T>(
  cache: CacheStrategy,
  tenantId: string,
  key: string,
): Promise<T | null> {
  try {
    const value = await runWithCacheTenant(tenantId, () => cache.get(key))
    return value === null || value === undefined ? null : (value as T)
  } catch {
    return null
  }
}

async function writePromotionCacheEntry(
  cache: CacheStrategy,
  tenantId: string,
  key: string,
  value: unknown,
  tags: string[],
  ttlMs: number,
): Promise<void> {
  try {
    await runWithCacheTenant(tenantId, () => cache.set(key, value, { ttl: ttlMs, tags }))
  } catch {
    // Best-effort: a cache write failure must not fail the read it is backing.
  }
}

// The subscriber handlers below (and `subscribers/*.ts`, which just wire an event id to
// one of those handlers) call these two directly — they never build the tag string
// themselves, so the key format stays single-sourced here.
export async function invalidatePromotionTreeCache(
  cache: CacheStrategy | null | undefined,
  tenantId: string,
  organizationId: string,
): Promise<void> {
  if (!cache) return
  const tag = buildPromotionTreeCacheKey(tenantId, organizationId)
  await runWithCacheTenant(tenantId, () => cache.deleteByTags([tag]))
}

export async function invalidatePromotionUsageCounterCache(
  cache: CacheStrategy | null | undefined,
  tenantId: string,
  organizationId: string,
  promotionId: string,
): Promise<void> {
  if (!cache) return
  const tag = buildPromotionUsageCounterCacheKey(tenantId, organizationId, promotionId)
  await runWithCacheTenant(tenantId, () => cache.deleteByTags([tag]))
}

// ---------------------------------------------------------------------------
// Row shapes — the already-fetched, plain-object input to the pure normalization
// below. Field names mirror `data/entities.ts` exactly (camelCase entity properties).
// ---------------------------------------------------------------------------

export type PromotionCacheRow = {
  id: string
  name: string
  order: number
  cumulative: boolean
  tags: string[]
  excludedTags: string[]
  excludeFlags: Record<string, boolean>
  eligibleCurrencies: string[]
  startsAt: Date | null
  endsAt: Date | null
  maxBudget: string | null
  budgetCurrency: string | null
}

export type RuleGroupCacheRow = {
  id: string
  promotionId: string
  parentRuleGroupId: string | null
  operator: PromotionRuleGroupOperator
  sortOrder: number
}

export type RuleCacheRow = {
  ruleGroupId: string
  promotionId: string
  ruleType: string
  config: Record<string, unknown>
  sortOrder: number
}

export type BenefitCacheRow = {
  ruleGroupId: string
  promotionId: string
  benefitType: string
  appliesTo: PromotionBenefitAppliesTo
  config: Record<string, unknown>
  sortOrder: number
}

// ---------------------------------------------------------------------------
// Deep freeze (§Normalized Promotion Shape: "In non-production builds, objects are
// deep-frozen to detect accidental mutation")
// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

function freezeOutsideProduction<T>(value: T): T {
  return process.env.NODE_ENV === 'production' ? value : deepFreeze(value)
}

// ---------------------------------------------------------------------------
// Pure normalization / tree assembly — no EntityManager, no cache, fully testable
// without a database connection. Extracted per SPEC-055 Step 2.5's test requirement.
// ---------------------------------------------------------------------------

function buildNormalizedRuleGroup(
  groupId: string,
  groupsForPromotion: RuleGroupCacheRow[],
  rulesForPromotion: RuleCacheRow[],
  benefitsForPromotion: BenefitCacheRow[],
): NormalizedRuleGroup {
  const group = groupsForPromotion.find((candidate) => candidate.id === groupId)
  if (!group) {
    // §Cache Build Contract item 3: "Any missing eager-loaded relation is treated as a
    // critical bug." A child id referenced by `parentRuleGroupId` that was not fetched
    // in the same batch is exactly that — never silently produce an incomplete tree.
    throw new Error(`[internal] promotion cache build is missing rule group ${groupId}`)
  }

  const rules: NormalizedRule[] = rulesForPromotion
    .filter((rule) => rule.ruleGroupId === groupId)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((rule) => ({ type: rule.ruleType, config: rule.config }))

  const benefits: NormalizedBenefit[] = benefitsForPromotion
    .filter((benefit) => benefit.ruleGroupId === groupId)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((benefit) => ({ type: benefit.benefitType, appliesTo: benefit.appliesTo, config: benefit.config }))

  const children: NormalizedRuleGroup[] = groupsForPromotion
    .filter((candidate) => candidate.parentRuleGroupId === groupId)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((child) => buildNormalizedRuleGroup(child.id, groupsForPromotion, rulesForPromotion, benefitsForPromotion))

  return { operator: group.operator, rules, benefits, children }
}

/**
 * Pure tree assembly for a single promotion. Accepts the full fetched batch for every
 * rule-group/rule/benefit row (not pre-filtered per promotion) and narrows internally by
 * `promotionId` — the real service fetches these arrays once for a whole batch of active
 * promotions (§Cache Build Contract item 1: "a single cache build performs all required
 * database reads", not N+1 per promotion) and calls this function once per promotion.
 *
 * `totalDiscountGranted` is passed in already resolved — this function never reads
 * `promotion_usages` itself (§Cache Build Contract item 4: the counter lives in a
 * separate, small cache key the caller resolves independently).
 */
export function buildNormalizedPromotion(
  promotionRow: PromotionCacheRow,
  ruleGroupRows: RuleGroupCacheRow[],
  ruleRows: RuleCacheRow[],
  benefitRows: BenefitCacheRow[],
  totalDiscountGranted: string,
): NormalizedPromotion {
  const groupsForPromotion = ruleGroupRows.filter((group) => group.promotionId === promotionRow.id)
  const rulesForPromotion = ruleRows.filter((rule) => rule.promotionId === promotionRow.id)
  const benefitsForPromotion = benefitRows.filter((benefit) => benefit.promotionId === promotionRow.id)

  const root = groupsForPromotion.find((group) => group.parentRuleGroupId === null)
  if (!root) {
    throw new Error(
      `[internal] promotion cache build is missing the root rule group for promotion ${promotionRow.id}`,
    )
  }

  // §Cache Build Contract item 3: a rule/benefit whose owning `ruleGroupId` was not
  // among the batch-fetched groups is exactly the "missing eager-loaded relation"
  // scenario — never silently drop it from the tree.
  const groupIdsForPromotion = new Set(groupsForPromotion.map((group) => group.id))
  for (const rule of rulesForPromotion) {
    if (!groupIdsForPromotion.has(rule.ruleGroupId)) {
      throw new Error(
        `[internal] promotion cache build is missing rule group ${rule.ruleGroupId} referenced by a rule for promotion ${promotionRow.id}`,
      )
    }
  }
  for (const benefit of benefitsForPromotion) {
    if (!groupIdsForPromotion.has(benefit.ruleGroupId)) {
      throw new Error(
        `[internal] promotion cache build is missing rule group ${benefit.ruleGroupId} referenced by a benefit for promotion ${promotionRow.id}`,
      )
    }
  }

  const normalized: NormalizedPromotion = {
    id: promotionRow.id,
    name: promotionRow.name,
    order: promotionRow.order,
    cumulative: promotionRow.cumulative,
    tags: [...promotionRow.tags],
    excludedTags: [...promotionRow.excludedTags],
    excludeFlags: { ...promotionRow.excludeFlags },
    eligibleCurrencies: [...promotionRow.eligibleCurrencies],
    startsAt: promotionRow.startsAt ? promotionRow.startsAt.toISOString() : null,
    endsAt: promotionRow.endsAt ? promotionRow.endsAt.toISOString() : null,
    maxBudget: promotionRow.maxBudget,
    budgetCurrency: promotionRow.budgetCurrency,
    totalDiscountGranted,
    rootGroup: buildNormalizedRuleGroup(root.id, groupsForPromotion, rulesForPromotion, benefitsForPromotion),
  }

  return freezeOutsideProduction(normalized)
}

// ---------------------------------------------------------------------------
// Cache-backed service — the only place in this module that ever queries the
// database for the evaluation engine's input (§Cache Build Contract item 2).
// ---------------------------------------------------------------------------

export type PromotionCacheContainer = {
  resolve: <T = unknown>(name: string) => T
}

function resolvePromotionCacheStrategy(container: PromotionCacheContainer): CacheStrategy | null {
  try {
    return container.resolve<CacheStrategy>('cache') ?? null
  } catch {
    return null
  }
}

function resolvePromotionEm(container: PromotionCacheContainer): EntityManager {
  // Exact precedent: `commands/promotions.ts` resolves/forks the same way —
  // `(ctx.container.resolve('em') as EntityManager).fork()` — before any read/write.
  return (container.resolve<EntityManager>('em')).fork()
}

export class PromotionCacheService {
  constructor(private readonly container: PromotionCacheContainer) {}

  async getActivePromotions(tenantId: string, organizationId: string): Promise<NormalizedPromotion[]> {
    const cache = resolvePromotionCacheStrategy(this.container)
    const treeKey = buildPromotionTreeCacheKey(tenantId, organizationId)

    let promotions = cache ? await readPromotionCacheEntry<NormalizedPromotion[]>(cache, tenantId, treeKey) : null
    if (!promotions) {
      promotions = await this.buildActivePromotionTrees(tenantId, organizationId)
      if (cache) {
        await writePromotionCacheEntry(cache, tenantId, treeKey, promotions, [treeKey], PROMOTION_TREE_CACHE_TTL_MS)
      }
    }

    return Promise.all(
      promotions.map((promotion) => this.overlayUsageCounter(promotion, tenantId, organizationId)),
    )
  }

  // §Cache Build Contract item 4: "read only for budget-capped promotions" — an
  // uncapped promotion's `totalDiscountGranted` is never read back from
  // `promotion_usages`, it stays the inert '0' baked into the tree cache.
  private async overlayUsageCounter(
    promotion: NormalizedPromotion,
    tenantId: string,
    organizationId: string,
  ): Promise<NormalizedPromotion> {
    if (promotion.maxBudget === null) return promotion
    const totalDiscountGranted = await this.getUsageCounter(
      promotion.id,
      tenantId,
      organizationId,
      promotion.budgetCurrency,
    )
    return freezeOutsideProduction({ ...promotion, totalDiscountGranted })
  }

  private async getUsageCounter(
    promotionId: string,
    tenantId: string,
    organizationId: string,
    budgetCurrency: string | null,
  ): Promise<string> {
    const cache = resolvePromotionCacheStrategy(this.container)
    const key = buildPromotionUsageCounterCacheKey(tenantId, organizationId, promotionId)

    if (cache) {
      const cached = await readPromotionCacheEntry<string>(cache, tenantId, key)
      if (cached !== null) return cached
    }

    const total = await this.sumPromotionUsage(promotionId, tenantId, organizationId, budgetCurrency)

    if (cache) {
      await writePromotionCacheEntry(cache, tenantId, key, total, [key], PROMOTION_USAGE_COUNTER_CACHE_TTL_MS)
    }

    return total
  }

  // §Cache Build Contract item 1 / §Promotion Usage Lifecycle: `SUM(total_discount_amount)
  // WHERE reverted_at IS NULL AND currency = budget_currency` — the same filter
  // `registerUsage`'s own re-read-sum uses.
  private async sumPromotionUsage(
    promotionId: string,
    tenantId: string,
    organizationId: string,
    budgetCurrency: string | null,
  ): Promise<string> {
    if (!budgetCurrency) return '0'
    const em = resolvePromotionEm(this.container)
    const rows = (await em.getConnection().execute(
      `SELECT COALESCE(SUM(total_discount_amount), 0)::text AS total
       FROM promotion_usages
       WHERE promotion_id = ? AND organization_id = ? AND tenant_id = ? AND currency = ? AND reverted_at IS NULL`,
      [promotionId, organizationId, tenantId, budgetCurrency],
    )) as Array<{ total: string }>
    return rows[0]?.total ?? '0'
  }

  // §Cache Build Contract item 1: one query pass for the whole batch of active
  // promotions — every `RuleGroup`/`Rule`/`Benefit` row for them is fetched in three
  // fixed queries (run in parallel), never per-promotion.
  private async buildActivePromotionTrees(
    tenantId: string,
    organizationId: string,
  ): Promise<NormalizedPromotion[]> {
    const em = resolvePromotionEm(this.container)

    // §Cache Build Contract (rev R-H3b/P8): every `active = true` promotion, regardless
    // of `starts_at`/`ends_at` — date-window filtering happens only inside the evaluator
    // (`lib/evaluation-engine.ts`'s `isPromotionEligible`), never here.
    const promotionEntities = await em.find(
      Promotion,
      { tenantId, organizationId, active: true, deletedAt: null },
      // `lib/evaluation-engine.ts` documents that the cache is responsible for ordering
      // by `order ASC, id ASC` before evaluation ever sees the array.
      { orderBy: { order: 'asc', id: 'asc' } },
    )
    if (promotionEntities.length === 0) return []

    const promotionIds = promotionEntities.map((promotion) => promotion.id)

    const [ruleGroupEntities, ruleEntities, benefitEntities] = await Promise.all([
      em.find(RuleGroup, { tenantId, organizationId, promotionId: { $in: promotionIds } }),
      em.find(Rule, { tenantId, organizationId, promotionId: { $in: promotionIds } }),
      em.find(Benefit, { tenantId, organizationId, promotionId: { $in: promotionIds } }),
    ])

    const ruleGroupRows: RuleGroupCacheRow[] = ruleGroupEntities.map((group) => ({
      id: group.id,
      promotionId: group.promotionId,
      parentRuleGroupId: group.parentRuleGroupId ?? null,
      operator: group.operator,
      sortOrder: group.sortOrder,
    }))
    const ruleRows: RuleCacheRow[] = ruleEntities.map((rule) => ({
      ruleGroupId: rule.ruleGroupId,
      promotionId: rule.promotionId,
      ruleType: rule.ruleType,
      config: rule.config,
      sortOrder: rule.sortOrder,
    }))
    const benefitRows: BenefitCacheRow[] = benefitEntities.map((benefit) => ({
      ruleGroupId: benefit.ruleGroupId,
      promotionId: benefit.promotionId,
      benefitType: benefit.benefitType,
      appliesTo: benefit.appliesTo,
      config: benefit.config,
      sortOrder: benefit.sortOrder,
    }))

    return promotionEntities.map((promotion) => {
      const row: PromotionCacheRow = {
        id: promotion.id,
        name: promotion.name,
        order: promotion.order,
        cumulative: promotion.cumulative,
        tags: promotion.tags,
        excludedTags: promotion.excludedTags,
        excludeFlags: promotion.excludeFlags,
        eligibleCurrencies: promotion.eligibleCurrencies,
        startsAt: promotion.startsAt ?? null,
        endsAt: promotion.endsAt ?? null,
        maxBudget: promotion.maxBudget ?? null,
        budgetCurrency: promotion.budgetCurrency ?? null,
      }
      // Placeholder — `getActivePromotions` overlays the real snapshot for
      // budget-capped promotions from the separate counters cache key right after this
      // method returns (§Cache Build Contract item 4). Never read directly from the
      // tree cache for a budget decision.
      return buildNormalizedPromotion(row, ruleGroupRows, ruleRows, benefitRows, '0')
    })
  }
}

// ---------------------------------------------------------------------------
// Subscriber glue (`subscribers/*.ts` — ephemeral cache-invalidation handlers).
// Kept here, not in `subscribers/` itself: every file under a module's `subscribers/`
// folder is auto-discovered as a subscriber definition by `yarn generate` (it is scanned
// unconditionally, with no `metadata` export treated as a critical bug further down the
// pipeline, not as "skip this file") — mirrors `ecommerce/lib/cacheInvalidation.ts`
// shared by that module's own `subscribers/*-cache-invalidation.ts` files.
// ---------------------------------------------------------------------------

export type PromotionsSubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  tenantId?: string | null
  organizationId?: string | null
}

const subscriberLogger = createLogger('promotions').child({ component: 'cache' })

function readSubscriberEventScope(
  payload: unknown,
  ctx: PromotionsSubscriberContext,
): { tenantId: string | null; organizationId: string | null } {
  const data = (payload ?? {}) as Record<string, unknown>
  const tenantId =
    typeof data.tenantId === 'string' && data.tenantId.length > 0 ? data.tenantId : ctx.tenantId ?? null
  const organizationId =
    typeof data.organizationId === 'string' && data.organizationId.length > 0
      ? data.organizationId
      : ctx.organizationId ?? null
  return { tenantId, organizationId }
}

function readPromotionIdFromUsagePayload(payload: unknown): string | null {
  const data = (payload ?? {}) as Record<string, unknown>
  return typeof data.promotionId === 'string' && data.promotionId.length > 0 ? data.promotionId : null
}

function resolveSubscriberCache(ctx: PromotionsSubscriberContext): CacheStrategy | null {
  try {
    return ctx.resolve<CacheStrategy>('cache') ?? null
  } catch {
    return null
  }
}

// §Cache Build Contract item 5: the main tree cache is invalidated ONLY by promotion/
// code mutation events (`promotions.promotion.created|updated|deleted`,
// `promotions.code.created|updated|deleted`) — never by a usage event. Wired to those
// six exact event ids (not a `promotions.promotion.*`/`promotions.code.*` wildcard) so
// the lifecycle events declared alongside them in `events.ts`
// (`promotions.promotion.budget_exhausted`/`.expiring_soon`, `promotions.code.used`/
// `.exhausted`) never trigger a rebuild they were not asked to.
export async function handlePromotionTreeCacheInvalidation(
  payload: unknown,
  ctx: PromotionsSubscriberContext,
): Promise<void> {
  const { tenantId, organizationId } = readSubscriberEventScope(payload, ctx)
  if (!tenantId || !organizationId) return
  const cache = resolveSubscriberCache(ctx)
  if (!cache) return
  try {
    await invalidatePromotionTreeCache(cache, tenantId, organizationId)
  } catch (err) {
    subscriberLogger.warn('[internal] promotion tree cache invalidation failed', { tenantId, organizationId, err })
  }
}

// §Cache Build Contract item 4/5: `promotions.usage.registered`/`.reverted` evict only
// the one promotion's small counters-key entry, never the main tree cache.
export async function handlePromotionUsageCounterCacheInvalidation(
  payload: unknown,
  ctx: PromotionsSubscriberContext,
): Promise<void> {
  const { tenantId, organizationId } = readSubscriberEventScope(payload, ctx)
  const promotionId = readPromotionIdFromUsagePayload(payload)
  if (!tenantId || !organizationId || !promotionId) return
  const cache = resolveSubscriberCache(ctx)
  if (!cache) return
  try {
    await invalidatePromotionUsageCounterCache(cache, tenantId, organizationId, promotionId)
  } catch (err) {
    subscriberLogger.warn('[internal] promotion usage counter cache invalidation failed', {
      tenantId,
      organizationId,
      promotionId,
      err,
    })
  }
}
