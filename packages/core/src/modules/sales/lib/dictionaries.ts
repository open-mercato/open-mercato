import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import {
  normalizeDictionaryValue,
  sanitizeDictionaryColor,
  sanitizeDictionaryIcon,
} from '@open-mercato/core/modules/dictionaries/lib/utils'

export type SalesDictionaryKind =
  | 'order-status'
  | 'order-line-status'
  | 'shipment-status'
  | 'payment-status'
  | 'adjustment-kind'

type SalesDictionaryDefinition = {
  key: string
  name: string
  singular: string
  description: string
  resourceKind: string
  commandPrefix: string
}

const DEFINITIONS: Record<SalesDictionaryKind, SalesDictionaryDefinition> = {
  'order-status': {
    key: 'sales.order_status',
    name: 'Sales order statuses',
    singular: 'Sales order status',
    description: 'Configurable set of statuses used by sales orders.',
    resourceKind: 'sales.order-status',
    commandPrefix: 'sales.order-statuses',
  },
  'order-line-status': {
    key: 'sales.order_line_status',
    name: 'Sales order line statuses',
    singular: 'Sales order line status',
    description: 'Configurable set of statuses used by sales order lines.',
    resourceKind: 'sales.order-line-status',
    commandPrefix: 'sales.order-line-statuses',
  },
  'shipment-status': {
    key: 'sales.shipment_status',
    name: 'Shipment statuses',
    singular: 'Shipment status',
    description: 'Configurable set of statuses used by shipments.',
    resourceKind: 'sales.shipment-status',
    commandPrefix: 'sales.shipment-statuses',
  },
  'payment-status': {
    key: 'sales.payment_status',
    name: 'Payment statuses',
    singular: 'Payment status',
    description: 'Configurable set of statuses used by payments.',
    resourceKind: 'sales.payment-status',
    commandPrefix: 'sales.payment-statuses',
  },
  'adjustment-kind': {
    key: 'sales.adjustment_kind',
    name: 'Sales adjustment kinds',
    singular: 'Sales adjustment kind',
    description: 'Reusable adjustment kinds applied to sales documents.',
    resourceKind: 'sales.adjustment-kind',
    commandPrefix: 'sales.adjustment-kinds',
  },
}

export function getSalesDictionaryDefinition(kind: SalesDictionaryKind): SalesDictionaryDefinition {
  return DEFINITIONS[kind]
}

export async function ensureSalesDictionary(params: {
  em: EntityManager
  tenantId: string
  organizationId: string
  kind: SalesDictionaryKind
}): Promise<Dictionary> {
  const { em, tenantId, organizationId, kind } = params
  const def = getSalesDictionaryDefinition(kind)
  let dictionary = await em.findOne(Dictionary, {
    tenantId,
    organizationId,
    key: def.key,
    deletedAt: null,
  })
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      tenantId,
      organizationId,
      key: def.key,
      name: def.name,
      description: def.description,
      isSystem: true,
      isActive: true,
      managerVisibility: 'hidden',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(dictionary)
    await em.flush()
  }
  return dictionary
}

export async function resolveDictionaryEntryValue(
  em: EntityManager,
  entryId: string | null | undefined
): Promise<string | null> {
  if (!entryId) return null
  const entry = await em.findOne(DictionaryEntry, entryId)
  if (!entry) return null
  return entry.value?.trim() || null
}

export { normalizeDictionaryValue, sanitizeDictionaryColor, sanitizeDictionaryIcon }

type SalesDictionarySeed = {
  value: string
  label: string
  color?: string | null
  icon?: string | null
}

type SeedScope = { tenantId: string; organizationId: string }

const ORDER_STATUS_DEFAULTS: SalesDictionarySeed[] = [
  { value: 'draft', label: 'Draft', color: '#94a3b8', icon: 'lucide:file-pen-line' },
  { value: 'sent', label: 'Sent', color: '#0ea5e9', icon: 'lucide:send' },
  { value: 'confirmed', label: 'Confirmed', color: '#2563eb', icon: 'lucide:badge-check' },
  { value: 'in_fulfillment', label: 'In fulfillment', color: '#f59e0b', icon: 'lucide:loader-2' },
  { value: 'fulfilled', label: 'Fulfilled', color: '#16a34a', icon: 'lucide:check-circle-2' },
  { value: 'on_hold', label: 'On hold', color: '#a855f7', icon: 'lucide:pause-circle' },
  { value: 'canceled', label: 'Canceled', color: '#ef4444', icon: 'lucide:x-circle' },
]

const ORDER_LINE_STATUS_DEFAULTS: SalesDictionarySeed[] = [
  { value: 'pending', label: 'Pending', color: '#94a3b8', icon: 'lucide:clock' },
  { value: 'allocated', label: 'Allocated', color: '#6366f1', icon: 'lucide:inbox' },
  { value: 'picking', label: 'Picking', color: '#f59e0b', icon: 'lucide:hand' },
  { value: 'packed', label: 'Packed', color: '#0ea5e9', icon: 'lucide:package' },
  { value: 'shipped', label: 'Shipped', color: '#2563eb', icon: 'lucide:truck' },
  { value: 'delivered', label: 'Delivered', color: '#16a34a', icon: 'lucide:check-circle-2' },
  { value: 'backordered', label: 'Backordered', color: '#d946ef', icon: 'lucide:alert-octagon' },
  { value: 'returned', label: 'Returned', color: '#0d9488', icon: 'lucide:undo-2' },
  { value: 'canceled', label: 'Canceled', color: '#ef4444', icon: 'lucide:x-circle' },
]

const SHIPMENT_STATUS_DEFAULTS: SalesDictionarySeed[] = [
  { value: 'pending', label: 'Pending', color: '#94a3b8', icon: 'lucide:clock-3' },
  { value: 'packed', label: 'Packed', color: '#22c55e', icon: 'lucide:package-check' },
  { value: 'shipped', label: 'Shipped', color: '#2563eb', icon: 'lucide:truck' },
  { value: 'in_transit', label: 'In transit', color: '#0ea5e9', icon: 'lucide:loader' },
  { value: 'delivered', label: 'Delivered', color: '#16a34a', icon: 'lucide:check-circle-2' },
  { value: 'canceled', label: 'Canceled', color: '#ef4444', icon: 'lucide:x-circle' },
  { value: 'returned', label: 'Returned', color: '#0d9488', icon: 'lucide:undo-2' },
]

const PAYMENT_STATUS_DEFAULTS: SalesDictionarySeed[] = [
  { value: 'pending', label: 'Pending', color: '#94a3b8', icon: 'lucide:clock-3' },
  { value: 'authorized', label: 'Authorized', color: '#6366f1', icon: 'lucide:badge-check' },
  { value: 'captured', label: 'Captured', color: '#0ea5e9', icon: 'lucide:banknote' },
  { value: 'received', label: 'Received', color: '#16a34a', icon: 'lucide:check' },
  { value: 'refunded', label: 'Refunded', color: '#f59e0b', icon: 'lucide:rotate-ccw' },
  { value: 'failed', label: 'Failed', color: '#ef4444', icon: 'lucide:triangle-alert' },
  { value: 'canceled', label: 'Canceled', color: '#ef4444', icon: 'lucide:x-circle' },
]

const ADJUSTMENT_KIND_DEFAULTS: SalesDictionarySeed[] = [
  { value: 'discount', label: 'Discount' },
  { value: 'tax', label: 'Tax' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'surcharge', label: 'Surcharge' },
  { value: 'custom', label: 'Custom' },
]

async function ensureSalesDictionaryEntry(
  em: EntityManager,
  scope: SeedScope,
  kind: SalesDictionaryKind,
  seed: SalesDictionarySeed
): Promise<DictionaryEntry | null> {
  const value = seed.value?.trim()
  if (!value) return null
  const dictionary = await ensureSalesDictionary({
    em,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    kind,
  })
  const normalizedValue = normalizeDictionaryValue(value)
  const color = seed.color === undefined ? undefined : sanitizeDictionaryColor(seed.color)
  const icon = seed.icon === undefined ? undefined : sanitizeDictionaryIcon(seed.icon)
  const existing = await em.findOne(DictionaryEntry, {
    dictionary,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    normalizedValue,
  })
  if (existing) {
    let changed = false
    if (color !== undefined && existing.color !== color) {
      existing.color = color ?? null
      changed = true
    }
    if (icon !== undefined && existing.icon !== icon) {
      existing.icon = icon ?? null
      changed = true
    }
    if (changed) {
      existing.updatedAt = new Date()
      em.persist(existing)
    }
    return existing
  }
  const now = new Date()
  const entry = em.create(DictionaryEntry, {
    dictionary,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    value,
    label: seed.label?.trim() || value,
    normalizedValue,
    color: color ?? null,
    icon: icon ?? null,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(entry)
  return entry
}

async function seedSalesDictionary(
  em: EntityManager,
  scope: SeedScope,
  kind: SalesDictionaryKind,
  defaults: SalesDictionarySeed[]
): Promise<void> {
  for (const seed of defaults) {
    await ensureSalesDictionaryEntry(em, scope, kind, seed)
  }
}

export async function seedSalesStatusDictionaries(
  em: EntityManager,
  scope: SeedScope
): Promise<void> {
  await seedSalesDictionary(em, scope, 'order-status', ORDER_STATUS_DEFAULTS)
  await seedSalesDictionary(em, scope, 'order-line-status', ORDER_LINE_STATUS_DEFAULTS)
  await seedSalesDictionary(em, scope, 'shipment-status', SHIPMENT_STATUS_DEFAULTS)
  await seedSalesDictionary(em, scope, 'payment-status', PAYMENT_STATUS_DEFAULTS)
}

export async function seedSalesAdjustmentKinds(
  em: EntityManager,
  scope: SeedScope
): Promise<void> {
  await seedSalesDictionary(em, scope, 'adjustment-kind', ADJUSTMENT_KIND_DEFAULTS)
}

export async function seedSalesDictionaries(
  em: EntityManager,
  scope: SeedScope
): Promise<void> {
  await seedSalesStatusDictionaries(em, scope)
  await seedSalesAdjustmentKinds(em, scope)
}

export const DEFAULT_ADJUSTMENT_KIND_VALUES = ADJUSTMENT_KIND_DEFAULTS.map((entry) => entry.value)
