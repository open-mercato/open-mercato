import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesOrderLine, SalesShipment, SalesShipmentItem } from '../../data/entities'
import type { ShipmentItemSnapshot } from './types'

const cloneJson = <T>(value: T): T => {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export const coerceShipmentQuantity = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

const extractOrderLineId = (entry: SalesShipmentItem): string | null => {
  const raw =
    typeof entry.orderLine === 'string'
      ? entry.orderLine
      : entry.orderLine?.id ?? (entry as any).orderLineId ?? null
  return typeof raw === 'string' ? raw : null
}

const ensureLineMap = async (
  em: EntityManager,
  items: SalesShipmentItem[],
  lineMap?: Map<string, SalesOrderLine>
): Promise<Map<string, SalesOrderLine>> => {
  const map = lineMap ?? new Map<string, SalesOrderLine>()
  const missing: string[] = []
  items.forEach((item) => {
    const lineId = extractOrderLineId(item)
    if (!lineId || map.has(lineId)) return
    missing.push(lineId)
  })
  if (!missing.length) return map
  const lines = await em.find(SalesOrderLine, { id: { $in: missing } })
  lines.forEach((line) => map.set(line.id, line))
  return map
}

export const buildShipmentItemSnapshots = (
  items: SalesShipmentItem[],
  options?: { lineMap?: Map<string, SalesOrderLine> }
): ShipmentItemSnapshot[] => {
  const map = options?.lineMap ?? new Map<string, SalesOrderLine>()
  return items
    .map((item) => {
      const orderLineId = extractOrderLineId(item)
      if (!orderLineId) return null
      const line = map.get(orderLineId) ?? null
      const id = typeof item.id === 'string' ? item.id : randomUUID()
      const quantity = coerceShipmentQuantity(item.quantity)
      const metadata =
        item.metadata && typeof item.metadata === 'object' ? cloneJson(item.metadata) : null
      return {
        id,
        orderLineId,
        orderLineName: line?.name ?? null,
        orderLineNumber: line?.lineNumber ?? null,
        quantity,
        metadata,
      } satisfies ShipmentItemSnapshot
    })
    .filter((entry): entry is ShipmentItemSnapshot => Boolean(entry))
}

export const readShipmentItemsSnapshot = (raw: unknown): ShipmentItemSnapshot[] => {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const orderLineId =
        typeof (entry as any).orderLineId === 'string'
          ? (entry as any).orderLineId
          : typeof (entry as any).order_line_id === 'string'
            ? (entry as any).order_line_id
            : null
      if (!orderLineId) return null
      const quantity = coerceShipmentQuantity((entry as any).quantity)
      const orderLineNumberRaw = (entry as any).orderLineNumber ?? (entry as any).order_line_number
      const orderLineNumber =
        typeof orderLineNumberRaw === 'number' && Number.isFinite(orderLineNumberRaw)
          ? orderLineNumberRaw
          : typeof orderLineNumberRaw === 'string' && orderLineNumberRaw.trim().length
            ? Number(orderLineNumberRaw)
            : null
      const metadata =
        (entry as any).metadata && typeof (entry as any).metadata === 'object'
          ? cloneJson((entry as any).metadata as Record<string, unknown>)
          : null
      const orderLineName =
        typeof (entry as any).orderLineName === 'string'
          ? (entry as any).orderLineName
          : typeof (entry as any).order_line_name === 'string'
            ? (entry as any).order_line_name
            : null
      const id =
        typeof (entry as any).id === 'string' && (entry as any).id.length
          ? (entry as any).id
          : randomUUID()
      return {
        id,
        orderLineId,
        orderLineName,
        orderLineNumber: Number.isFinite(orderLineNumber) ? Number(orderLineNumber) : null,
        quantity,
        metadata,
      } satisfies ShipmentItemSnapshot
    })
    .filter((entry): entry is ShipmentItemSnapshot => Boolean(entry))
}

export const refreshShipmentItemsSnapshot = async (
  em: EntityManager,
  shipment: SalesShipment,
  options?: { items?: SalesShipmentItem[]; lineMap?: Map<string, SalesOrderLine> }
): Promise<ShipmentItemSnapshot[]> => {
  const items =
    options?.items ?? (await em.find(SalesShipmentItem, { shipment }, { populate: ['orderLine'] }))
  const map = await ensureLineMap(em, items, options?.lineMap)
  const snapshot = buildShipmentItemSnapshots(items, { lineMap: map })
  shipment.itemsSnapshot = snapshot.length ? snapshot : null
  return snapshot
}
