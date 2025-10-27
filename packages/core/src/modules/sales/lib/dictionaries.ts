import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary } from '@open-mercato/core/modules/dictionaries/data/entities'

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
    })
    em.persist(dictionary)
    await em.flush()
  }
  return dictionary
}

export function normalizeDictionaryValue(value: string): string {
  return value.trim().toLowerCase()
}

export function sanitizeDictionaryColor(color: string | null | undefined): string | null {
  if (!color) return null
  const trimmed = color.trim()
  if (!trimmed) return null
  const match = /^#([0-9a-fA-F]{6})$/.exec(trimmed)
  if (!match) return null
  return `#${match[1].toLowerCase()}`
}

export function sanitizeDictionaryIcon(icon: string | null | undefined): string | null {
  if (!icon) return null
  const trimmed = icon.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 64)
}
