import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { AttachmentAssignment } from './metadata'
import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

type AssignmentLinkSpec = {
  labelFields?: string[]
  extraFields?: string[]
  buildHref?: (record: Record<string, unknown>) => string | null | undefined
}

const ENTITY_LINK_SPECS: Record<string, AssignmentLinkSpec> = {
  [E.catalog.catalog_product]: {
    labelFields: ['title', 'sku', 'handle'],
    buildHref: (record) => buildSimpleHref('/backend/catalog/products', record.id),
  },
  [E.catalog.catalog_product_variant]: {
    labelFields: ['name', 'sku'],
    extraFields: ['product_id'],
    buildHref: (record) => {
      const productId = readRecordValue(record, 'product_id')
      if (!productId) return null
      return `/backend/catalog/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(String(record.id ?? ''))}`
    },
  },
  [E.customers.customer_entity]: {
    labelFields: ['display_name'],
    extraFields: ['kind'],
    buildHref: (record) => {
      const kind = String(readRecordValue(record, 'kind') || '').toLowerCase()
      if (kind === 'company') return buildSimpleHref('/backend/customers/companies', record.id)
      if (kind === 'person') return buildSimpleHref('/backend/customers/people', record.id)
      return null
    },
  },
  [E.customers.customer_person_profile]: {
    labelFields: ['preferred_name', 'display_name', 'first_name', 'last_name'],
    extraFields: ['entity_id', 'first_name', 'last_name'],
    buildHref: (record) => {
      const entityId = readRecordValue(record, 'entity_id')
      return entityId ? buildSimpleHref('/backend/customers/people', entityId) : null
    },
  },
  [E.customers.customer_company_profile]: {
    labelFields: ['brand_name', 'display_name', 'legal_name'],
    extraFields: ['entity_id'],
    buildHref: (record) => {
      const entityId = readRecordValue(record, 'entity_id')
      return entityId ? buildSimpleHref('/backend/customers/companies', entityId) : null
    },
  },
  [E.customers.customer_deal]: {
    labelFields: ['title'],
    buildHref: (record) => buildSimpleHref('/backend/customers/deals', record.id),
  },
  [E.sales.sales_channel]: {
    labelFields: ['name', 'title'],
    buildHref: (record) => buildSimpleHref('/backend/sales/channels', record.id, '/edit'),
  },
}

const LIBRARY_ENTITY_ID = 'attachments:library'
const DEFAULT_LABEL_FIELDS = [
  'label',
  'title',
  'name',
  'display_name',
  'displayName',
  'subject',
  'sku',
  'handle',
  'order_number',
  'quote_number',
  'invoice_number',
  'email',
  'company_name',
  'legal_name',
  'brand_name',
]

let entitySpecsPromise: Promise<Map<string, CustomEntitySpec>> | null = null

async function loadEntitySpecs(): Promise<Map<string, CustomEntitySpec>> {
  if (!entitySpecsPromise) {
    entitySpecsPromise = import('@/generated/modules.generated')
      .then((registry) => {
        const map = new Map<string, CustomEntitySpec>()
        const mods = registry.modules ?? []
        for (const mod of mods) {
          const specs = ((mod as any).customEntities as CustomEntitySpec[] | undefined) ?? []
          for (const spec of specs) {
            if (spec?.id && !map.has(spec.id)) {
              map.set(spec.id, spec)
            }
          }
        }
        return map
      })
      .catch(() => new Map<string, CustomEntitySpec>())
  }
  return entitySpecsPromise
}

export type AssignmentEnrichment = {
  label?: string
  href?: string
}

export type AssignmentEnrichmentMap = Map<string, AssignmentEnrichment>

function camelToSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

function snakeToCamel(value: string): string {
  return value.replace(/[_-](\w)/g, (_, c: string) => c.toUpperCase())
}

function normalizeValue(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return null
}

function readRecordValue(record: Record<string, unknown>, field: string): string | null {
  if (!field) return null
  if (record[field] !== undefined) return normalizeValue(record[field])
  const snake = camelToSnake(field)
  if (snake !== field && record[snake] !== undefined) return normalizeValue(record[snake])
  const camel = snakeToCamel(field)
  if (camel !== field && record[camel] !== undefined) return normalizeValue(record[camel])
  return null
}

function buildSimpleHref(base: string, idValue: unknown, suffix: string = ''): string | null {
  const id = normalizeValue(idValue)
  if (!id) return null
  return `${base}/${encodeURIComponent(id)}${suffix}`
}

function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
}

function filterIdsForEntity(entityId: string, ids: string[]): string[] {
  if (entityId === E.catalog.catalog_product_variant || entityId === E.catalog.catalog_product) {
    return ids.filter((id) => isUuid(id))
  }
  return ids
}

function resolveLabelCandidates(entityId: string, linkSpec: AssignmentLinkSpec | undefined, entitySpecs: Map<string, CustomEntitySpec>): string[] {
  const candidates = new Set<string>()
  const spec = entitySpecs.get(entityId)
  if (spec?.labelField) {
    candidates.add(spec.labelField)
    candidates.add(camelToSnake(spec.labelField))
  }
  for (const field of linkSpec?.labelFields ?? []) {
    candidates.add(field)
    candidates.add(camelToSnake(field))
  }
  DEFAULT_LABEL_FIELDS.forEach((field) => {
    candidates.add(field)
    candidates.add(camelToSnake(field))
  })
  return Array.from(candidates).filter((field) => field.length > 0)
}

function buildLabel(
  record: Record<string, unknown>,
  entityId: string,
  linkSpec: AssignmentLinkSpec | undefined,
  entitySpecs: Map<string, CustomEntitySpec>
): string | null {
  const candidates = resolveLabelCandidates(entityId, linkSpec, entitySpecs)
  for (const candidate of candidates) {
    const value = readRecordValue(record, candidate)
    if (value) return value
  }
  const fullName = [readRecordValue(record, 'first_name'), readRecordValue(record, 'last_name')]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .trim()
  if (fullName.length) return fullName
  return null
}

export async function resolveAssignmentEnrichments(
  assignments: AttachmentAssignment[],
  opts: { queryEngine?: QueryEngine | null; tenantId: string; organizationId: string },
): Promise<AssignmentEnrichmentMap> {
  const map: AssignmentEnrichmentMap = new Map()
  if (!assignments.length || !opts.queryEngine) return map
  const entitySpecs = await loadEntitySpecs()
  const grouped = new Map<string, Set<string>>()
  for (const assignment of assignments) {
    if (!assignment || assignment.type === LIBRARY_ENTITY_ID) continue
    const type = assignment.type?.trim()
    const id = assignment.id?.trim()
    if (!type || !id) continue
    if (!grouped.has(type)) grouped.set(type, new Set())
    grouped.get(type)!.add(id)
  }
  if (!grouped.size) return map

  for (const [entityId, idsSet] of grouped.entries()) {
    const ids = filterIdsForEntity(entityId, Array.from(idsSet.values()))
    if (!ids.length) continue
    const linkSpec = ENTITY_LINK_SPECS[entityId]
    const fields = new Set<string>(['id'])
    const candidates = resolveLabelCandidates(entityId, linkSpec, entitySpecs)
    candidates.forEach((field) => fields.add(field))
    for (const extra of linkSpec?.extraFields ?? []) {
      fields.add(extra)
      fields.add(camelToSnake(extra))
    }
    try {
      const result = await opts.queryEngine.query(entityId as any, {
        fields: Array.from(fields),
        filters: { id: ids.length === 1 ? { $eq: ids[0] } : { $in: ids } },
        tenantId: opts.tenantId,
        organizationId: opts.organizationId,
        pageSize: Math.max(ids.length, 20),
      })
      for (const record of result.items ?? []) {
        const recordId = normalizeValue((record as Record<string, unknown>).id)
        if (!recordId) continue
        const label = buildLabel(record as Record<string, unknown>, entityId, linkSpec, entitySpecs)
        const href = linkSpec?.buildHref?.(record as Record<string, unknown>) ?? null
        if (label || href) {
          map.set(`${entityId}:${recordId}`, {
            label: label ?? undefined,
            href: href ?? undefined,
          })
        }
      }
    } catch (error) {
      console.warn('[attachments] Failed to resolve assignment details for', entityId, error)
    }
  }
  return map
}

export function applyAssignmentEnrichments(
  assignments: AttachmentAssignment[],
  enrichments: AssignmentEnrichmentMap,
): AttachmentAssignment[] {
  if (!enrichments.size) return assignments
  return assignments.map((assignment) => {
    if (!assignment || !assignment.type || !assignment.id) return assignment
    const key = `${assignment.type}:${assignment.id}`
    const detail = enrichments.get(key)
    if (!detail) return assignment
    const next: AttachmentAssignment = { ...assignment }
    if (!next.label && detail.label) next.label = detail.label
    if (!next.href && detail.href) next.href = detail.href
    return next
  })
}
