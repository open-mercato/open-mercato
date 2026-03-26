import type { SearchResultPresenter } from '@open-mercato/shared/modules/search'

const TITLE_FIELDS_PRIMARY = [
  'display_name', 'displayName',
  'name', 'title', 'label',
  'full_name', 'fullName',
  'brand_name', 'brandName',
  'legal_name', 'legalName',
  'preferred_name', 'preferredName',
]

const TITLE_FIELDS_SECONDARY = [
  'email', 'primary_email', 'primaryEmail',
  'code', 'sku', 'reference',
  'identifier', 'slug',
]

const FIRST_NAME_FIELDS = ['first_name', 'firstName']
const LAST_NAME_FIELDS = ['last_name', 'lastName']
const MAX_SUBTITLE_LENGTH = 120

// Fields to check for subtitle
const SUBTITLE_FIELDS = [
  'description', 'summary', 'notes',
  'email', 'primary_email', 'primaryEmail',
  'phone', 'primary_phone', 'primaryPhone',
  'status', 'type', 'kind', 'category',
]

function findFirstValue(doc: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const value = doc[field]
    if (value != null && String(value).trim().length > 0) {
      return String(value).trim()
    }
  }
  return null
}

function buildNameFromParts(doc: Record<string, unknown>): string | null {
  const firstName = findFirstValue(doc, FIRST_NAME_FIELDS)
  const lastName = findFirstValue(doc, LAST_NAME_FIELDS)
  if (firstName && lastName) return `${firstName} ${lastName}`
  return firstName ?? lastName
}

function findAnyStringValue(doc: Record<string, unknown>, excludeFields: Set<string>): string | null {
  // Skip these fields as they're not meaningful for display
  const skipFields = new Set([
    'id', 'tenant_id', 'tenantId', 'organization_id', 'organizationId',
    'created_at', 'createdAt', 'updated_at', 'updatedAt', 'deleted_at', 'deletedAt',
    ...excludeFields,
  ])

  for (const [key, value] of Object.entries(doc)) {
    if (skipFields.has(key)) continue
    if (key.startsWith('cf:') || key.startsWith('cf_')) continue
    if (typeof value === 'string' && value.trim().length > 0 && value.length < 200) {
      return value.trim()
    }
  }
  return null
}

function formatEntityLabel(entityId: string): string {
  const entityName = entityId.split(':')[1] ?? entityId
  return entityName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function truncateSubtitle(value: string): string {
  if (value.length <= MAX_SUBTITLE_LENGTH) return value
  return value.slice(0, MAX_SUBTITLE_LENGTH).trimEnd()
}

/**
 * Extract a presenter from doc fields when no search.ts config exists.
 *
 * TODO: This is a basic implementation. Future improvements could include:
 * - Entity-type specific field mappings
 * - Smarter field combination (e.g., first_name + last_name)
 * - Custom field (cf:*) inspection for user-defined display fields
 * - Configuration for default presenter fields per entity type
 */
export function extractFallbackPresenter(
  doc: Record<string, unknown>,
  entityId: string,
  recordId: string,
): SearchResultPresenter {
  const entityLabel = formatEntityLabel(entityId)

  let title = findFirstValue(doc, TITLE_FIELDS_PRIMARY)

  if (!title) {
    title = buildNameFromParts(doc)
  }

  if (!title) {
    title = findFirstValue(doc, TITLE_FIELDS_SECONDARY)
  }

  if (!title) {
    title = findAnyStringValue(
      doc,
      new Set([...SUBTITLE_FIELDS, ...FIRST_NAME_FIELDS, ...LAST_NAME_FIELDS]),
    )
  }

  if (!title) {
    const shortId = recordId.length > 8 ? recordId.slice(0, 8) + '...' : recordId
    title = `${entityLabel} ${shortId}`
  }

  const subtitleParts: string[] = []
  for (const field of SUBTITLE_FIELDS) {
    const value = doc[field]
    if (value != null && String(value).trim().length > 0 && String(value) !== title) {
      subtitleParts.push(String(value).trim())
      if (subtitleParts.length >= 3) break // Limit to 3 parts
    }
  }

  return {
    title,
    subtitle: subtitleParts.length > 0 ? truncateSubtitle(subtitleParts.join(' · ')) : undefined,
    badge: entityLabel,
  }
}
