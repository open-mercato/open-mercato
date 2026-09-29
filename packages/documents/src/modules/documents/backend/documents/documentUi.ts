import type { DocumentCapabilities } from '../../lib/capabilities'

export type { DocumentCapabilities } from '../../lib/capabilities'

export type DocumentTier = 'owner' | 'editor' | 'commenter' | 'viewer'

export type DocumentDetail = {
  id: string
  title: string
  tier: DocumentTier
  updatedAt: string | null
  archivedAt: string | null
  isFavorite: boolean
  isWatching: boolean
  capabilities: DocumentCapabilities
}

export type DocumentContent = {
  contentHtml: string
  updatedAt: string | null
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

export function readBoolean(record: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'boolean') return value
  }
  return null
}

export function readNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

export function readArrayPayload(payload: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload
  const record = readRecord(payload)
  if (!record) return []
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) return value
  }
  return []
}

export function unwrapRecord(payload: unknown, ...keys: string[]): Record<string, unknown> | null {
  const root = readRecord(payload)
  if (!root) return null
  for (const key of keys) {
    const nested = readRecord(root[key])
    if (nested) return nested
  }
  return root
}

function readTier(value: string | null): DocumentTier {
  if (value === 'owner' || value === 'editor' || value === 'commenter') return value
  return 'viewer'
}

function readCapabilities(record: Record<string, unknown>, tier: DocumentTier): DocumentCapabilities {
  const capabilities = readRecord(record.capabilities)
  const legacyCanShare = readBoolean(record, 'canShare', 'can_share') ?? tier === 'owner'
  const legacyCanEdit = tier === 'owner' || tier === 'editor'
  const legacyCanComment = tier !== 'viewer'
  return {
    canView: capabilities ? readBoolean(capabilities, 'canView', 'can_view') ?? true : true,
    canComment: capabilities ? readBoolean(capabilities, 'canComment', 'can_comment') ?? legacyCanComment : legacyCanComment,
    canEdit: capabilities ? readBoolean(capabilities, 'canEdit', 'can_edit') ?? legacyCanEdit : legacyCanEdit,
    canShare: capabilities ? readBoolean(capabilities, 'canShare', 'can_share') ?? legacyCanShare : legacyCanShare,
    canDelete: capabilities ? readBoolean(capabilities, 'canDelete', 'can_delete') ?? false : false,
    canCreate: capabilities ? readBoolean(capabilities, 'canCreate', 'can_create') ?? false : false,
    canManageTemplates: capabilities
      ? readBoolean(capabilities, 'canManageTemplates', 'can_manage_templates') ?? false
      : false,
    canArchive: capabilities
      ? readBoolean(capabilities, 'canArchive', 'can_archive') ?? false
      : false,
    canDuplicate: capabilities
      ? readBoolean(capabilities, 'canDuplicate', 'can_duplicate') ?? false
      : false,
  }
}

export function normalizeDocumentDetail(payload: unknown): DocumentDetail | null {
  const record = unwrapRecord(payload, 'document', 'item', 'data')
  if (!record) return null
  const id = readString(record, 'id')
  const title = readString(record, 'title')
  if (!id || !title) return null
  const tier = readTier(readString(record, 'tier', 'permission', 'effectiveTier', 'effective_tier'))
  return {
    id,
    title,
    tier,
    updatedAt: readString(record, 'updatedAt', 'updated_at'),
    archivedAt: readString(record, 'archivedAt', 'archived_at'),
    isFavorite: readBoolean(record, 'isFavorite', 'is_favorite') ?? false,
    isWatching: readBoolean(record, 'isWatching', 'is_watching') ?? false,
    capabilities: readCapabilities(record, tier),
  }
}

export function normalizeDocumentContent(payload: unknown): DocumentContent {
  const record = unwrapRecord(payload, 'content', 'item', 'data')
  return {
    contentHtml: record ? readString(record, 'contentHtml', 'content_html') ?? '' : '',
    updatedAt: record ? readString(record, 'updatedAt', 'updated_at') : null,
  }
}

export function formatDateTime(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString()
}
