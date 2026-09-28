import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { requireId } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { runCrudCommandWrite } from '@open-mercato/shared/lib/commands/runCrudCommandWrite'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, conflict, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import { AvailabilityPolicy } from '../data/entities'
import {
  availabilityPolicyCreateSchema,
  availabilityPolicyUpdateSchema,
  availabilityPolicyDeleteSchema,
  availabilityPolicyMergedConstraintsSchema,
  type AvailabilityPolicyCreateInput,
  type AvailabilityPolicyUpdateInput,
} from '../data/validators'
import { buildAvailabilityPolicyCommandWhere, ensureAvailabilityPolicyCommandScope } from './scope'

const AVAILABILITY_POLICY_ENTITY_ID = E.availability.availability_policy

const policyCrudEvents: CrudEventsConfig<AvailabilityPolicy> = {
  module: 'availability',
  entity: 'policy',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type AvailabilityPolicySnapshot = {
  id: string
  organizationId: string
  tenantId: string
  storeId: string | null
  productId: string | null
  variantId: string | null
  isStockManaged: boolean
  allowBackorder: boolean
  backorderLeadTimeDays: number | null
  preorderReleaseAt: string | null
  lowStockThreshold: number | null
  minOrderQuantity: number | null
  maxOrderQuantity: number | null
  quantityIncrement: number | null
  hideWhenOutOfStock: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type AvailabilityPolicyUndoPayload = UndoPayload<AvailabilityPolicySnapshot>

function toSnapshot(record: AvailabilityPolicy): AvailabilityPolicySnapshot {
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    storeId: record.storeId ?? null,
    productId: record.productId ?? null,
    variantId: record.variantId ?? null,
    isStockManaged: !!record.isStockManaged,
    allowBackorder: !!record.allowBackorder,
    backorderLeadTimeDays: record.backorderLeadTimeDays ?? null,
    preorderReleaseAt: record.preorderReleaseAt ? record.preorderReleaseAt.toISOString() : null,
    lowStockThreshold: record.lowStockThreshold ?? null,
    minOrderQuantity: record.minOrderQuantity ?? null,
    maxOrderQuantity: record.maxOrderQuantity ?? null,
    quantityIncrement: record.quantityIncrement ?? null,
    hideWhenOutOfStock: !!record.hideWhenOutOfStock,
    isActive: !!record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

async function loadSnapshot(
  em: EntityManager,
  id: string,
  ctx: CommandRuntimeContext,
): Promise<AvailabilityPolicySnapshot | null> {
  const record = await em.findOne(AvailabilityPolicy, buildAvailabilityPolicyCommandWhere<AvailabilityPolicy>(ctx, { id }))
  if (!record) return null
  ensureAvailabilityPolicyCommandScope(ctx, record)
  return toSnapshot(record)
}

function applyUndoSnapshot(record: AvailabilityPolicy, snapshot: AvailabilityPolicySnapshot): void {
  record.storeId = snapshot.storeId
  record.productId = snapshot.productId
  record.variantId = snapshot.variantId
  record.isStockManaged = snapshot.isStockManaged
  record.allowBackorder = snapshot.allowBackorder
  record.backorderLeadTimeDays = snapshot.backorderLeadTimeDays
  record.preorderReleaseAt = snapshot.preorderReleaseAt ? new Date(snapshot.preorderReleaseAt) : null
  record.lowStockThreshold = snapshot.lowStockThreshold
  record.minOrderQuantity = snapshot.minOrderQuantity
  record.maxOrderQuantity = snapshot.maxOrderQuantity
  record.quantityIncrement = snapshot.quantityIncrement
  record.hideWhenOutOfStock = snapshot.hideWhenOutOfStock
  record.isActive = snapshot.isActive
  record.updatedAt = new Date()
}

const createPolicyCommand: CommandHandler<AvailabilityPolicyCreateInput, { policyId: string }> = {
  id: 'availability.policies.create',
  async execute(input, ctx) {
    const parsed = availabilityPolicyCreateSchema.parse(input)
    ensureAvailabilityPolicyCommandScope(ctx, parsed)

    const record = new AvailabilityPolicy()
    record.organizationId = parsed.organizationId
    record.tenantId = parsed.tenantId
    record.storeId = parsed.storeId ?? null
    record.productId = parsed.productId ?? null
    record.variantId = parsed.variantId ?? null
    record.isStockManaged = parsed.isStockManaged ?? false
    record.allowBackorder = parsed.allowBackorder ?? false
    record.backorderLeadTimeDays = parsed.backorderLeadTimeDays ?? null
    record.preorderReleaseAt = parsed.preorderReleaseAt ?? null
    record.lowStockThreshold = parsed.lowStockThreshold ?? null
    record.minOrderQuantity = parsed.minOrderQuantity ?? null
    record.maxOrderQuantity = parsed.maxOrderQuantity ?? null
    record.quantityIncrement = parsed.quantityIncrement ?? null
    record.hideWhenOutOfStock = parsed.hideWhenOutOfStock ?? false
    record.isActive = parsed.isActive ?? true

    try {
      await runCrudCommandWrite({
        ctx,
        entityId: AVAILABILITY_POLICY_ENTITY_ID,
        action: 'created',
        scope: { tenantId: record.tenantId, organizationId: record.organizationId },
        events: policyCrudEvents,
        sideEffect: () => ({
          entity: record,
          identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
        }),
        phases: [({ em }) => { em.persist(record) }],
      })
    } catch (err) {
      if (isUniqueViolation(err, 'availability_policies_scope_target_unique')) {
        const { translate } = await resolveTranslations()
        throw conflict(translate('availability.policies.errors.duplicateTarget', 'A policy already exists for this store/product/variant combination.'))
      }
      throw err
    }

    return { policyId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadSnapshot(em, result.policyId, ctx)
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as AvailabilityPolicySnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('availability.audit.create', 'Create availability policy'),
      resourceKind: 'availability.policy',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AvailabilityPolicyUndoPayload>(logEntry)
    const after = payload?.after ?? null
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(AvailabilityPolicy, { id: after.id })
    if (!record) return
    record.deletedAt = new Date()
    await em.flush()
  },
}

const updatePolicyCommand: CommandHandler<AvailabilityPolicyUpdateInput, { policyId: string }> = {
  id: 'availability.policies.update',
  async prepare(input, ctx) {
    requireId(input.id, 'Availability policy ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadSnapshot(em, input.id, ctx)
    return { before }
  },
  async execute(input, ctx) {
    const parsed = availabilityPolicyUpdateSchema.parse(input)
    requireId(parsed.id, 'Availability policy ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(AvailabilityPolicy, buildAvailabilityPolicyCommandWhere<AvailabilityPolicy>(ctx, { id: parsed.id }))
    if (!record) throw new CrudHttpError(404, { error: 'Availability policy not found' })
    ensureAvailabilityPolicyCommandScope(ctx, record)

    const merged = {
      storeId: parsed.storeId !== undefined ? parsed.storeId : record.storeId,
      productId: parsed.productId !== undefined ? parsed.productId : record.productId,
      variantId: parsed.variantId !== undefined ? parsed.variantId : record.variantId,
      isStockManaged: parsed.isStockManaged !== undefined ? parsed.isStockManaged : record.isStockManaged,
      allowBackorder: parsed.allowBackorder !== undefined ? parsed.allowBackorder : record.allowBackorder,
      backorderLeadTimeDays:
        parsed.backorderLeadTimeDays !== undefined ? parsed.backorderLeadTimeDays : record.backorderLeadTimeDays,
      minOrderQuantity: parsed.minOrderQuantity !== undefined ? parsed.minOrderQuantity : record.minOrderQuantity,
      maxOrderQuantity: parsed.maxOrderQuantity !== undefined ? parsed.maxOrderQuantity : record.maxOrderQuantity,
    }
    availabilityPolicyMergedConstraintsSchema.parse(merged)

    try {
      await runCrudCommandWrite({
        ctx,
        em,
        entityId: AVAILABILITY_POLICY_ENTITY_ID,
        action: 'updated',
        scope: { tenantId: record.tenantId, organizationId: record.organizationId },
        events: policyCrudEvents,
        sideEffect: () => ({
          entity: record,
          identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
        }),
        phases: [
          ({ em: forkedEm }) => {
            const target = forkedEm.getReference(AvailabilityPolicy, record.id)
            if (parsed.storeId !== undefined) target.storeId = parsed.storeId
            if (parsed.productId !== undefined) target.productId = parsed.productId
            if (parsed.variantId !== undefined) target.variantId = parsed.variantId
            if (parsed.isStockManaged !== undefined) target.isStockManaged = parsed.isStockManaged
            if (parsed.allowBackorder !== undefined) target.allowBackorder = parsed.allowBackorder
            if (parsed.backorderLeadTimeDays !== undefined) target.backorderLeadTimeDays = parsed.backorderLeadTimeDays
            if (parsed.preorderReleaseAt !== undefined) target.preorderReleaseAt = parsed.preorderReleaseAt
            if (parsed.lowStockThreshold !== undefined) target.lowStockThreshold = parsed.lowStockThreshold
            if (parsed.minOrderQuantity !== undefined) target.minOrderQuantity = parsed.minOrderQuantity
            if (parsed.maxOrderQuantity !== undefined) target.maxOrderQuantity = parsed.maxOrderQuantity
            if (parsed.quantityIncrement !== undefined) target.quantityIncrement = parsed.quantityIncrement
            if (parsed.hideWhenOutOfStock !== undefined) target.hideWhenOutOfStock = parsed.hideWhenOutOfStock
            if (parsed.isActive !== undefined) target.isActive = parsed.isActive
            target.updatedAt = new Date()
          },
        ],
      })
    } catch (err) {
      if (isUniqueViolation(err, 'availability_policies_scope_target_unique')) {
        const { translate } = await resolveTranslations()
        throw conflict(translate('availability.policies.errors.duplicateTarget', 'A policy already exists for this store/product/variant combination.'))
      }
      throw err
    }

    return { policyId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadSnapshot(em, result.policyId, ctx)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as AvailabilityPolicySnapshot | undefined
    const after = snapshots.after as AvailabilityPolicySnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('availability.audit.update', 'Update availability policy'),
      resourceKind: 'availability.policy',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before ?? undefined,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AvailabilityPolicyUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(AvailabilityPolicy, { id: before.id })
    if (!record) return
    applyUndoSnapshot(record, before)
    await em.flush()
  },
}

const deletePolicyCommand: CommandHandler<{ id: string; organizationId: string; tenantId: string }, { policyId: string }> = {
  id: 'availability.policies.delete',
  async prepare(input, ctx) {
    requireId(input.id, 'Availability policy ID is required')
    const em = ctx.container.resolve('em') as EntityManager
    const before = await loadSnapshot(em, input.id, ctx)
    return { before }
  },
  async execute(input, ctx) {
    const parsed = availabilityPolicyDeleteSchema.parse(input)
    requireId(parsed.id, 'Availability policy ID is required')

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(AvailabilityPolicy, buildAvailabilityPolicyCommandWhere<AvailabilityPolicy>(ctx, { id: parsed.id }))
    if (!record) throw new CrudHttpError(404, { error: 'Availability policy not found' })
    ensureAvailabilityPolicyCommandScope(ctx, record)

    await runCrudCommandWrite({
      ctx,
      em,
      entityId: AVAILABILITY_POLICY_ENTITY_ID,
      action: 'deleted',
      scope: { tenantId: record.tenantId, organizationId: record.organizationId },
      events: policyCrudEvents,
      sideEffect: () => ({
        entity: record,
        identifiers: { id: record.id, organizationId: record.organizationId, tenantId: record.tenantId },
      }),
      phases: [
        ({ em: forkedEm }) => {
          const target = forkedEm.getReference(AvailabilityPolicy, record.id)
          target.deletedAt = new Date()
        },
      ],
    })

    return { policyId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as AvailabilityPolicySnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('availability.audit.delete', 'Delete availability policy'),
      resourceKind: 'availability.policy',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AvailabilityPolicyUndoPayload>(logEntry)
    const before = payload?.before ?? null
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(AvailabilityPolicy, { id: before.id })
    if (!record) return
    record.deletedAt = null
    record.updatedAt = new Date()
    await em.flush()
  },
}

registerCommand(createPolicyCommand)
registerCommand(updatePolicyCommand)
registerCommand(deletePolicyCommand)

export { createPolicyCommand, updatePolicyCommand, deletePolicyCommand }
