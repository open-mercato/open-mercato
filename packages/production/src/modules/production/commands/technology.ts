import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import {
  WorkCenter,
  ProductionBom,
  ProductionBomItem,
  Routing,
  RoutingOperation,
  ProductPlanningParams,
  type TechnologyStatus,
  type WorkCenterKind,
  type ProcurementType,
} from '../data/entities.js'
import { findBomCycle, type BomItemsByProductKey } from '../lib/bomGraph.js'
import type {
  WorkCenterCreateInput,
  WorkCenterUpdateInput,
  BomCreateInput,
  BomUpdateInput,
  BomItemInputPayload,
  RoutingCreateInput,
  RoutingUpdateInput,
  RoutingOperationInputPayload,
  PlanningParamsCreateInput,
  PlanningParamsUpdateInput,
} from '../data/validators.js'
import { emitProductionEvent } from '../events.js'
import { E } from '../../../../generated/entities.ids.generated.js'

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

function requireScopeIds(ctx: CommandRuntimeContext): { tenantId: string; organizationId: string } {
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: '[internal] Missing tenant/organization scope' })
  }
  return { tenantId, organizationId }
}

export function productKeyOf(productId: string, variantId?: string | null): string {
  return variantId ? `${productId}:${variantId}` : productId
}

function resolveDataEngine(ctx: CommandRuntimeContext): DataEngine {
  return ctx.container.resolve<DataEngine>('dataEngine')
}

// ---------------------------------------------------------------------------
// CRUD side-effect configs (indexer + declared domain events per entity).
// Wired through `emitCrudSideEffects`/`emitCrudUndoSideEffects` (mirrors
// packages/core/src/modules/customers/commands/companies.ts) so every
// mutation both (a) populates `entity_indexes` via the declared indexer and
// (b) emits the matching `production.<entity>.<action>` event declared in
// events.ts. `production.planning_params` has no declared CRUD events (only
// `production.mrp.*` lifecycle events exist for that resource), so it is
// indexer-only — no `CrudEventsConfig` is defined for it.
// ---------------------------------------------------------------------------

const workCenterCrudIndexer: CrudIndexerConfig<WorkCenter> = { entityType: E.production.work_center }
const workCenterCrudEvents: CrudEventsConfig<WorkCenter> = { module: 'production', entity: 'work_center', persistent: true }

const bomCrudIndexer: CrudIndexerConfig<ProductionBom> = { entityType: E.production.production_bom }
const bomCrudEvents: CrudEventsConfig<ProductionBom> = { module: 'production', entity: 'bom', persistent: true }

const routingCrudIndexer: CrudIndexerConfig<Routing> = { entityType: E.production.routing }
const routingCrudEvents: CrudEventsConfig<Routing> = { module: 'production', entity: 'routing', persistent: true }

const planningParamsCrudIndexer: CrudIndexerConfig<ProductPlanningParams> = { entityType: E.production.product_planning_params }

// ---------------------------------------------------------------------------
// Work centers
// ---------------------------------------------------------------------------

type WorkCenterSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  kind: WorkCenterKind
  costRatePerHour: string
  parallelStations: number
  efficiencyFactor: string
  availabilityRuleSetId: string | null
  isActive: boolean
}

function snapshotWorkCenter(wc: WorkCenter): WorkCenterSnapshot {
  return {
    id: wc.id,
    tenantId: wc.tenantId,
    organizationId: wc.organizationId,
    name: wc.name,
    kind: wc.kind,
    costRatePerHour: wc.costRatePerHour,
    parallelStations: wc.parallelStations,
    efficiencyFactor: wc.efficiencyFactor,
    availabilityRuleSetId: wc.availabilityRuleSetId ?? null,
    isActive: wc.isActive,
  }
}

function applyWorkCenterSnapshot(wc: WorkCenter, snapshot: WorkCenterSnapshot): void {
  wc.name = snapshot.name
  wc.kind = snapshot.kind
  wc.costRatePerHour = snapshot.costRatePerHour
  wc.parallelStations = snapshot.parallelStations
  wc.efficiencyFactor = snapshot.efficiencyFactor
  wc.availabilityRuleSetId = snapshot.availabilityRuleSetId
  wc.isActive = snapshot.isActive
}

const createWorkCenterCommand: CommandHandler<WorkCenterCreateInput, { id: string }> = {
  id: 'production.work_centers.create',

  async execute(input, ctx) {
    const { tenantId, organizationId } = requireScopeIds(ctx)
    const em = ctx.container.resolve<EntityManager>('em').fork()

    const wc = em.create(WorkCenter, {
      tenantId,
      organizationId,
      name: input.name,
      kind: input.kind,
      costRatePerHour: String(input.costRatePerHour),
      parallelStations: input.parallelStations,
      efficiencyFactor: String(input.efficiencyFactor),
      availabilityRuleSetId: input.availabilityRuleSetId ?? null,
      isActive: input.isActive,
    } as never)

    await withAtomicFlush(em, [() => { em.persist(wc) }], { transaction: true, label: 'production.work_centers.create' })

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'created',
      entity: wc,
      identifiers: { id: wc.id, organizationId, tenantId },
      indexer: workCenterCrudIndexer,
      events: workCenterCrudEvents,
    })

    return { id: wc.id }
  },

  async captureAfter(_input, result, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    const wc = await em.findOne(WorkCenter, { id: result.id })
    return wc ? snapshotWorkCenter(wc) : null
  },

  async buildLog({ result, snapshots }) {
    const { translate } = await resolveTranslations()
    const after = snapshots.after as WorkCenterSnapshot | undefined
    return {
      actionLabel: translate('production.audit.work_center.create', 'Create work center'),
      resourceKind: 'production.work_center',
      resourceId: result.id,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },

  async undo({ logEntry, ctx }) {
    const after = extractUndoPayload<UndoPayload<WorkCenterSnapshot>>(logEntry)?.after
    if (!after) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const wc = await em.findOne(WorkCenter, { id: after.id })
    if (wc) {
      await withAtomicFlush(em, [() => { em.remove(wc) }], { transaction: true, label: 'production.work_centers.create.undo' })
      await emitCrudUndoSideEffects({
        dataEngine: resolveDataEngine(ctx),
        action: 'deleted',
        entity: wc,
        identifiers: { id: after.id, organizationId: after.organizationId, tenantId: after.tenantId },
        indexer: workCenterCrudIndexer,
        events: workCenterCrudEvents,
      })
    }
  },
}

const updateWorkCenterCommand: CommandHandler<WorkCenterUpdateInput, { ok: boolean }> = {
  id: 'production.work_centers.update',

  async prepare(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    const wc = await em.findOne(WorkCenter, { id: input.id, deletedAt: null })
    return { before: wc ? snapshotWorkCenter(wc) : null }
  },

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const wc = await em.findOne(WorkCenter, { id: input.id, deletedAt: null })
    if (!wc) throw new CrudHttpError(404, { error: '[internal] Work center not found' })

    ensureTenantScope(ctx, wc.tenantId)
    ensureOrganizationScope(ctx, wc.organizationId)

    await withAtomicFlush(
      em,
      [
        () => {
          if (input.name !== undefined) wc.name = input.name
          if (input.kind !== undefined) wc.kind = input.kind
          if (input.costRatePerHour !== undefined) wc.costRatePerHour = String(input.costRatePerHour)
          if (input.parallelStations !== undefined) wc.parallelStations = input.parallelStations
          if (input.efficiencyFactor !== undefined) wc.efficiencyFactor = String(input.efficiencyFactor)
          if (input.availabilityRuleSetId !== undefined) wc.availabilityRuleSetId = input.availabilityRuleSetId
          if (input.isActive !== undefined) wc.isActive = input.isActive
          wc.updatedAt = new Date()
        },
      ],
      { transaction: true, label: 'production.work_centers.update' },
    )

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'updated',
      entity: wc,
      identifiers: { id: wc.id, organizationId: wc.organizationId, tenantId: wc.tenantId },
      indexer: workCenterCrudIndexer,
      events: workCenterCrudEvents,
    })

    return { ok: true }
  },

  async captureAfter(input, _result, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    const wc = await em.findOne(WorkCenter, { id: input.id })
    return wc ? snapshotWorkCenter(wc) : null
  },

  async buildLog({ input, snapshots }) {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as WorkCenterSnapshot | undefined
    const after = snapshots.after as WorkCenterSnapshot | undefined
    return {
      actionLabel: translate('production.audit.work_center.update', 'Update work center'),
      resourceKind: 'production.work_center',
      resourceId: input.id,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },

  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<WorkCenterSnapshot>>(logEntry)?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const wc = await em.findOne(WorkCenter, { id: before.id })
    if (wc) {
      await withAtomicFlush(
        em,
        [
          () => {
            applyWorkCenterSnapshot(wc, before)
            wc.updatedAt = new Date()
          },
        ],
        { transaction: true, label: 'production.work_centers.update.undo' },
      )
      await emitCrudUndoSideEffects({
        dataEngine: resolveDataEngine(ctx),
        action: 'updated',
        entity: wc,
        identifiers: { id: wc.id, organizationId: wc.organizationId, tenantId: wc.tenantId },
        indexer: workCenterCrudIndexer,
        events: workCenterCrudEvents,
      })
    }
  },
}

const deleteWorkCenterCommand: CommandHandler<{ id: string }, { ok: boolean }> = {
  id: 'production.work_centers.delete',

  async prepare(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    const wc = await em.findOne(WorkCenter, { id: input.id, deletedAt: null })
    return { before: wc ? snapshotWorkCenter(wc) : null }
  },

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const wc = await em.findOne(WorkCenter, { id: input.id, deletedAt: null })
    if (!wc) throw new CrudHttpError(404, { error: '[internal] Work center not found' })

    ensureTenantScope(ctx, wc.tenantId)
    ensureOrganizationScope(ctx, wc.organizationId)

    await withAtomicFlush(
      em,
      [
        () => {
          wc.deletedAt = new Date()
          wc.updatedAt = new Date()
        },
      ],
      { transaction: true, label: 'production.work_centers.delete' },
    )

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'deleted',
      entity: wc,
      identifiers: { id: wc.id, organizationId: wc.organizationId, tenantId: wc.tenantId },
      indexer: workCenterCrudIndexer,
      events: workCenterCrudEvents,
    })

    return { ok: true }
  },

  async buildLog({ input, snapshots }) {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as WorkCenterSnapshot | undefined
    return {
      actionLabel: translate('production.audit.work_center.delete', 'Delete work center'),
      resourceKind: 'production.work_center',
      resourceId: input.id,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },

  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<WorkCenterSnapshot>>(logEntry)?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const wc = await em.findOne(WorkCenter, { id: before.id })
    if (wc) {
      await withAtomicFlush(
        em,
        [
          () => {
            wc.deletedAt = null
            wc.updatedAt = new Date()
          },
        ],
        { transaction: true, label: 'production.work_centers.delete.undo' },
      )
      await emitCrudUndoSideEffects({
        dataEngine: resolveDataEngine(ctx),
        action: 'created',
        entity: wc,
        identifiers: { id: wc.id, organizationId: wc.organizationId, tenantId: wc.tenantId },
        indexer: workCenterCrudIndexer,
        events: workCenterCrudEvents,
      })
    }
  },
}

// ---------------------------------------------------------------------------
// BOMs (header + items aggregate)
// ---------------------------------------------------------------------------

type BomItemSnapshot = {
  id: string
  componentProductId: string
  componentVariantId: string | null
  qtyPerUnit: string
  uom: string
  scrapFactor: string
  isPhantom: boolean
  operationSequence: number | null
}

type BomSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  productId: string
  variantId: string | null
  version: number
  status: TechnologyStatus
  validFrom: Date | null
  validTo: Date | null
  name: string
  items: BomItemSnapshot[]
}

async function loadBomSnapshot(em: EntityManager, id: string): Promise<BomSnapshot | null> {
  const bom = await em.findOne(ProductionBom, { id })
  if (!bom) return null
  const items = await em.find(ProductionBomItem, { bomId: id, deletedAt: null })
  return {
    id: bom.id,
    tenantId: bom.tenantId,
    organizationId: bom.organizationId,
    productId: bom.productId,
    variantId: bom.variantId ?? null,
    version: bom.version,
    status: bom.status,
    validFrom: bom.validFrom ?? null,
    validTo: bom.validTo ?? null,
    name: bom.name,
    items: items.map((i) => ({
      id: i.id,
      componentProductId: i.componentProductId,
      componentVariantId: i.componentVariantId ?? null,
      qtyPerUnit: i.qtyPerUnit,
      uom: i.uom,
      scrapFactor: i.scrapFactor,
      isPhantom: i.isPhantom,
      operationSequence: i.operationSequence ?? null,
    })),
  }
}

function bomItemInputToEntityData(
  item: BomItemInputPayload,
  scope: { tenantId: string; organizationId: string; bomId: string },
) {
  return {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    bomId: scope.bomId,
    componentProductId: item.componentProductId,
    componentVariantId: item.componentVariantId ?? null,
    qtyPerUnit: String(item.qtyPerUnit),
    uom: item.uom,
    scrapFactor: String(item.scrapFactor),
    isPhantom: item.isPhantom,
    operationSequence: item.operationSequence ?? null,
  }
}

/**
 * Replaces all live BOM items for `bomId` with `items`. Used by create
 * (fresh insert), update (resync), and undo (restore from snapshot). Runs as
 * one of the `withAtomicFlush` phases supplied by the caller.
 */
function syncBomItems(em: EntityManager, bomId: string, scope: { tenantId: string; organizationId: string }, items: Array<BomItemInputPayload | BomItemSnapshot>): void {
  // Line items are always fully replaced (no soft-delete for children), so a
  // hard remove + recreate (paired with `removeExistingBomItems`) keeps the
  // aggregate simple and consistent for both regular writes and undo restore.
  for (const item of items) {
    em.create(ProductionBomItem, bomItemInputToEntityData(item as BomItemInputPayload, { ...scope, bomId }) as never)
  }
}

async function removeExistingBomItems(em: EntityManager, bomId: string): Promise<void> {
  const existing = await em.find(ProductionBomItem, { bomId })
  for (const item of existing) em.remove(item)
}

async function nextBomVersion(em: EntityManager, scope: { tenantId: string; organizationId: string; productId: string; variantId: string | null }): Promise<number> {
  const rows = await em.find(ProductionBom, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    productId: scope.productId,
    variantId: scope.variantId,
  })
  return rows.reduce((max, row) => Math.max(max, row.version), 0) + 1
}

/**
 * Builds the tenant/org-scoped BOM item graph (active versions only), with
 * `overrideProductKey`/`overrideItems` substituted in place of whatever is
 * currently persisted for that product — used to simulate "what would the
 * graph look like if this BOM were active" before committing an activation,
 * and reused by the cost-rollup route (task 1.4) to explode a multi-level
 * standard cost without re-querying/re-deriving the same BOM item graph.
 *
 * Also returns `uomByComponentKey`: the BOM-line unit of measure for each
 * component key encountered while building the graph (root/override items
 * win over active-BOM items for the same key), since `BomItemsByProductKey`
 * itself carries no UoM — the cost rollup needs it to know which unit each
 * exploded quantity is expressed in.
 */
export async function loadActiveBomGraph(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  overrideProductKey: string,
  overrideItems: BomItemInputPayload[],
): Promise<{ graph: BomItemsByProductKey; uomByComponentKey: Record<string, string> }> {
  const activeBoms = await em.find(ProductionBom, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'active',
    deletedAt: null,
  })
  const activeBomIds = activeBoms.map((b) => b.id)
  const items = activeBomIds.length ? await em.find(ProductionBomItem, { bomId: { $in: activeBomIds }, deletedAt: null }) : []

  const graph: BomItemsByProductKey = {}
  const uomByComponentKey: Record<string, string> = {}
  for (const bom of activeBoms) {
    const key = productKeyOf(bom.productId, bom.variantId)
    graph[key] = items
      .filter((i) => i.bomId === bom.id)
      .map((i) => {
        const componentKey = productKeyOf(i.componentProductId, i.componentVariantId)
        uomByComponentKey[componentKey] = i.uom
        return {
          componentKey,
          qtyPerUnit: Number(i.qtyPerUnit),
          scrapFactor: Number(i.scrapFactor),
          isPhantom: i.isPhantom,
        }
      })
  }

  graph[overrideProductKey] = overrideItems.map((i) => {
    const componentKey = productKeyOf(i.componentProductId, i.componentVariantId ?? null)
    uomByComponentKey[componentKey] = i.uom
    return {
      componentKey,
      qtyPerUnit: i.qtyPerUnit,
      scrapFactor: i.scrapFactor,
      isPhantom: i.isPhantom,
    }
  })

  return { graph, uomByComponentKey }
}

const createBomCommand: CommandHandler<BomCreateInput, { id: string }> = {
  id: 'production.boms.create',

  async execute(input, ctx) {
    const { tenantId, organizationId } = requireScopeIds(ctx)
    const em = ctx.container.resolve<EntityManager>('em').fork()

    const version = input.version ?? (await nextBomVersion(em, { tenantId, organizationId, productId: input.productId, variantId: input.variantId ?? null }))

    const bom = em.create(ProductionBom, {
      tenantId,
      organizationId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      version,
      status: input.status,
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
      name: input.name,
    } as never)

    await withAtomicFlush(
      em,
      [
        () => { em.persist(bom) },
        () => syncBomItems(em, bom.id, { tenantId, organizationId }, input.items),
      ],
      { transaction: true, label: 'production.boms.create' },
    )

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'created',
      entity: bom,
      identifiers: { id: bom.id, organizationId, tenantId },
      indexer: bomCrudIndexer,
      events: bomCrudEvents,
    })

    return { id: bom.id }
  },

  async captureAfter(_input, result, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadBomSnapshot(em, result.id)
  },

  async buildLog({ result, snapshots }) {
    const { translate } = await resolveTranslations()
    const after = snapshots.after as BomSnapshot | undefined
    return {
      actionLabel: translate('production.audit.bom.create', 'Create BOM'),
      resourceKind: 'production.bom',
      resourceId: result.id,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },

  async undo({ logEntry, ctx }) {
    const after = extractUndoPayload<UndoPayload<BomSnapshot>>(logEntry)?.after
    if (!after) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const bom = await em.findOne(ProductionBom, { id: after.id })
    if (bom) {
      await withAtomicFlush(
        em,
        [
          async () => removeExistingBomItems(em, bom.id),
          () => { em.remove(bom) },
        ],
        { transaction: true, label: 'production.boms.create.undo' },
      )
      await emitCrudUndoSideEffects({
        dataEngine: resolveDataEngine(ctx),
        action: 'deleted',
        entity: bom,
        identifiers: { id: after.id, organizationId: after.organizationId, tenantId: after.tenantId },
        indexer: bomCrudIndexer,
        events: bomCrudEvents,
      })
    }
  },
}

const updateBomCommand: CommandHandler<BomUpdateInput, { ok: boolean }> = {
  id: 'production.boms.update',

  async prepare(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    return { before: await loadBomSnapshot(em, input.id) }
  },

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const bom = await em.findOne(ProductionBom, { id: input.id, deletedAt: null })
    if (!bom) throw new CrudHttpError(404, { error: '[internal] BOM not found' })

    ensureTenantScope(ctx, bom.tenantId)
    ensureOrganizationScope(ctx, bom.organizationId)

    const phases: Array<() => void | Promise<void>> = [
      () => {
        if (input.status !== undefined) bom.status = input.status
        if (input.validFrom !== undefined) bom.validFrom = input.validFrom
        if (input.validTo !== undefined) bom.validTo = input.validTo
        if (input.name !== undefined) bom.name = input.name
        bom.updatedAt = new Date()
      },
    ]
    if (input.items !== undefined) {
      phases.push(async () => removeExistingBomItems(em, bom.id))
      phases.push(() => syncBomItems(em, bom.id, { tenantId: bom.tenantId, organizationId: bom.organizationId }, input.items!))
    }

    await withAtomicFlush(em, phases, { transaction: true, label: 'production.boms.update' })

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'updated',
      entity: bom,
      identifiers: { id: bom.id, organizationId: bom.organizationId, tenantId: bom.tenantId },
      indexer: bomCrudIndexer,
      events: bomCrudEvents,
    })

    return { ok: true }
  },

  async captureAfter(input, _result, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadBomSnapshot(em, input.id)
  },

  async buildLog({ input, snapshots }) {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as BomSnapshot | undefined
    const after = snapshots.after as BomSnapshot | undefined
    return {
      actionLabel: translate('production.audit.bom.update', 'Update BOM'),
      resourceKind: 'production.bom',
      resourceId: input.id,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },

  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<BomSnapshot>>(logEntry)?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const bom = await em.findOne(ProductionBom, { id: before.id })
    if (!bom) return

    await withAtomicFlush(
      em,
      [
        () => {
          bom.status = before.status
          bom.validFrom = before.validFrom
          bom.validTo = before.validTo
          bom.name = before.name
          bom.updatedAt = new Date()
        },
        async () => removeExistingBomItems(em, bom.id),
        () => syncBomItems(em, bom.id, { tenantId: bom.tenantId, organizationId: bom.organizationId }, before.items),
      ],
      { transaction: true, label: 'production.boms.update.undo' },
    )

    await emitCrudUndoSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'updated',
      entity: bom,
      identifiers: { id: bom.id, organizationId: bom.organizationId, tenantId: bom.tenantId },
      indexer: bomCrudIndexer,
      events: bomCrudEvents,
    })
  },
}

const deleteBomCommand: CommandHandler<{ id: string }, { ok: boolean }> = {
  id: 'production.boms.delete',

  async prepare(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    return { before: await loadBomSnapshot(em, input.id) }
  },

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const bom = await em.findOne(ProductionBom, { id: input.id, deletedAt: null })
    if (!bom) throw new CrudHttpError(404, { error: '[internal] BOM not found' })

    ensureTenantScope(ctx, bom.tenantId)
    ensureOrganizationScope(ctx, bom.organizationId)

    await withAtomicFlush(
      em,
      [
        () => {
          bom.deletedAt = new Date()
          bom.updatedAt = new Date()
        },
      ],
      { transaction: true, label: 'production.boms.delete' },
    )

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'deleted',
      entity: bom,
      identifiers: { id: bom.id, organizationId: bom.organizationId, tenantId: bom.tenantId },
      indexer: bomCrudIndexer,
      events: bomCrudEvents,
    })

    return { ok: true }
  },

  async buildLog({ input, snapshots }) {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as BomSnapshot | undefined
    return {
      actionLabel: translate('production.audit.bom.delete', 'Delete BOM'),
      resourceKind: 'production.bom',
      resourceId: input.id,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },

  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<BomSnapshot>>(logEntry)?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const bom = await em.findOne(ProductionBom, { id: before.id })
    if (bom) {
      await withAtomicFlush(
        em,
        [
          () => {
            bom.deletedAt = null
            bom.updatedAt = new Date()
          },
        ],
        { transaction: true, label: 'production.boms.delete.undo' },
      )
      await emitCrudUndoSideEffects({
        dataEngine: resolveDataEngine(ctx),
        action: 'created',
        entity: bom,
        identifiers: { id: bom.id, organizationId: bom.organizationId, tenantId: bom.tenantId },
        indexer: bomCrudIndexer,
        events: bomCrudEvents,
      })
    }
  },
}

const copyVersionBomCommand: CommandHandler<{ id: string }, { id: string }> = {
  id: 'production.boms.copyVersion',

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const source = await em.findOne(ProductionBom, { id: input.id, deletedAt: null })
    if (!source) throw new CrudHttpError(404, { error: '[internal] BOM not found' })

    ensureTenantScope(ctx, source.tenantId)
    ensureOrganizationScope(ctx, source.organizationId)

    const sourceItems = await em.find(ProductionBomItem, { bomId: source.id, deletedAt: null })
    const version = await nextBomVersion(em, {
      tenantId: source.tenantId,
      organizationId: source.organizationId,
      productId: source.productId,
      variantId: source.variantId ?? null,
    })

    const copy = em.create(ProductionBom, {
      tenantId: source.tenantId,
      organizationId: source.organizationId,
      productId: source.productId,
      variantId: source.variantId ?? null,
      version,
      status: 'draft',
      validFrom: null,
      validTo: null,
      name: source.name,
    } as never)

    await withAtomicFlush(
      em,
      [
        () => { em.persist(copy) },
        () => {
          for (const item of sourceItems) {
            em.create(ProductionBomItem, {
              tenantId: source.tenantId,
              organizationId: source.organizationId,
              bomId: copy.id,
              componentProductId: item.componentProductId,
              componentVariantId: item.componentVariantId ?? null,
              qtyPerUnit: item.qtyPerUnit,
              uom: item.uom,
              scrapFactor: item.scrapFactor,
              isPhantom: item.isPhantom,
              operationSequence: item.operationSequence ?? null,
            } as never)
          }
        },
      ],
      { transaction: true, label: 'production.boms.copyVersion' },
    )

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'created',
      entity: copy,
      identifiers: { id: copy.id, organizationId: source.organizationId, tenantId: source.tenantId },
      indexer: bomCrudIndexer,
      events: bomCrudEvents,
    })

    return { id: copy.id }
  },

  async captureAfter(_input, result, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadBomSnapshot(em, result.id)
  },

  async buildLog({ result, snapshots }) {
    const { translate } = await resolveTranslations()
    const after = snapshots.after as BomSnapshot | undefined
    return {
      actionLabel: translate('production.audit.bom.copy_version', 'Copy BOM version'),
      resourceKind: 'production.bom',
      resourceId: result.id,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },

  async undo({ logEntry, ctx }) {
    const after = extractUndoPayload<UndoPayload<BomSnapshot>>(logEntry)?.after
    if (!after) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const bom = await em.findOne(ProductionBom, { id: after.id })
    if (bom) {
      await withAtomicFlush(
        em,
        [async () => removeExistingBomItems(em, bom.id), () => { em.remove(bom) }],
        { transaction: true, label: 'production.boms.copyVersion.undo' },
      )
      await emitCrudUndoSideEffects({
        dataEngine: resolveDataEngine(ctx),
        action: 'deleted',
        entity: bom,
        identifiers: { id: after.id, organizationId: after.organizationId, tenantId: after.tenantId },
        indexer: bomCrudIndexer,
        events: bomCrudEvents,
      })
    }
  },
}

type BomActivateUndoPayload = UndoPayload<BomSnapshot> & { archivedSiblingIds?: string[] }

const activateBomCommand: CommandHandler<{ id: string }, { ok: boolean; archivedSiblingIds: string[] }> = {
  id: 'production.boms.activate',

  async prepare(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    return { before: await loadBomSnapshot(em, input.id) }
  },

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const bom = await em.findOne(ProductionBom, { id: input.id, deletedAt: null })
    if (!bom) throw new CrudHttpError(404, { error: '[internal] BOM not found' })

    ensureTenantScope(ctx, bom.tenantId)
    ensureOrganizationScope(ctx, bom.organizationId)

    const items = await em.find(ProductionBomItem, { bomId: bom.id, deletedAt: null })
    const productKey = productKeyOf(bom.productId, bom.variantId ?? null)
    const { graph } = await loadActiveBomGraph(
      em,
      { tenantId: bom.tenantId, organizationId: bom.organizationId },
      productKey,
      items.map((i) => ({
        componentProductId: i.componentProductId,
        componentVariantId: i.componentVariantId ?? null,
        qtyPerUnit: Number(i.qtyPerUnit),
        uom: i.uom,
        scrapFactor: Number(i.scrapFactor),
        isPhantom: i.isPhantom,
        operationSequence: i.operationSequence ?? null,
      })),
    )

    const cycle = findBomCycle(graph, productKey)
    if (cycle) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(422, {
        error: translate('production.errors.bom_cycle_detected', 'Activating this BOM would create a circular bill of materials.'),
        cycle,
      })
    }

    // Only one active version per product/variant scope: archive any other
    // currently active BOM for the same scope before promoting this one.
    const otherActive = await em.find(ProductionBom, {
      tenantId: bom.tenantId,
      organizationId: bom.organizationId,
      productId: bom.productId,
      variantId: bom.variantId ?? null,
      status: 'active',
      deletedAt: null,
    })

    await withAtomicFlush(
      em,
      [
        () => {
          for (const other of otherActive) {
            if (other.id === bom.id) continue
            other.status = 'archived'
            other.updatedAt = new Date()
          }
          bom.status = 'active'
          bom.updatedAt = new Date()
        },
      ],
      { transaction: true, label: 'production.boms.activate' },
    )

    const dataEngine = resolveDataEngine(ctx)
    // Reindex the activated BOM and every sibling this activation archived.
    // `events` is intentionally omitted here — the semantic
    // `production.bom.activated` event below is the declared lifecycle event
    // for this transition (activate is not a plain CRUD `updated`), so
    // `emitCrudSideEffects` is used indexer-only to avoid also firing a
    // redundant `production.bom.updated`.
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: bom,
      identifiers: { id: bom.id, organizationId: bom.organizationId, tenantId: bom.tenantId },
      indexer: bomCrudIndexer,
    })
    const archivedSiblingIds = otherActive.filter((other) => other.id !== bom.id).map((other) => other.id)
    for (const other of otherActive) {
      if (other.id === bom.id) continue
      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: other,
        identifiers: { id: other.id, organizationId: other.organizationId, tenantId: other.tenantId },
        indexer: bomCrudIndexer,
      })
    }

    await emitProductionEvent('production.bom.activated', { id: bom.id, tenantId: bom.tenantId, organizationId: bom.organizationId })

    return { ok: true, archivedSiblingIds }
  },

  async captureAfter(input, _result, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadBomSnapshot(em, input.id)
  },

  async buildLog({ input, result, snapshots }) {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as BomSnapshot | undefined
    const after = snapshots.after as BomSnapshot | undefined
    return {
      actionLabel: translate('production.audit.bom.activate', 'Activate BOM version'),
      resourceKind: 'production.bom',
      resourceId: input.id,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: {
          before,
          after,
          archivedSiblingIds: result.archivedSiblingIds,
        } satisfies BomActivateUndoPayload,
      },
    }
  },

  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<BomActivateUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const bom = await em.findOne(ProductionBom, { id: before.id })
    if (!bom) return

    // Restore the siblings this activation archived (finding #3): only
    // touch rows that are STILL archived at undo time — if a sibling was
    // independently re-activated or deleted since, leave it alone rather
    // than blindly clobbering a later, unrelated change.
    const archivedSiblingIds = payload?.archivedSiblingIds ?? []
    const siblings = archivedSiblingIds.length
      ? await em.find(ProductionBom, { id: { $in: archivedSiblingIds }, deletedAt: null })
      : []
    const siblingsToRestore = siblings.filter((sib) => sib.status === 'archived')

    await withAtomicFlush(
      em,
      [
        () => {
          bom.status = before.status
          bom.updatedAt = new Date()
          for (const sib of siblingsToRestore) {
            sib.status = 'active'
            sib.updatedAt = new Date()
          }
        },
      ],
      { transaction: true, label: 'production.boms.activate.undo' },
    )

    const dataEngine = resolveDataEngine(ctx)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: bom,
      identifiers: { id: bom.id, organizationId: bom.organizationId, tenantId: bom.tenantId },
      indexer: bomCrudIndexer,
    })
    for (const sib of siblingsToRestore) {
      await emitCrudUndoSideEffects({
        dataEngine,
        action: 'updated',
        entity: sib,
        identifiers: { id: sib.id, organizationId: sib.organizationId, tenantId: sib.tenantId },
        indexer: bomCrudIndexer,
      })
    }
  },
}

// ---------------------------------------------------------------------------
// Routings (header + operations aggregate)
// ---------------------------------------------------------------------------

type RoutingOperationSnapshot = {
  id: string
  sequence: number
  name: string
  workCenterId: string
  setupTimeMinutes: string
  runTimePerUnitSeconds: string
  isReportingPoint: boolean
}

type RoutingSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  productId: string
  variantId: string | null
  version: number
  status: TechnologyStatus
  name: string
  operations: RoutingOperationSnapshot[]
}

async function loadRoutingSnapshot(em: EntityManager, id: string): Promise<RoutingSnapshot | null> {
  const routing = await em.findOne(Routing, { id })
  if (!routing) return null
  const operations = await em.find(RoutingOperation, { routingId: id, deletedAt: null })
  return {
    id: routing.id,
    tenantId: routing.tenantId,
    organizationId: routing.organizationId,
    productId: routing.productId,
    variantId: routing.variantId ?? null,
    version: routing.version,
    status: routing.status,
    name: routing.name,
    operations: operations.map((op) => ({
      id: op.id,
      sequence: op.sequence,
      name: op.name,
      workCenterId: op.workCenterId,
      setupTimeMinutes: op.setupTimeMinutes,
      runTimePerUnitSeconds: op.runTimePerUnitSeconds,
      isReportingPoint: op.isReportingPoint,
    })),
  }
}

function syncRoutingOperations(
  em: EntityManager,
  routingId: string,
  scope: { tenantId: string; organizationId: string },
  operations: Array<RoutingOperationInputPayload | RoutingOperationSnapshot>,
): void {
  for (const op of operations) {
    em.create(RoutingOperation, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      routingId,
      sequence: op.sequence,
      name: op.name,
      workCenterId: op.workCenterId,
      setupTimeMinutes: String(op.setupTimeMinutes),
      runTimePerUnitSeconds: String(op.runTimePerUnitSeconds),
      isReportingPoint: op.isReportingPoint,
    } as never)
  }
}

async function removeExistingRoutingOperations(em: EntityManager, routingId: string): Promise<void> {
  const existing = await em.find(RoutingOperation, { routingId })
  for (const op of existing) em.remove(op)
}

async function nextRoutingVersion(em: EntityManager, scope: { tenantId: string; organizationId: string; productId: string; variantId: string | null }): Promise<number> {
  const rows = await em.find(Routing, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    productId: scope.productId,
    variantId: scope.variantId,
  })
  return rows.reduce((max, row) => Math.max(max, row.version), 0) + 1
}

const createRoutingCommand: CommandHandler<RoutingCreateInput, { id: string }> = {
  id: 'production.routings.create',

  async execute(input, ctx) {
    const { tenantId, organizationId } = requireScopeIds(ctx)
    const em = ctx.container.resolve<EntityManager>('em').fork()

    const version = input.version ?? (await nextRoutingVersion(em, { tenantId, organizationId, productId: input.productId, variantId: input.variantId ?? null }))

    const routing = em.create(Routing, {
      tenantId,
      organizationId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      version,
      status: input.status,
      name: input.name,
    } as never)

    await withAtomicFlush(
      em,
      [() => { em.persist(routing) }, () => syncRoutingOperations(em, routing.id, { tenantId, organizationId }, input.operations)],
      { transaction: true, label: 'production.routings.create' },
    )

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'created',
      entity: routing,
      identifiers: { id: routing.id, organizationId, tenantId },
      indexer: routingCrudIndexer,
      events: routingCrudEvents,
    })

    return { id: routing.id }
  },

  async captureAfter(_input, result, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadRoutingSnapshot(em, result.id)
  },

  async buildLog({ result, snapshots }) {
    const { translate } = await resolveTranslations()
    const after = snapshots.after as RoutingSnapshot | undefined
    return {
      actionLabel: translate('production.audit.routing.create', 'Create routing'),
      resourceKind: 'production.routing',
      resourceId: result.id,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },

  async undo({ logEntry, ctx }) {
    const after = extractUndoPayload<UndoPayload<RoutingSnapshot>>(logEntry)?.after
    if (!after) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const routing = await em.findOne(Routing, { id: after.id })
    if (routing) {
      await withAtomicFlush(
        em,
        [async () => removeExistingRoutingOperations(em, routing.id), () => { em.remove(routing) }],
        { transaction: true, label: 'production.routings.create.undo' },
      )
      await emitCrudUndoSideEffects({
        dataEngine: resolveDataEngine(ctx),
        action: 'deleted',
        entity: routing,
        identifiers: { id: after.id, organizationId: after.organizationId, tenantId: after.tenantId },
        indexer: routingCrudIndexer,
        events: routingCrudEvents,
      })
    }
  },
}

const updateRoutingCommand: CommandHandler<RoutingUpdateInput, { ok: boolean }> = {
  id: 'production.routings.update',

  async prepare(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    return { before: await loadRoutingSnapshot(em, input.id) }
  },

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const routing = await em.findOne(Routing, { id: input.id, deletedAt: null })
    if (!routing) throw new CrudHttpError(404, { error: '[internal] Routing not found' })

    ensureTenantScope(ctx, routing.tenantId)
    ensureOrganizationScope(ctx, routing.organizationId)

    const phases: Array<() => void | Promise<void>> = [
      () => {
        if (input.status !== undefined) routing.status = input.status
        if (input.name !== undefined) routing.name = input.name
        routing.updatedAt = new Date()
      },
    ]
    if (input.operations !== undefined) {
      phases.push(async () => removeExistingRoutingOperations(em, routing.id))
      phases.push(() => syncRoutingOperations(em, routing.id, { tenantId: routing.tenantId, organizationId: routing.organizationId }, input.operations!))
    }

    await withAtomicFlush(em, phases, { transaction: true, label: 'production.routings.update' })

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'updated',
      entity: routing,
      identifiers: { id: routing.id, organizationId: routing.organizationId, tenantId: routing.tenantId },
      indexer: routingCrudIndexer,
      events: routingCrudEvents,
    })

    return { ok: true }
  },

  async captureAfter(input, _result, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadRoutingSnapshot(em, input.id)
  },

  async buildLog({ input, snapshots }) {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as RoutingSnapshot | undefined
    const after = snapshots.after as RoutingSnapshot | undefined
    return {
      actionLabel: translate('production.audit.routing.update', 'Update routing'),
      resourceKind: 'production.routing',
      resourceId: input.id,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },

  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<RoutingSnapshot>>(logEntry)?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const routing = await em.findOne(Routing, { id: before.id })
    if (!routing) return

    await withAtomicFlush(
      em,
      [
        () => {
          routing.status = before.status
          routing.name = before.name
          routing.updatedAt = new Date()
        },
        async () => removeExistingRoutingOperations(em, routing.id),
        () => syncRoutingOperations(em, routing.id, { tenantId: routing.tenantId, organizationId: routing.organizationId }, before.operations),
      ],
      { transaction: true, label: 'production.routings.update.undo' },
    )

    await emitCrudUndoSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'updated',
      entity: routing,
      identifiers: { id: routing.id, organizationId: routing.organizationId, tenantId: routing.tenantId },
      indexer: routingCrudIndexer,
      events: routingCrudEvents,
    })
  },
}

const deleteRoutingCommand: CommandHandler<{ id: string }, { ok: boolean }> = {
  id: 'production.routings.delete',

  async prepare(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    return { before: await loadRoutingSnapshot(em, input.id) }
  },

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const routing = await em.findOne(Routing, { id: input.id, deletedAt: null })
    if (!routing) throw new CrudHttpError(404, { error: '[internal] Routing not found' })

    ensureTenantScope(ctx, routing.tenantId)
    ensureOrganizationScope(ctx, routing.organizationId)

    await withAtomicFlush(
      em,
      [
        () => {
          routing.deletedAt = new Date()
          routing.updatedAt = new Date()
        },
      ],
      { transaction: true, label: 'production.routings.delete' },
    )

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'deleted',
      entity: routing,
      identifiers: { id: routing.id, organizationId: routing.organizationId, tenantId: routing.tenantId },
      indexer: routingCrudIndexer,
      events: routingCrudEvents,
    })

    return { ok: true }
  },

  async buildLog({ input, snapshots }) {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as RoutingSnapshot | undefined
    return {
      actionLabel: translate('production.audit.routing.delete', 'Delete routing'),
      resourceKind: 'production.routing',
      resourceId: input.id,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },

  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<RoutingSnapshot>>(logEntry)?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const routing = await em.findOne(Routing, { id: before.id })
    if (routing) {
      await withAtomicFlush(
        em,
        [
          () => {
            routing.deletedAt = null
            routing.updatedAt = new Date()
          },
        ],
        { transaction: true, label: 'production.routings.delete.undo' },
      )
      await emitCrudUndoSideEffects({
        dataEngine: resolveDataEngine(ctx),
        action: 'created',
        entity: routing,
        identifiers: { id: routing.id, organizationId: routing.organizationId, tenantId: routing.tenantId },
        indexer: routingCrudIndexer,
        events: routingCrudEvents,
      })
    }
  },
}

const copyVersionRoutingCommand: CommandHandler<{ id: string }, { id: string }> = {
  id: 'production.routings.copyVersion',

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const source = await em.findOne(Routing, { id: input.id, deletedAt: null })
    if (!source) throw new CrudHttpError(404, { error: '[internal] Routing not found' })

    ensureTenantScope(ctx, source.tenantId)
    ensureOrganizationScope(ctx, source.organizationId)

    const sourceOperations = await em.find(RoutingOperation, { routingId: source.id, deletedAt: null })
    const version = await nextRoutingVersion(em, {
      tenantId: source.tenantId,
      organizationId: source.organizationId,
      productId: source.productId,
      variantId: source.variantId ?? null,
    })

    const copy = em.create(Routing, {
      tenantId: source.tenantId,
      organizationId: source.organizationId,
      productId: source.productId,
      variantId: source.variantId ?? null,
      version,
      status: 'draft',
      name: source.name,
    } as never)

    await withAtomicFlush(
      em,
      [
        () => { em.persist(copy) },
        () => {
          for (const op of sourceOperations) {
            em.create(RoutingOperation, {
              tenantId: source.tenantId,
              organizationId: source.organizationId,
              routingId: copy.id,
              sequence: op.sequence,
              name: op.name,
              workCenterId: op.workCenterId,
              setupTimeMinutes: op.setupTimeMinutes,
              runTimePerUnitSeconds: op.runTimePerUnitSeconds,
              isReportingPoint: op.isReportingPoint,
            } as never)
          }
        },
      ],
      { transaction: true, label: 'production.routings.copyVersion' },
    )

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'created',
      entity: copy,
      identifiers: { id: copy.id, organizationId: source.organizationId, tenantId: source.tenantId },
      indexer: routingCrudIndexer,
      events: routingCrudEvents,
    })

    return { id: copy.id }
  },

  async captureAfter(_input, result, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadRoutingSnapshot(em, result.id)
  },

  async buildLog({ result, snapshots }) {
    const { translate } = await resolveTranslations()
    const after = snapshots.after as RoutingSnapshot | undefined
    return {
      actionLabel: translate('production.audit.routing.copy_version', 'Copy routing version'),
      resourceKind: 'production.routing',
      resourceId: result.id,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },

  async undo({ logEntry, ctx }) {
    const after = extractUndoPayload<UndoPayload<RoutingSnapshot>>(logEntry)?.after
    if (!after) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const routing = await em.findOne(Routing, { id: after.id })
    if (routing) {
      await withAtomicFlush(
        em,
        [async () => removeExistingRoutingOperations(em, routing.id), () => { em.remove(routing) }],
        { transaction: true, label: 'production.routings.copyVersion.undo' },
      )
      await emitCrudUndoSideEffects({
        dataEngine: resolveDataEngine(ctx),
        action: 'deleted',
        entity: routing,
        identifiers: { id: after.id, organizationId: after.organizationId, tenantId: after.tenantId },
        indexer: routingCrudIndexer,
        events: routingCrudEvents,
      })
    }
  },
}

type RoutingActivateUndoPayload = UndoPayload<RoutingSnapshot> & { archivedSiblingIds?: string[] }

const activateRoutingCommand: CommandHandler<{ id: string }, { ok: boolean; archivedSiblingIds: string[] }> = {
  id: 'production.routings.activate',

  async prepare(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    return { before: await loadRoutingSnapshot(em, input.id) }
  },

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const routing = await em.findOne(Routing, { id: input.id, deletedAt: null })
    if (!routing) throw new CrudHttpError(404, { error: '[internal] Routing not found' })

    ensureTenantScope(ctx, routing.tenantId)
    ensureOrganizationScope(ctx, routing.organizationId)

    // Routings do not reference other routings, so there is no cycle to
    // validate here (unlike BOMs). Only one active version per product/variant
    // scope: archive any other currently active routing for the same scope.
    const otherActive = await em.find(Routing, {
      tenantId: routing.tenantId,
      organizationId: routing.organizationId,
      productId: routing.productId,
      variantId: routing.variantId ?? null,
      status: 'active',
      deletedAt: null,
    })

    await withAtomicFlush(
      em,
      [
        () => {
          for (const other of otherActive) {
            if (other.id === routing.id) continue
            other.status = 'archived'
            other.updatedAt = new Date()
          }
          routing.status = 'active'
          routing.updatedAt = new Date()
        },
      ],
      { transaction: true, label: 'production.routings.activate' },
    )

    const dataEngine = resolveDataEngine(ctx)
    // Indexer-only (no `events`): `production.routing.activated` below is the
    // declared lifecycle event for this transition, so this call must not
    // also fire a redundant `production.routing.updated`.
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: routing,
      identifiers: { id: routing.id, organizationId: routing.organizationId, tenantId: routing.tenantId },
      indexer: routingCrudIndexer,
    })
    const archivedSiblingIds = otherActive.filter((other) => other.id !== routing.id).map((other) => other.id)
    for (const other of otherActive) {
      if (other.id === routing.id) continue
      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: other,
        identifiers: { id: other.id, organizationId: other.organizationId, tenantId: other.tenantId },
        indexer: routingCrudIndexer,
      })
    }

    await emitProductionEvent('production.routing.activated', { id: routing.id, tenantId: routing.tenantId, organizationId: routing.organizationId })

    return { ok: true, archivedSiblingIds }
  },

  async captureAfter(input, _result, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadRoutingSnapshot(em, input.id)
  },

  async buildLog({ input, result, snapshots }) {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as RoutingSnapshot | undefined
    const after = snapshots.after as RoutingSnapshot | undefined
    return {
      actionLabel: translate('production.audit.routing.activate', 'Activate routing version'),
      resourceKind: 'production.routing',
      resourceId: input.id,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: {
          before,
          after,
          archivedSiblingIds: result.archivedSiblingIds,
        } satisfies RoutingActivateUndoPayload,
      },
    }
  },

  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<RoutingActivateUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const routing = await em.findOne(Routing, { id: before.id })
    if (!routing) return

    // Restore the siblings this activation archived (finding #3), only if
    // they are still archived at undo time (best-effort, same guard as BOM).
    const archivedSiblingIds = payload?.archivedSiblingIds ?? []
    const siblings = archivedSiblingIds.length
      ? await em.find(Routing, { id: { $in: archivedSiblingIds }, deletedAt: null })
      : []
    const siblingsToRestore = siblings.filter((sib) => sib.status === 'archived')

    await withAtomicFlush(
      em,
      [
        () => {
          routing.status = before.status
          routing.updatedAt = new Date()
          for (const sib of siblingsToRestore) {
            sib.status = 'active'
            sib.updatedAt = new Date()
          }
        },
      ],
      { transaction: true, label: 'production.routings.activate.undo' },
    )

    const dataEngine = resolveDataEngine(ctx)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: routing,
      identifiers: { id: routing.id, organizationId: routing.organizationId, tenantId: routing.tenantId },
      indexer: routingCrudIndexer,
    })
    for (const sib of siblingsToRestore) {
      await emitCrudUndoSideEffects({
        dataEngine,
        action: 'updated',
        entity: sib,
        identifiers: { id: sib.id, organizationId: sib.organizationId, tenantId: sib.tenantId },
        indexer: routingCrudIndexer,
      })
    }
  },
}

// ---------------------------------------------------------------------------
// Planning params
// ---------------------------------------------------------------------------

type PlanningParamsSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  productId: string
  variantId: string | null
  procurement: ProcurementType
  leadTimeDays: number
  minLot: string
  lotMultiple: string
  safetyStock: string
  backflush: boolean
}

function snapshotPlanningParams(row: ProductPlanningParams): PlanningParamsSnapshot {
  return {
    id: row.id,
    tenantId: row.tenantId,
    organizationId: row.organizationId,
    productId: row.productId,
    variantId: row.variantId ?? null,
    procurement: row.procurement,
    leadTimeDays: row.leadTimeDays,
    minLot: row.minLot,
    lotMultiple: row.lotMultiple,
    safetyStock: row.safetyStock,
    backflush: row.backflush,
  }
}

const createPlanningParamsCommand: CommandHandler<PlanningParamsCreateInput, { id: string }> = {
  id: 'production.planning_params.create',

  async execute(input, ctx) {
    const { tenantId, organizationId } = requireScopeIds(ctx)
    const em = ctx.container.resolve<EntityManager>('em').fork()

    const row = em.create(ProductPlanningParams, {
      tenantId,
      organizationId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      procurement: input.procurement,
      leadTimeDays: input.leadTimeDays,
      minLot: String(input.minLot),
      lotMultiple: String(input.lotMultiple),
      safetyStock: String(input.safetyStock),
      backflush: input.backflush,
    } as never)

    await withAtomicFlush(em, [() => { em.persist(row) }], { transaction: true, label: 'production.planning_params.create' })

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'created',
      entity: row,
      identifiers: { id: row.id, organizationId, tenantId },
      indexer: planningParamsCrudIndexer,
    })

    return { id: row.id }
  },

  async captureAfter(_input, result, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    const row = await em.findOne(ProductPlanningParams, { id: result.id })
    return row ? snapshotPlanningParams(row) : null
  },

  async buildLog({ result, snapshots }) {
    const { translate } = await resolveTranslations()
    const after = snapshots.after as PlanningParamsSnapshot | undefined
    return {
      actionLabel: translate('production.audit.planning_params.create', 'Create planning parameters'),
      resourceKind: 'production.planning_params',
      resourceId: result.id,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after,
      payload: { undo: { after } },
    }
  },

  async undo({ logEntry, ctx }) {
    const after = extractUndoPayload<UndoPayload<PlanningParamsSnapshot>>(logEntry)?.after
    if (!after) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const row = await em.findOne(ProductPlanningParams, { id: after.id })
    if (row) {
      await withAtomicFlush(em, [() => { em.remove(row) }], { transaction: true, label: 'production.planning_params.create.undo' })
      await emitCrudUndoSideEffects({
        dataEngine: resolveDataEngine(ctx),
        action: 'deleted',
        entity: row,
        identifiers: { id: after.id, organizationId: after.organizationId, tenantId: after.tenantId },
        indexer: planningParamsCrudIndexer,
      })
    }
  },
}

const updatePlanningParamsCommand: CommandHandler<PlanningParamsUpdateInput, { ok: boolean }> = {
  id: 'production.planning_params.update',

  async prepare(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    const row = await em.findOne(ProductPlanningParams, { id: input.id, deletedAt: null })
    return { before: row ? snapshotPlanningParams(row) : null }
  },

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const row = await em.findOne(ProductPlanningParams, { id: input.id, deletedAt: null })
    if (!row) throw new CrudHttpError(404, { error: '[internal] Planning parameters not found' })

    ensureTenantScope(ctx, row.tenantId)
    ensureOrganizationScope(ctx, row.organizationId)

    await withAtomicFlush(
      em,
      [
        () => {
          if (input.procurement !== undefined) row.procurement = input.procurement
          if (input.leadTimeDays !== undefined) row.leadTimeDays = input.leadTimeDays
          if (input.minLot !== undefined) row.minLot = String(input.minLot)
          if (input.lotMultiple !== undefined) row.lotMultiple = String(input.lotMultiple)
          if (input.safetyStock !== undefined) row.safetyStock = String(input.safetyStock)
          if (input.backflush !== undefined) row.backflush = input.backflush
          row.updatedAt = new Date()
        },
      ],
      { transaction: true, label: 'production.planning_params.update' },
    )

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'updated',
      entity: row,
      identifiers: { id: row.id, organizationId: row.organizationId, tenantId: row.tenantId },
      indexer: planningParamsCrudIndexer,
    })

    return { ok: true }
  },

  async captureAfter(input, _result, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    const row = await em.findOne(ProductPlanningParams, { id: input.id })
    return row ? snapshotPlanningParams(row) : null
  },

  async buildLog({ input, snapshots }) {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as PlanningParamsSnapshot | undefined
    const after = snapshots.after as PlanningParamsSnapshot | undefined
    return {
      actionLabel: translate('production.audit.planning_params.update', 'Update planning parameters'),
      resourceKind: 'production.planning_params',
      resourceId: input.id,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: { undo: { before, after } },
    }
  },

  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<PlanningParamsSnapshot>>(logEntry)?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const row = await em.findOne(ProductPlanningParams, { id: before.id })
    if (row) {
      await withAtomicFlush(
        em,
        [
          () => {
            row.procurement = before.procurement
            row.leadTimeDays = before.leadTimeDays
            row.minLot = before.minLot
            row.lotMultiple = before.lotMultiple
            row.safetyStock = before.safetyStock
            row.backflush = before.backflush
            row.updatedAt = new Date()
          },
        ],
        { transaction: true, label: 'production.planning_params.update.undo' },
      )
      await emitCrudUndoSideEffects({
        dataEngine: resolveDataEngine(ctx),
        action: 'updated',
        entity: row,
        identifiers: { id: row.id, organizationId: row.organizationId, tenantId: row.tenantId },
        indexer: planningParamsCrudIndexer,
      })
    }
  },
}

const deletePlanningParamsCommand: CommandHandler<{ id: string }, { ok: boolean }> = {
  id: 'production.planning_params.delete',

  async prepare(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em')
    const row = await em.findOne(ProductPlanningParams, { id: input.id, deletedAt: null })
    return { before: row ? snapshotPlanningParams(row) : null }
  },

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const row = await em.findOne(ProductPlanningParams, { id: input.id, deletedAt: null })
    if (!row) throw new CrudHttpError(404, { error: '[internal] Planning parameters not found' })

    ensureTenantScope(ctx, row.tenantId)
    ensureOrganizationScope(ctx, row.organizationId)

    await withAtomicFlush(
      em,
      [
        () => {
          row.deletedAt = new Date()
          row.updatedAt = new Date()
        },
      ],
      { transaction: true, label: 'production.planning_params.delete' },
    )

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'deleted',
      entity: row,
      identifiers: { id: row.id, organizationId: row.organizationId, tenantId: row.tenantId },
      indexer: planningParamsCrudIndexer,
    })

    return { ok: true }
  },

  async buildLog({ input, snapshots }) {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as PlanningParamsSnapshot | undefined
    return {
      actionLabel: translate('production.audit.planning_params.delete', 'Delete planning parameters'),
      resourceKind: 'production.planning_params',
      resourceId: input.id,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before,
      payload: { undo: { before } },
    }
  },

  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<PlanningParamsSnapshot>>(logEntry)?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const row = await em.findOne(ProductPlanningParams, { id: before.id })
    if (row) {
      await withAtomicFlush(
        em,
        [
          () => {
            row.deletedAt = null
            row.updatedAt = new Date()
          },
        ],
        { transaction: true, label: 'production.planning_params.delete.undo' },
      )
      await emitCrudUndoSideEffects({
        dataEngine: resolveDataEngine(ctx),
        action: 'created',
        entity: row,
        identifiers: { id: row.id, organizationId: row.organizationId, tenantId: row.tenantId },
        indexer: planningParamsCrudIndexer,
      })
    }
  },
}

registerCommand(createWorkCenterCommand)
registerCommand(updateWorkCenterCommand)
registerCommand(deleteWorkCenterCommand)

registerCommand(createBomCommand)
registerCommand(updateBomCommand)
registerCommand(deleteBomCommand)
registerCommand(copyVersionBomCommand)
registerCommand(activateBomCommand)

registerCommand(createRoutingCommand)
registerCommand(updateRoutingCommand)
registerCommand(deleteRoutingCommand)
registerCommand(copyVersionRoutingCommand)
registerCommand(activateRoutingCommand)

registerCommand(createPlanningParamsCommand)
registerCommand(updatePlanningParamsCommand)
registerCommand(deletePlanningParamsCommand)
