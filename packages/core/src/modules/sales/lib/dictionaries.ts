import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import {
  normalizeDictionaryValue,
  sanitizeDictionaryColor,
  sanitizeDictionaryIcon,
} from '@open-mercato/core/modules/dictionaries/lib/utils'

export type SalesDictionaryKind = 'order-status' | 'order-line-status'

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

type SalesStatusSeed = {
  value: string
  label: string
  color?: string | null
  icon?: string | null
}

type SeedScope = { tenantId: string; organizationId: string }

const ORDER_STATUS_DEFAULTS: SalesStatusSeed[] = [
  { value: 'draft', label: 'Draft', color: '#94a3b8', icon: 'lucide:file-pen-line' },
  { value: 'confirmed', label: 'Confirmed', color: '#2563eb', icon: 'lucide:badge-check' },
  { value: 'in_fulfillment', label: 'In fulfillment', color: '#f59e0b', icon: 'lucide:loader-2' },
  { value: 'fulfilled', label: 'Fulfilled', color: '#16a34a', icon: 'lucide:check-circle-2' },
  { value: 'on_hold', label: 'On hold', color: '#a855f7', icon: 'lucide:pause-circle' },
  { value: 'canceled', label: 'Canceled', color: '#ef4444', icon: 'lucide:x-circle' },
]

const ORDER_LINE_STATUS_DEFAULTS: SalesStatusSeed[] = [
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

async function ensureSalesDictionaryEntry(
  em: EntityManager,
  scope: SeedScope,
  kind: SalesDictionaryKind,
  seed: SalesStatusSeed
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
  defaults: SalesStatusSeed[]
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
}
