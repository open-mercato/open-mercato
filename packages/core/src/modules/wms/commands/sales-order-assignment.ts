import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { SalesOrderWarehouseAssignment, Warehouse } from '../data/entities'
import type { SalesOrderWarehouseAssignInput, SalesOrderWarehouseUnassignInput } from '../data/validators'
import { z } from 'zod'
import { reserveInventoryForConfirmedOrder } from '../lib/salesOrderInventoryAutomation'
import { ensureOrganizationScope, ensureTenantScope } from './shared'

type AssignmentSnapshot = {
  id: string
  salesOrderId: string
  warehouseId: string
  notes: string | null
  organizationId: string
  tenantId: string
}

type AssignWarehouseUndoPayload = {
  before: AssignmentSnapshot | null
  after: AssignmentSnapshot | null
}

type UnassignWarehouseUndoPayload = {
  before: AssignmentSnapshot | null
}

function resolveScope(
  ctx: CommandRuntimeContext,
  fallback?: { tenantId?: string | null; organizationId?: string | null },
) {
  return {
    tenantId: fallback?.tenantId ?? ctx.auth?.tenantId ?? null,
    organizationId: fallback?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
  }
}

function resolveEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

async function loadAssignment(
  em: EntityManager,
  salesOrderId: string,
  scope: ReturnType<typeof resolveScope>,
): Promise<SalesOrderWarehouseAssignment | null> {
  if (!scope.organizationId || !scope.tenantId) return null
  return findOneWithDecryption(
    em,
    SalesOrderWarehouseAssignment,
    {
      salesOrderId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    undefined,
    scope as { organizationId: string; tenantId: string },
  )
}

function snapshotAssignment(
  assignment: SalesOrderWarehouseAssignment | null,
): AssignmentSnapshot | null {
  if (!assignment) return null
  const warehouseRel = assignment.warehouse as { id?: string } | undefined
  const warehouseId = warehouseRel?.id ?? ''
  return {
    id: assignment.id,
    salesOrderId: assignment.salesOrderId,
    warehouseId,
    notes: assignment.notes ?? null,
    organizationId: assignment.organizationId,
    tenantId: assignment.tenantId,
  }
}

const assignWarehouseHandler: CommandHandler<
  SalesOrderWarehouseAssignInput,
  { assignmentId: string; warehouseId: string }
> = {
  id: 'wms.sales-order.assign-warehouse',

  prepare: async (input, ctx) => {
    const scope = resolveScope(ctx, input)
    const em = resolveEm(ctx)
    const existing = await loadAssignment(em, input.salesOrderId, scope)
    return { before: snapshotAssignment(existing) }
  },

  execute: async (input, ctx) => {
    const scope = resolveScope(ctx, input)
    if (!scope.tenantId || !scope.organizationId) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }
    const em = resolveEm(ctx)

    const warehouse = await findOneWithDecryption(
      em,
      Warehouse,
      {
        id: input.warehouseId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      undefined,
      scope as { organizationId: string; tenantId: string },
    )
    if (!warehouse) throw new CrudHttpError(404, { error: 'Warehouse not found.' })
    ensureTenantScope(ctx, warehouse.tenantId)
    ensureOrganizationScope(ctx, warehouse.organizationId)
    if (!warehouse.isActive) throw new CrudHttpError(422, { error: 'Warehouse is inactive.' })

    const existing = await loadAssignment(em, input.salesOrderId, scope)

    if (existing) {
      existing.warehouse = warehouse
      existing.notes = input.notes ?? null
      existing.assignedBy = ctx.auth?.sub ?? null
      existing.updatedAt = new Date()
      await em.flush()
      return { assignmentId: existing.id, warehouseId: warehouse.id }
    }

    const assignment = em.create(SalesOrderWarehouseAssignment, {
      salesOrderId: input.salesOrderId,
      warehouse,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      assignedBy: ctx.auth?.sub ?? null,
      notes: input.notes ?? null,
    })
    em.persist(assignment)
    await em.flush()
    return { assignmentId: assignment.id, warehouseId: warehouse.id }
  },

  captureAfter: async (input, _result, ctx) => {
    const scope = resolveScope(ctx, input)
    const em = resolveEm(ctx)
    const updated = await loadAssignment(em, input.salesOrderId, scope)
    return { after: snapshotAssignment(updated) }
  },

  buildLog: async ({ input, result, ctx, snapshots }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('wms.audit.salesOrder.assignWarehouse', 'Assign warehouse to order'),
      resourceKind: 'wms.sales_order_warehouse_assignment',
      resourceId: result?.assignmentId ?? null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      payload: {
        undo: {
          before: (snapshots as { before?: AssignmentSnapshot | null })?.before ?? null,
          after: (snapshots as { after?: AssignmentSnapshot | null })?.after ?? null,
        } satisfies AssignWarehouseUndoPayload,
      },
    }
  },

  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AssignWarehouseUndoPayload>(logEntry)
    if (!payload) return
    const em = resolveEm(ctx)

    const after = payload.after
    const before = payload.before

    if (after) {
      const scope = { tenantId: after.tenantId, organizationId: after.organizationId }
      const assignment = await findOneWithDecryption(
        em,
        SalesOrderWarehouseAssignment,
        { id: after.id, organizationId: after.organizationId, tenantId: after.tenantId },
        undefined,
        scope,
      )
      if (!assignment) return

      if (!before) {
        assignment.deletedAt = new Date()
        await em.flush()
        return
      }

      const previousWarehouse = await findOneWithDecryption(
        em,
        Warehouse,
        {
          id: before.warehouseId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        },
        undefined,
        scope,
      )
      if (!previousWarehouse) {
        assignment.deletedAt = new Date()
        await em.flush()
        return
      }

      assignment.warehouse = previousWarehouse
      assignment.notes = before.notes ?? null
      await em.flush()
    }
  },
}

const unassignWarehouseHandler: CommandHandler<
  SalesOrderWarehouseUnassignInput,
  { ok: true }
> = {
  id: 'wms.sales-order.unassign-warehouse',

  prepare: async (input, ctx) => {
    const scope = resolveScope(ctx, input)
    const em = resolveEm(ctx)
    const existing = await loadAssignment(em, input.salesOrderId, scope)
    return { before: snapshotAssignment(existing) }
  },

  execute: async (input, ctx) => {
    const scope = resolveScope(ctx, input)
    if (!scope.tenantId || !scope.organizationId) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }
    const em = resolveEm(ctx)
    const existing = await loadAssignment(em, input.salesOrderId, scope)

    if (existing) {
      existing.deletedAt = new Date()
      await em.flush()
    }

    return { ok: true as const }
  },

  buildLog: async ({ input, ctx, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = (snapshots as { before?: AssignmentSnapshot | null })?.before ?? null
    return {
      actionLabel: translate('wms.audit.salesOrder.unassignWarehouse', 'Remove warehouse assignment from order'),
      resourceKind: 'wms.sales_order_warehouse_assignment',
      resourceId: before?.id ?? null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      payload: {
        undo: { before } satisfies UnassignWarehouseUndoPayload,
      },
    }
  },

  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UnassignWarehouseUndoPayload>(logEntry)
    const before = payload?.before
    if (!before?.salesOrderId || !before.warehouseId) return

    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    const em = resolveEm(ctx)

    const existingDeleted = await findOneWithDecryption(
      em,
      SalesOrderWarehouseAssignment,
      { id: before.id, organizationId: before.organizationId, tenantId: before.tenantId },
      undefined,
      scope,
    )

    if (existingDeleted) {
      existingDeleted.deletedAt = null
      await em.flush()
      return
    }

    const warehouse = await findOneWithDecryption(
      em,
      Warehouse,
      {
        id: before.warehouseId,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    if (!warehouse) return

    const restored = em.create(SalesOrderWarehouseAssignment, {
      salesOrderId: before.salesOrderId,
      warehouse,
      organizationId: before.organizationId,
      tenantId: before.tenantId,
      notes: before.notes ?? null,
    })
    em.persist(restored)
    await em.flush()
  },
}

registerCommand(assignWarehouseHandler)
registerCommand(unassignWarehouseHandler)

export const reRunReservationInputSchema = z.object({
  salesOrderId: z.string().uuid(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
})
export type ReRunReservationInput = z.infer<typeof reRunReservationInputSchema>

const reRunReservationHandler: CommandHandler<ReRunReservationInput, { ok: boolean }> = {
  id: 'wms.sales-order.re-run-reservation',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = reRunReservationInputSchema.parse(rawInput)
    const eventCtx = {
      resolve: <T>(name: string) => ctx.container.resolve<T>(name),
    }
    await reserveInventoryForConfirmedOrder(
      { orderId: input.salesOrderId, tenantId: input.tenantId, organizationId: input.organizationId },
      eventCtx,
    )
    return { ok: true }
  },
  async buildLog({ input, ctx }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('wms.audit.salesOrder.reRunReservation', 'Re-run reservation for order'),
      resourceKind: 'wms.sales_order_reservation',
      resourceId: input?.salesOrderId ?? null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

registerCommand(reRunReservationHandler)
