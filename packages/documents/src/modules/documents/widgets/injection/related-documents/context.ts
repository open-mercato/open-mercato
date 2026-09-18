import { getEntityRegistryEntry, type DocumentEntityType } from '../../../lib/entityRegistry'
import { sanitizeDocumentsDisplayLabel } from '../../../lib/displayLabels'
import type { CollectionCapabilities } from '../../../backend/documents/documentsListTypes'

export type RelatedDocumentContext = {
  entityType: DocumentEntityType
  entityId: string
  label: string | null
  href: string
  values: Record<string, string>
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!value) return null
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

function displayText(value: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!value) return null
  for (const key of keys) {
    const candidate = sanitizeDocumentsDisplayLabel(value[key])
    if (candidate) return candidate
  }
  return null
}

function nested(value: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  return value ? record(value[key]) : null
}

function contextType(context: Record<string, unknown>): DocumentEntityType | null {
  const resourceKind = text(context, 'resourceKind', 'resource_kind')
  if (resourceKind === 'customers.person') return 'customer-person'
  if (resourceKind === 'customers.company') return 'customer-company'
  if (resourceKind === 'customers.deal') return 'deal'
  if (resourceKind === 'catalog.product') return 'product'
  const kind = text(context, 'kind')
  if (kind === 'quote') return 'quote'
  if (kind === 'order') return 'sales-order'
  return null
}

function contextItem(type: DocumentEntityType, data: Record<string, unknown> | null): Record<string, unknown> | null {
  return nested(data, type === 'customer-person' ? 'person' : type === 'customer-company' ? 'company' : type === 'deal' ? 'deal' : 'record') ?? data
}

function contextLabel(type: DocumentEntityType, item: Record<string, unknown> | null): string | null {
  if (type === 'customer-person') {
    const direct = displayText(item, 'displayName', 'display_name', 'name', 'fullName', 'full_name', 'email')
    if (direct) return direct
    const parts = [displayText(item, 'firstName', 'first_name'), displayText(item, 'lastName', 'last_name')].filter(Boolean)
    return sanitizeDocumentsDisplayLabel(parts.length ? parts.join(' ') : null)
  }
  if (type === 'customer-company') return displayText(item, 'displayName', 'display_name', 'name', 'legalName', 'legal_name', 'email')
  if (type === 'deal' || type === 'product') return displayText(item, 'title', 'name')
  if (type === 'quote') return displayText(item, 'quoteNumber', 'quote_number', 'number', 'title')
  if (type === 'sales-order') return displayText(item, 'orderNumber', 'order_number', 'number', 'title')
  return null
}

export function resolveRelatedDocumentContext(contextValue: unknown, dataValue?: unknown): RelatedDocumentContext | null {
  const context = record(contextValue)
  if (!context) return null
  const type = contextType(context)
  if (!type) return null
  const hostRecord = record(context.record)
  const data = record(dataValue) ?? record(context.data) ?? hostRecord
  const explicitContextId = text(context, 'resourceId', 'resource_id', 'recordId', 'record_id')
  const entityId = explicitContextId ?? text(hostRecord, 'id') ?? text(data, 'id')
  // Some edit hosts keep the id outside their form values, so CrudForm's generic
  // operation heuristic still reports "create" while version history supplies a
  // stable resource id. Treat that explicit host identity as authoritative, but
  // keep genuine create forms (which have no context id) hidden.
  if (text(context, 'operation') === 'create' && !explicitContextId) return null
  if (!entityId) return null
  const entry = getEntityRegistryEntry(type)
  if (!entry) return null
  const item = contextItem(type, data)
  const label = contextLabel(type, item)
  const href = entry.resolveHref({ id: entityId, label: label ?? '' })
  const values = Object.fromEntries(entry.tokenFields.flatMap((field) => {
    const value = item ? field.extract(item) : null
    return value === null ? [] : [[field.field, value]]
  }))
  return href ? { entityType: type, entityId, label, href, values } : null
}

export function resolveRelatedDocumentActions(capabilities: CollectionCapabilities, disabled: boolean) {
  return {
    canLink: !disabled && capabilities.canLinkDocuments,
    canCreate: !disabled && capabilities.canInstantiateTemplate,
  }
}
