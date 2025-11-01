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
