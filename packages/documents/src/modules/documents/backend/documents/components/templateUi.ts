import { getEntityRegistryEntry, type DocumentEntityType } from '../../../lib/entityRegistry'
import {
  firstSafeDocumentsDisplayLabel,
  sanitizeDocumentsDisplayLabel,
} from '../../../lib/displayLabels'
import { readArrayPayload, readBoolean, readRecord, readString } from '../documentUi'

export type TemplateContextSlot = { slot: string; entityType: DocumentEntityType; required?: boolean }
export type TemplateRow = {
  id: string
  name: string
  description: string | null
  bodyHtml: string
  contextSlots: TemplateContextSlot[]
  isActive: boolean
  updatedAt: string
  createdAt: string
}

export type TemplateSlotSelection = {
  entityType: DocumentEntityType
  entityId: string
  label: string
  href: string
  values: Record<string, string | number | null>
}

export type TemplatePreviewResult = {
  contentHtml: string
  unresolvedTokens: string[]
  templateUpdatedAt: string
  previewDigest: string
}

function normalizeSlot(value: unknown): TemplateContextSlot | null {
  const record = readRecord(value)
  if (!record) return null
  const slot = readString(record, 'slot')
  const entityType = readString(record, 'entityType', 'entity_type')
  if (!slot || !entityType || !getEntityRegistryEntry(entityType)) return null
  return { slot, entityType: entityType as DocumentEntityType, required: readBoolean(record, 'required') ?? undefined }
}

export function normalizeTemplate(value: unknown): TemplateRow | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, 'id')
  const name = readString(record, 'name')
  const updatedAt = readString(record, 'updatedAt', 'updated_at')
  const createdAt = readString(record, 'createdAt', 'created_at')
  if (!id || !name || !updatedAt || !createdAt) return null
  const rawSlots = record.contextSlots ?? record.context_slots
  return {
    id,
    name,
    updatedAt,
    createdAt,
    description: readString(record, 'description'),
    bodyHtml: readString(record, 'bodyHtml', 'body_html') ?? '',
    contextSlots: Array.isArray(rawSlots)
      ? rawSlots.map(normalizeSlot).filter((slot): slot is TemplateContextSlot => slot !== null)
      : [],
    isActive: readBoolean(record, 'isActive', 'is_active') ?? true,
  }
}

export function normalizeTemplateDetail(value: unknown): TemplateRow | null {
  const record = readRecord(value)
  if (!record) return null
  const bodyHtml = record.bodyHtml ?? record.body_html
  if (typeof bodyHtml !== 'string') return null
  const template = normalizeTemplate(record)
  return template ? { ...template, bodyHtml } : null
}

export function normalizeTemplates(payload: unknown): TemplateRow[] {
  return readArrayPayload(payload, 'items', 'data', 'templates')
    .map(normalizeTemplate)
    .filter((template): template is TemplateRow => template !== null)
}

export function normalizeActiveTemplates(payload: unknown): TemplateRow[] {
  return normalizeTemplates(payload).filter((template) => template.isActive)
}

export function normalizePreview(payload: unknown): TemplatePreviewResult | null {
  const record = readRecord(payload)
  if (!record) return null
  const contentHtml = readString(record, 'contentHtml', 'content_html') ?? ''
  const templateUpdatedAt = readString(record, 'templateUpdatedAt', 'template_updated_at')
  const previewDigest = readString(record, 'previewDigest', 'preview_digest')
  if (!templateUpdatedAt || !previewDigest) return null
  return {
    contentHtml,
    templateUpdatedAt,
    previewDigest,
    unresolvedTokens: Array.isArray(record.unresolvedTokens)
      ? record.unresolvedTokens.filter((token): token is string => typeof token === 'string')
      : [],
  }
}

export function selectionForPreset(input: {
  entityType: DocumentEntityType
  entityId: string
  label: string
  fallbackLabel?: string
  values?: Record<string, string | number | null | undefined>
}): TemplateSlotSelection | null {
  const entry = getEntityRegistryEntry(input.entityType)
  if (!entry) return null
  const label = firstSafeDocumentsDisplayLabel(input.label, input.fallbackLabel)
  if (!label) return null
  const href = entry.resolveHref({ id: input.entityId, label })
  if (!href) return null
  const values = Object.fromEntries(entry.tokenFields.flatMap((field) => {
    const hydrated = input.values?.[field.field]
    const safeHydrated = typeof hydrated === 'string'
      ? sanitizeDocumentsDisplayLabel(hydrated)
      : typeof hydrated === 'number' && Number.isFinite(hydrated) ? hydrated : null
    if (safeHydrated !== null) {
      return [[field.field, safeHydrated] as const]
    }
    const isPrimary = field.field === 'name' || field.field === 'title' || field.field === 'number'
    return isPrimary ? [[field.field, label] as const] : []
  }))
  return { entityType: input.entityType, entityId: input.entityId, label, href, values }
}
