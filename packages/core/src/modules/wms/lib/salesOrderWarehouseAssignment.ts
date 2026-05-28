import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesOrderWarehouseAssignment, Warehouse } from '../data/entities'

type Scope = {
  tenantId: string
  organizationId: string
}

export type SalesOrderWarehouseAssignmentView = {
  id: string
  salesOrderId: string
  warehouseId: string
  warehouseName: string | null
  warehouseCode: string | null
  notes: string | null
  assignedBy: string | null
}

function resolveWarehouseId(assignment: SalesOrderWarehouseAssignment): string | null {
  const warehouseRel = assignment.warehouse as { id?: string } | undefined
  return typeof warehouseRel?.id === 'string' ? warehouseRel.id : null
}

export async function loadExplicitWarehouseIdForOrder(
  em: EntityManager,
  salesOrderId: string,
  scope: Scope,
): Promise<string | null> {
  const assignment = await findOneWithDecryption(
    em,
    SalesOrderWarehouseAssignment,
    {
      salesOrderId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    { populate: ['warehouse'] },
    scope,
  )
  if (!assignment) return null
  return resolveWarehouseId(assignment)
}

export async function loadSalesOrderWarehouseAssignmentView(
  em: EntityManager,
  salesOrderId: string,
  scope: Scope,
): Promise<SalesOrderWarehouseAssignmentView | null> {
  const assignment = await findOneWithDecryption(
    em,
    SalesOrderWarehouseAssignment,
    {
      salesOrderId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    { populate: ['warehouse'] },
    scope,
  )
  if (!assignment) return null

  const warehouseId = resolveWarehouseId(assignment)
  if (!warehouseId) return null

  const warehouse = assignment.warehouse as Warehouse | undefined
  return {
    id: assignment.id,
    salesOrderId: assignment.salesOrderId,
    warehouseId,
    warehouseName: warehouse?.name ?? null,
    warehouseCode: warehouse?.code ?? null,
    notes: assignment.notes ?? null,
    assignedBy: assignment.assignedBy ?? null,
  }
}
