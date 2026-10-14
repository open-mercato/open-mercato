import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { runCrudCommandWrite } from '@open-mercato/shared/lib/commands/runCrudCommandWrite'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { Promotion, RuleGroup } from '../data/entities'
import { assertPromotionScopeOrNotFound } from './shared'
import {
  promotionCreateSchema,
  promotionUpdateSchema,
  promotionDeleteSchema,
  type PromotionCreateInput,
  type PromotionUpdateInput,
  type PromotionDeleteInput,
} from '../data/validators'

// §Data Models (rev — W5a / Step 1.2 entity comment): `Promotion.ruleGroupId` is the
// NULLABLE side of the two-table creation cycle, `RuleGroup.promotionId` the NOT NULL
// side. `createPromotionCommand.execute` below breaks the cycle in that order: the
// `Promotion` row is created first with `ruleGroupId` left `null`, then its root
// `RuleGroup` is created with `promotionId` already set, then `Promotion.ruleGroupId`
// is updated to point at the new root — all inside one `withAtomicFlush` transaction.
// The root group is identified by `parentRuleGroupId IS NULL`, never by this pointer.

const PROMOTION_ENTITY_ID = E.promotions.promotion

const promotionCrudIndexer: CrudIndexerConfig<Promotion> = {
  entityType: PROMOTION_ENTITY_ID,
}

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

const promotionCommandOutputSchema = z.object({ promotionId: z.string().uuid() })

type PromotionSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  description: string | null
  order: number
  active: boolean
  startsAt: string | null
  endsAt: string | null
  cumulative: boolean
  tags: string[]
  excludedTags: string[]
  excludeFlags: Record<string, boolean>
  eligibleCurrencies: string[]
  maxBudget: string | null
  budgetCurrency: string | null
  ruleGroupId: string | null
  updatedAt: string
}

type PromotionUndoPayload = {
  before?: PromotionSnapshot | null
  after?: PromotionSnapshot | null
}

function toPromotionSnapshot(promotion: Promotion): PromotionSnapshot {
  return {
    id: promotion.id,
    organizationId: promotion.organizationId,
    tenantId: promotion.tenantId,
    name: promotion.name,
    description: promotion.description ?? null,
    order: promotion.order,
    active: promotion.active,
    startsAt: promotion.startsAt ? promotion.startsAt.toISOString() : null,
    endsAt: promotion.endsAt ? promotion.endsAt.toISOString() : null,
    cumulative: promotion.cumulative,
    tags: [...promotion.tags],
    excludedTags: [...promotion.excludedTags],
    excludeFlags: { ...promotion.excludeFlags },
    eligibleCurrencies: [...promotion.eligibleCurrencies],
    maxBudget: promotion.maxBudget ?? null,
    budgetCurrency: promotion.budgetCurrency ?? null,
    ruleGroupId: promotion.ruleGroupId ?? null,
    updatedAt: promotion.updatedAt.toISOString(),
  }
}

function getPromotionIdentifiers(promotion: Promotion) {
  return {
    id: promotion.id,
    organizationId: promotion.organizationId,
    tenantId: promotion.tenantId,
  }
}

// `promotionCreateSchema` carries no `tenantId`/`organizationId` fields (unlike the
// `customers` module's `scopedSchema`-derived schemas) — a new promotion's scope is
// always the caller's own actor scope, never a client-supplied value, so there is
// nothing to cross-check it against. Mirrors `commandActorScope` in
// `catalog/commands/shared.ts`, but resolves concrete (non-null) ids since a create
// command must stamp a real scope on the new row.
function resolveActorScope(ctx: CommandRuntimeContext): { tenantId: string; organizationId: string } {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, {
      error: '[internal] Tenant and organization scope are required to create a promotion',
    })
  }
  return { tenantId, organizationId }
}

async function loadPromotion(em: EntityManager, id: string): Promise<Promotion | null> {
  return em.findOne(Promotion, { id, deletedAt: null })
}

const createPromotionCommand: CommandHandler<PromotionCreateInput, { promotionId: string }> = {
  id: 'promotions.promotion.create',
  outputSchema: promotionCommandOutputSchema,
  async execute(rawInput, ctx) {
    const parsed = promotionCreateSchema.parse(rawInput)
    const { tenantId, organizationId } = resolveActorScope(ctx)
    ensureTenantScope(ctx, tenantId)
    ensureOrganizationScope(ctx, organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let promotion!: Promotion
    let rootGroup!: RuleGroup

    await withAtomicFlush(
      em,
      [
        () => {
          // Phase 1 — nullable side first: the promotion exists with no tree yet.
          promotion = em.create(Promotion, {
            organizationId,
            tenantId,
            name: parsed.name,
            description: parsed.description ?? null,
            order: parsed.order,
            active: parsed.active,
            startsAt: parsed.startsAt ?? null,
            endsAt: parsed.endsAt ?? null,
            cumulative: parsed.cumulative,
            tags: parsed.tags,
            excludedTags: parsed.excludedTags,
            excludeFlags: parsed.excludeFlags,
            eligibleCurrencies: parsed.eligibleCurrencies,
            maxBudget: parsed.maxBudget ?? null,
            budgetCurrency: parsed.budgetCurrency ?? null,
            ruleGroupId: null,
          })
          em.persist(promotion)
        },
        () => {
          // Phase 2 — `withAtomicFlush` has already flushed phase 1, so `promotion.id`
          // is populated and the NOT NULL `promotionId` FK below has a row to reference.
          // Root group: `parentRuleGroupId: null` is what marks it as the root, not the
          // (not-yet-set) `Promotion.ruleGroupId` pointer.
          rootGroup = em.create(RuleGroup, {
            organizationId,
            tenantId,
            promotionId: promotion.id,
            parentRuleGroupId: null,
            operator: 'and',
            sortOrder: 0,
          })
          em.persist(rootGroup)
        },
        () => {
          // Phase 3 — close the cycle now that the root group has a persisted id.
          promotion.ruleGroupId = rootGroup.id
        },
      ],
      { transaction: true, label: 'promotions.promotion.create' },
    )

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: promotion,
      identifiers: getPromotionIdentifiers(promotion),
      events: promotionCrudEvents,
      indexer: promotionCrudIndexer,
    })

    return { promotionId: promotion.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const promotion = await loadPromotion(em, result.promotionId)
    return promotion ? toPromotionSnapshot(promotion) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const after = snapshots.after as PromotionSnapshot | undefined
    return {
      actionLabel: translate('promotions.audit.promotion.create', 'Create promotion'),
      resourceKind: 'promotions.promotion',
      resourceId: result.promotionId,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: { after: after ?? null } satisfies PromotionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PromotionUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const promotion = await em.findOne(Promotion, { id: after.id })
    if (!promotion) return

    // `promotion_rule_groups.promotion_id` carries `ON DELETE CASCADE` (§Data Models),
    // so removing the promotion row also removes its root rule group at the DB level.
    em.remove(promotion)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: promotion,
      identifiers: getPromotionIdentifiers(promotion),
      events: promotionCrudEvents,
      indexer: promotionCrudIndexer,
    })
  },
}

const updatePromotionCommand: CommandHandler<PromotionUpdateInput, { promotionId: string }> = {
  id: 'promotions.promotion.update',
  outputSchema: promotionCommandOutputSchema,
  async prepare(rawInput, ctx) {
    const parsed = promotionUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const promotion = await loadPromotion(em, parsed.id)
    return promotion ? { before: toPromotionSnapshot(promotion) } : null
  },
  async execute(rawInput, ctx) {
    const parsed = promotionUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const promotion = await loadPromotion(em, parsed.id)
    if (!promotion) throw notFound('Promotion not found')
    assertPromotionScopeOrNotFound(ctx, promotion)

    await runCrudCommandWrite({
      ctx,
      em,
      entityId: PROMOTION_ENTITY_ID,
      action: 'updated',
      scope: { tenantId: promotion.tenantId, organizationId: promotion.organizationId },
      events: promotionCrudEvents,
      indexer: promotionCrudIndexer,
      sideEffect: () => ({
        entity: promotion,
        identifiers: getPromotionIdentifiers(promotion),
      }),
      phases: [
        () => {
          // Metadata-only: tree mutations (rules/benefits/groups) belong to
          // `commands/rule-tree.ts`, not this command (§Implementation Plan Phase 1, step 6).
          if (parsed.name !== undefined) promotion.name = parsed.name
          if (parsed.description !== undefined) promotion.description = parsed.description ?? null
          if (parsed.order !== undefined) promotion.order = parsed.order
          if (parsed.active !== undefined) promotion.active = parsed.active
          if (parsed.startsAt !== undefined) promotion.startsAt = parsed.startsAt ?? null
          if (parsed.endsAt !== undefined) promotion.endsAt = parsed.endsAt ?? null
          if (parsed.cumulative !== undefined) promotion.cumulative = parsed.cumulative
          if (parsed.tags !== undefined) promotion.tags = parsed.tags
          if (parsed.excludedTags !== undefined) promotion.excludedTags = parsed.excludedTags
          if (parsed.excludeFlags !== undefined) promotion.excludeFlags = parsed.excludeFlags
          if (parsed.eligibleCurrencies !== undefined) promotion.eligibleCurrencies = parsed.eligibleCurrencies
          if (parsed.maxBudget !== undefined) promotion.maxBudget = parsed.maxBudget ?? null
          if (parsed.budgetCurrency !== undefined) promotion.budgetCurrency = parsed.budgetCurrency ?? null
        },
      ],
    })

    return { promotionId: promotion.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const promotion = await loadPromotion(em, result.promotionId)
    return promotion ? toPromotionSnapshot(promotion) : null
  },
  buildLog: async ({ result, snapshots, ctx }) => {
    const before = snapshots.before as PromotionSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const promotion = await loadPromotion(em, result.promotionId)
    const after = promotion ? toPromotionSnapshot(promotion) : null
    return {
      actionLabel: translate('promotions.audit.promotion.update', 'Update promotion'),
      resourceKind: 'promotions.promotion',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies PromotionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PromotionUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const promotion = await em.findOne(Promotion, { id: before.id })
    if (!promotion) return

    await withAtomicFlush(
      em,
      [
        () => {
          promotion.name = before.name
          promotion.description = before.description
          promotion.order = before.order
          promotion.active = before.active
          promotion.startsAt = before.startsAt ? new Date(before.startsAt) : null
          promotion.endsAt = before.endsAt ? new Date(before.endsAt) : null
          promotion.cumulative = before.cumulative
          promotion.tags = before.tags
          promotion.excludedTags = before.excludedTags
          promotion.excludeFlags = before.excludeFlags
          promotion.eligibleCurrencies = before.eligibleCurrencies
          promotion.maxBudget = before.maxBudget
          promotion.budgetCurrency = before.budgetCurrency
        },
      ],
      { transaction: true, label: 'promotions.promotion.update.undo' },
    )

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: promotion,
      identifiers: getPromotionIdentifiers(promotion),
      events: promotionCrudEvents,
      indexer: promotionCrudIndexer,
    })
  },
}

const deletePromotionCommand: CommandHandler<PromotionDeleteInput, { promotionId: string }> = {
  id: 'promotions.promotion.delete',
  outputSchema: promotionCommandOutputSchema,
  async prepare(rawInput, ctx) {
    const parsed = promotionDeleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const promotion = await loadPromotion(em, parsed.id)
    return promotion ? { before: toPromotionSnapshot(promotion) } : null
  },
  async execute(rawInput, ctx) {
    const parsed = promotionDeleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const promotion = await loadPromotion(em, parsed.id)
    if (!promotion) throw notFound('Promotion not found')
    assertPromotionScopeOrNotFound(ctx, promotion)

    // Soft delete (§Data Models: `promotions.deleted_at`) — the root rule group and its
    // tree are left in place; only the promotion row stops being considered active.
    promotion.deletedAt = new Date()
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: promotion,
      identifiers: getPromotionIdentifiers(promotion),
      events: promotionCrudEvents,
      indexer: promotionCrudIndexer,
    })

    return { promotionId: promotion.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as PromotionSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('promotions.audit.promotion.delete', 'Delete promotion'),
      resourceKind: 'promotions.promotion',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies PromotionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PromotionUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const promotion = await em.findOne(Promotion, { id: before.id })
    if (!promotion) return

    promotion.deletedAt = null
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      // Restoring a soft-deleted row re-adds it to the index/cache — same semantics as
      // `created` on the forward path.
      action: 'created',
      entity: promotion,
      identifiers: getPromotionIdentifiers(promotion),
      events: promotionCrudEvents,
      indexer: promotionCrudIndexer,
    })
  },
}

registerCommand(createPromotionCommand)
registerCommand(updatePromotionCommand)
registerCommand(deletePromotionCommand)

export { createPromotionCommand, updatePromotionCommand, deletePromotionCommand }
