import { randomUUID } from 'crypto'
import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import {
  enforceCommandOptimisticLockWithGuards,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, isCrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import {
  Benefit,
  Code,
  Promotion,
  Rule,
  RuleGroup,
  type PromotionBenefitAppliesTo,
  type PromotionRuleGroupOperator,
} from '../data/entities'
import { assertPromotionScopeOrNotFound } from './shared'
import {
  assertPromotionCurrencyRequirements,
  promotionOrderBatchSchema,
  promotionTreeUpdateSchema,
  type BenefitInput,
  type PromotionOrderBatchInput,
  type RuleGroupTreeNodeInput,
  type RuleInput,
} from '../data/validators'

// §API Contracts "Admin CRUD" (rev — optimistic locking, completeness gap): the tree PUT
// and the order PATCH each protect the `Promotion` aggregate directly, independently of
// the row-level `updatedAt` header `CrudForm` sends for plain metadata PUTs. Both commands
// below share this resource kind so the guard/lock plumbing (`OM_OPTIMISTIC_LOCK` allow-list,
// the conflict-bar copy) treats them identically to `promotions.promotion.update`.
// `commands/promotions.ts` does not export an equivalent constant, so this is this file's
// own copy rather than a cross-file import (Step 1.4 is scoped to this file only).
export const PROMOTION_RESOURCE_KIND = 'promotions.promotion'
const PROMOTION_ENTITY_ID = E.promotions.promotion

export const RULE_TREE_RECONCILE_COMMAND_ID = 'promotions.rule_tree.reconcile'
export const PROMOTION_REORDER_COMMAND_ID = 'promotions.promotion.reorder'

// This file is scoped to the whole-tree PUT (`promotions.rule_tree.reconcile`) per the
// spec's Architecture file tree ("commands/rule-tree.ts — Atomic rule group tree
// mutations") and the File Manifest ("Atomic tree reconciliation"). The drag-sort order
// PATCH (`promotions.promotion.reorder`) is co-located here rather than in a third file
// because Step 1.4's file list is `commands/rule-tree.ts` + the two route files only — it
// is not itself a rule-tree concern, but it is this step's other optimistic-lock-guarded
// write path and has nowhere else to live without adding a file outside that list.

const promotionCrudEvents: CrudEventsConfig<Promotion> = {
  module: 'promotions',
  entity: 'promotion',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const promotionCrudIndexer: CrudIndexerConfig<Promotion> = {
  entityType: PROMOTION_ENTITY_ID,
}

function getPromotionIdentifiers(promotion: Promotion) {
  return {
    id: promotion.id,
    organizationId: promotion.organizationId,
    tenantId: promotion.tenantId,
  }
}

async function loadScopedPromotion(em: EntityManager, id: string): Promise<Promotion | null> {
  return em.findOne(Promotion, { id, deletedAt: null })
}

function throwZodAsUnprocessable(err: unknown): never {
  if (err instanceof z.ZodError) {
    throw new CrudHttpError(422, {
      error: '[internal] rule tree validation failed',
      issues: err.issues,
    })
  }
  throw err
}

// ---------------------------------------------------------------------------
// `promotions.rule_tree.reconcile` — PUT /api/promotions/[id]/tree
// ---------------------------------------------------------------------------

// `promotionTreeUpdateSchema` (Step 1.2) carries `{ updatedAt, root }`; the command also
// needs `promotionId` to know which aggregate it is replacing the tree for — the route
// supplies that from the `[id]` path segment, not from the body.
const ruleTreeReconcileInputSchema = z.object({ promotionId: z.string().uuid() }).merge(promotionTreeUpdateSchema)

export type RuleTreeReconcileInput = z.infer<typeof ruleTreeReconcileInputSchema>

const ruleTreeReconcileOutputSchema = z.object({ promotionId: z.string().uuid() })

type FlattenedTreeContent = { rules: RuleInput[]; benefits: BenefitInput[] }

// §Data Models "Quantity caps" / D-R4-27 read the WHOLE tree, not just the root group's
// own rules/benefits — a currency-sensitive rule or benefit nested three levels deep still
// forces the single-eligible-currency requirement.
function flattenTreeContent(node: RuleGroupTreeNodeInput): FlattenedTreeContent {
  const rules = [...node.rules]
  const benefits = [...node.benefits]
  for (const child of node.children) {
    const nested = flattenTreeContent(child)
    rules.push(...nested.rules)
    benefits.push(...nested.benefits)
  }
  return { rules, benefits }
}

type ExistingTree = {
  groups: Map<string, RuleGroup>
  rules: Map<string, Rule>
  benefits: Map<string, Benefit>
}

async function loadExistingTree(
  em: EntityManager,
  promotion: Promotion,
): Promise<ExistingTree> {
  const scopeFilter = { promotionId: promotion.id, tenantId: promotion.tenantId, organizationId: promotion.organizationId }
  const [groups, rules, benefits] = await Promise.all([
    em.find(RuleGroup, scopeFilter),
    em.find(Rule, scopeFilter),
    em.find(Benefit, scopeFilter),
  ])
  return {
    groups: new Map(groups.map((group) => [group.id, group])),
    rules: new Map(rules.map((rule) => [rule.id, rule])),
    benefits: new Map(benefits.map((benefit) => [benefit.id, benefit])),
  }
}

type PlannedGroup = {
  id: string
  parentRuleGroupId: string | null
  operator: PromotionRuleGroupOperator
  sortOrder: number
  depth: number
}
type PlannedRule = { id: string; ruleGroupId: string; ruleType: string; config: Record<string, unknown>; sortOrder: number }
type PlannedBenefit = {
  id: string
  ruleGroupId: string
  benefitType: string
  appliesTo: PromotionBenefitAppliesTo
  config: Record<string, unknown>
  sortOrder: number
}

type TreePlan = {
  groups: PlannedGroup[]
  rules: PlannedRule[]
  benefits: PlannedBenefit[]
  visitedGroupIds: Set<string>
  visitedRuleIds: Set<string>
  visitedBenefitIds: Set<string>
}

function createEmptyPlan(): TreePlan {
  return {
    groups: [],
    rules: [],
    benefits: [],
    visitedGroupIds: new Set(),
    visitedRuleIds: new Set(),
    visitedBenefitIds: new Set(),
  }
}

// Walks the incoming (already-validated) tree and plans the end state. Every node either
// carries an existing `id` (update in place) or none (create with a freshly minted id) —
// the root is the one exception: its id is always the promotion's existing root group,
// identified by `parentRuleGroupId IS NULL` (§Data Models rev W5a), never by the client.
// Ids are minted here (not left to the DB's `defaultRaw`) so every child's FK value is a
// known literal before any row is persisted — the same `id: randomUUID()` convention
// `appendClaimEvent` (`warranty_claims/commands/shared.ts`) uses to avoid a flush
// round-trip between parent and child inserts. `depth` (root = 0) drives the write
// phase's level-by-level ordering below — see the comment on `withAtomicFlush` ordering.
function planRuleGroupTree(
  node: RuleGroupTreeNodeInput,
  parentRuleGroupId: string | null,
  rootGroupId: string,
  depth: number,
  plan: TreePlan,
): void {
  const isRoot = parentRuleGroupId === null
  if (isRoot && node.id && node.id !== rootGroupId) {
    throw new CrudHttpError(422, {
      error: '[internal] root rule group id does not match the promotion\'s existing root group',
    })
  }
  const groupId = isRoot ? rootGroupId : node.id ?? randomUUID()

  plan.groups.push({ id: groupId, parentRuleGroupId, operator: node.operator, sortOrder: node.sortOrder, depth })
  plan.visitedGroupIds.add(groupId)

  for (const rule of node.rules) {
    const ruleId = rule.id ?? randomUUID()
    plan.rules.push({
      id: ruleId,
      ruleGroupId: groupId,
      ruleType: rule.ruleType,
      config: rule.config as Record<string, unknown>,
      sortOrder: rule.sortOrder,
    })
    plan.visitedRuleIds.add(ruleId)
  }

  for (const benefit of node.benefits) {
    const benefitId = benefit.id ?? randomUUID()
    plan.benefits.push({
      id: benefitId,
      ruleGroupId: groupId,
      benefitType: benefit.benefitType,
      appliesTo: benefit.appliesTo as PromotionBenefitAppliesTo,
      config: benefit.config as Record<string, unknown>,
      sortOrder: benefit.sortOrder,
    })
    plan.visitedBenefitIds.add(benefitId)
  }

  for (const child of node.children) {
    planRuleGroupTree(child, groupId, rootGroupId, depth + 1, plan)
  }
}

// `codeId` is "application-layer validated... in commands before persist" (§Data Models
// `Rule` table, `code` row) — the zod schema only checks shape (a well-formed uuid), not
// that the row exists. This is the first (and so far only) write path for the `code` rule
// type, so this command owns the referential check.
async function assertCodeRuleReferencesExist(
  em: EntityManager,
  promotion: Promotion,
  rules: RuleInput[],
): Promise<void> {
  const codeIds = Array.from(
    new Set(
      rules
        .filter((rule) => rule.ruleType === 'code')
        .map((rule) => (rule.config as { codeId: string }).codeId),
    ),
  )
  if (codeIds.length === 0) return

  const existing = await em.find(Code, {
    id: { $in: codeIds },
    tenantId: promotion.tenantId,
    organizationId: promotion.organizationId,
    deletedAt: null,
  })
  const existingIds = new Set(existing.map((code) => code.id))
  const missing = codeIds.filter((id) => !existingIds.has(id))
  if (missing.length > 0) {
    throw new CrudHttpError(422, {
      error: '[internal] one or more code rules reference a promotion code that does not exist',
      missingCodeIds: missing,
    })
  }
}

const reconcileRuleTreeCommand: CommandHandler<RuleTreeReconcileInput, { promotionId: string }> = {
  id: RULE_TREE_RECONCILE_COMMAND_ID,
  outputSchema: ruleTreeReconcileOutputSchema,
  async execute(rawInput, ctx) {
    let parsed: RuleTreeReconcileInput
    try {
      parsed = ruleTreeReconcileInputSchema.parse(rawInput)
    } catch (err) {
      throwZodAsUnprocessable(err)
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const promotion = await loadScopedPromotion(em, parsed.promotionId)
    if (!promotion) throw notFound('Promotion not found')
    assertPromotionScopeOrNotFound(ctx, promotion)

    // §API Contracts: the tree PUT's `updatedAt` is a separate surface from the row-level
    // header `CrudForm` sends for plain metadata edits — the client supplies it as a typed
    // body field, so it is passed as `expected` rather than left to the request-header path.
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: PROMOTION_RESOURCE_KIND,
      resourceId: promotion.id,
      current: promotion.updatedAt,
      expected: parsed.updatedAt,
      request: ctx.request ?? null,
    })

    const { rules: allRules, benefits: allBenefits } = flattenTreeContent(parsed.root)

    try {
      assertPromotionCurrencyRequirements({
        eligibleCurrencies: promotion.eligibleCurrencies,
        rules: allRules.map((rule) => ({ ruleType: rule.ruleType })),
        benefits: allBenefits.map((benefit) => ({ benefitType: benefit.benefitType, config: benefit.config as { discountType?: string } })),
      })
    } catch (err) {
      throwZodAsUnprocessable(err)
    }

    await assertCodeRuleReferencesExist(em, promotion, allRules)

    const existing = await loadExistingTree(em, promotion)

    // Root group is identified by `parentRuleGroupId IS NULL`, never by
    // `Promotion.ruleGroupId` (§Data Models rev W5a) — see the class comment on
    // `Promotion` in `data/entities.ts`.
    const rootGroup = [...existing.groups.values()].find((group) => group.parentRuleGroupId == null)
    if (!rootGroup) {
      throw new CrudHttpError(500, { error: '[internal] promotion is missing its root rule group' })
    }

    const plan = createEmptyPlan()
    planRuleGroupTree(parsed.root, null, rootGroup.id, 0, plan)

    // Deletions: a removed group cascades to its descendant groups/rules/benefits at the
    // DB level (`deleteRule: 'cascade'` on every FK in `data/entities.ts`), so only
    // TOP-LEVEL removed groups (whose parent survives) need an explicit delete. Rules and
    // benefits removed from a GROUP THAT STILL EXISTS need an explicit delete of their own
    // — they are not covered by any cascade.
    //
    // Ordering hazard this guards against: a "top-level removed" group can still have a
    // SURVIVING descendant that moved elsewhere in the new tree (reparented, not deleted).
    // If that removed group were deleted while the DB still shows the survivor pointing at
    // it, `ON DELETE CASCADE` would wipe out the survivor too. So every surviving node's
    // `parentRuleGroupId`/`ruleGroupId` is repointed to its NEW parent FIRST (detaching it
    // from whatever removed group it used to live under); only once every survivor is
    // detached is it safe to delete the removed groups and let cascade sweep only the
    // genuinely-removed descendants underneath them.
    const removedGroupIds = new Set(
      [...existing.groups.keys()].filter((id) => !plan.visitedGroupIds.has(id)),
    )
    const topLevelRemovedGroups = [...removedGroupIds]
      .map((id) => existing.groups.get(id)!)
      .filter((group) => {
        const parentId = group.parentRuleGroupId ?? null
        return parentId === null || !removedGroupIds.has(parentId)
      })
    const removedRules = [...existing.rules.values()].filter(
      (rule) => !plan.visitedRuleIds.has(rule.id) && !removedGroupIds.has(rule.ruleGroupId),
    )
    const removedBenefits = [...existing.benefits.values()].filter(
      (benefit) => !plan.visitedBenefitIds.has(benefit.id) && !removedGroupIds.has(benefit.ruleGroupId),
    )

    // Groups are created/updated one tree-depth level at a time (root first) so a child
    // group's `parentRuleGroupId` always names a parent row that is already persisted —
    // this does not rely on the ORM inferring a dependency order from a raw-scalar
    // `mapToPk` FK across new rows in a single flush. Rules/benefits only ever reference a
    // group, never each other, so they settle in one phase once every group phase is done.
    const maxDepth = plan.groups.reduce((max, group) => Math.max(max, group.depth), 0)
    const groupPhases: Array<() => void> = []
    for (let depth = 0; depth <= maxDepth; depth += 1) {
      groupPhases.push(() => {
        for (const plannedGroup of plan.groups) {
          if (plannedGroup.depth !== depth) continue
          const current = existing.groups.get(plannedGroup.id)
          if (current) {
            current.parentRuleGroupId = plannedGroup.parentRuleGroupId
            current.operator = plannedGroup.operator
            current.sortOrder = plannedGroup.sortOrder
          } else {
            em.persist(
              em.create(RuleGroup, {
                id: plannedGroup.id,
                organizationId: promotion.organizationId,
                tenantId: promotion.tenantId,
                promotionId: promotion.id,
                parentRuleGroupId: plannedGroup.parentRuleGroupId,
                operator: plannedGroup.operator,
                sortOrder: plannedGroup.sortOrder,
              }),
            )
          }
        }
      })
    }

    await withAtomicFlush(
      em,
      [
        ...groupPhases,
        () => {
          // Every surviving/new group is now persisted — rules and benefits can safely
          // settle on their (possibly new) `ruleGroupId`.
          for (const plannedRule of plan.rules) {
            const current = existing.rules.get(plannedRule.id)
            if (current) {
              current.ruleGroupId = plannedRule.ruleGroupId
              current.ruleType = plannedRule.ruleType
              current.config = plannedRule.config
              current.sortOrder = plannedRule.sortOrder
            } else {
              em.persist(
                em.create(Rule, {
                  id: plannedRule.id,
                  organizationId: promotion.organizationId,
                  tenantId: promotion.tenantId,
                  ruleGroupId: plannedRule.ruleGroupId,
                  promotionId: promotion.id,
                  ruleType: plannedRule.ruleType,
                  config: plannedRule.config,
                  sortOrder: plannedRule.sortOrder,
                }),
              )
            }
          }

          for (const plannedBenefit of plan.benefits) {
            const current = existing.benefits.get(plannedBenefit.id)
            if (current) {
              current.ruleGroupId = plannedBenefit.ruleGroupId
              current.benefitType = plannedBenefit.benefitType
              current.appliesTo = plannedBenefit.appliesTo
              current.config = plannedBenefit.config
              current.sortOrder = plannedBenefit.sortOrder
            } else {
              em.persist(
                em.create(Benefit, {
                  id: plannedBenefit.id,
                  organizationId: promotion.organizationId,
                  tenantId: promotion.tenantId,
                  ruleGroupId: plannedBenefit.ruleGroupId,
                  promotionId: promotion.id,
                  benefitType: plannedBenefit.benefitType,
                  appliesTo: plannedBenefit.appliesTo,
                  config: plannedBenefit.config,
                  sortOrder: plannedBenefit.sortOrder,
                }),
              )
            }
          }
        },
        () => {
          // Every survivor has now been detached from whatever removed group it used to
          // reference, so the remaining removed groups' cascade only sweeps genuinely
          // removed descendants. Lingering rules/benefits under a SURVIVING group (dropped
          // from that group's node, not moved) are not covered by any cascade and need
          // their own explicit removal.
          for (const group of topLevelRemovedGroups) em.remove(group)
          for (const rule of removedRules) em.remove(rule)
          for (const benefit of removedBenefits) em.remove(benefit)

          // Bump the promotion's own `updatedAt` so the next tree write (or order PATCH)
          // compares against the post-reconcile version.
          promotion.updatedAt = new Date()
        },
      ],
      { transaction: true, label: 'promotions.rule_tree.reconcile' },
    )

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: promotion,
      identifiers: getPromotionIdentifiers(promotion),
      events: promotionCrudEvents,
      indexer: promotionCrudIndexer,
    })

    return { promotionId: promotion.id }
  },
  // No undo: a full tree replace has no cheap single "before" snapshot to restore from
  // (it would mean recording and replaying every group/rule/benefit row this command
  // might touch), and the spec's Commands & Events table (§Architecture) does not list
  // an event or an undo expectation for this command — only the promotion CRUD commands
  // and the code commands are listed there. `buildLog` still records an audit entry (no
  // `payload.undo`), so the write is traceable even without being revertible from the
  // audit log UI.
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('promotions.audit.rule_tree.reconcile', 'Replace promotion rule tree'),
      resourceKind: PROMOTION_RESOURCE_KIND,
      resourceId: result.promotionId,
    }
  },
}

// ---------------------------------------------------------------------------
// `promotions.promotion.reorder` — PATCH /api/promotions/order
// ---------------------------------------------------------------------------

export type PromotionReorderConflict = { id: string; currentUpdatedAt: string }
export type PromotionReorderResult = { updated: string[]; conflicts: PromotionReorderConflict[] }

const promotionReorderOutputSchema = z.object({
  updated: z.array(z.string().uuid()),
  conflicts: z.array(z.object({ id: z.string().uuid(), currentUpdatedAt: z.string() })),
})

// §API Contracts: "a stale `updatedAt` on any item 409s that item only, not the whole
// batch." That is the opposite of `withAtomicFlush`'s all-or-nothing contract, so this
// command deliberately does NOT wrap the loop in one transaction — each item's write is
// flushed immediately after its own mutation (never leaving a pending scalar change across
// a later item's query on the same `EntityManager`), so one item's conflict can never roll
// back an already-committed sibling. The response shape (`{ updated, conflicts }`) is not
// specified by the spec text for this multi-item case — this is this command's own
// resolved choice, named to read naturally from the admin drag-sort UI.
const reorderPromotionsCommand: CommandHandler<PromotionOrderBatchInput, PromotionReorderResult> = {
  id: PROMOTION_REORDER_COMMAND_ID,
  outputSchema: promotionReorderOutputSchema,
  async execute(rawInput, ctx) {
    let parsed: PromotionOrderBatchInput
    try {
      parsed = promotionOrderBatchSchema.parse(rawInput)
    } catch (err) {
      throwZodAsUnprocessable(err)
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const updated: string[] = []
    const conflicts: PromotionReorderConflict[] = []

    for (const item of parsed.items) {
      const promotion = await loadScopedPromotion(em, item.id)
      if (!promotion) {
        // A promotion deleted between the admin UI loading the list and saving the
        // drag-sort order is the same "record changed under you" conflict as a stale
        // `updatedAt` — report it as a per-item conflict rather than letting it throw
        // past the loop, which would discard the result of every item already
        // committed above it.
        try {
          enforceRecordGoneIsConflict({
            resourceKind: PROMOTION_RESOURCE_KIND,
            resourceId: item.id,
            expected: item.updatedAt,
            request: ctx.request ?? null,
          })
        } catch (err) {
          if (isCrudHttpError(err) && err.status === 409) {
            conflicts.push({ id: item.id, currentUpdatedAt: item.updatedAt.toISOString() })
            continue
          }
          throw err
        }
        // Strictly additive guard above: with locking disabled it no-ops, so a plain
        // caller naming a since-deleted id simply sees that id missing from both arrays.
        continue
      }
      assertPromotionScopeOrNotFound(ctx, promotion)

      try {
        await enforceCommandOptimisticLockWithGuards(ctx.container, {
          resourceKind: PROMOTION_RESOURCE_KIND,
          resourceId: promotion.id,
          current: promotion.updatedAt,
          expected: item.updatedAt,
          request: ctx.request ?? null,
        })
      } catch (err) {
        if (isCrudHttpError(err) && err.status === 409) {
          conflicts.push({ id: item.id, currentUpdatedAt: promotion.updatedAt.toISOString() })
          continue
        }
        throw err
      }

      promotion.order = item.order
      await em.flush()
      updated.push(promotion.id)

      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: promotion,
        identifiers: getPromotionIdentifiers(promotion),
        events: promotionCrudEvents,
        indexer: promotionCrudIndexer,
      })
    }

    return { updated, conflicts }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('promotions.audit.promotion.reorder', 'Reorder promotions'),
      resourceKind: PROMOTION_RESOURCE_KIND,
      resourceId: result.updated[0] ?? null,
      payload: { updatedIds: result.updated, conflictIds: result.conflicts.map((conflict) => conflict.id) },
    }
  },
}

registerCommand(reconcileRuleTreeCommand)
registerCommand(reorderPromotionsCommand)

export { reconcileRuleTreeCommand, reorderPromotionsCommand }
