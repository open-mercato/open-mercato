import { createHash } from 'node:crypto'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  documentEntityTypeSchema,
  documentTemplateFillSlotSchema,
  documentTitleSchema,
  type DocumentTemplateFillSlotInput,
} from '../data/validators'

export type TemplatePreviewDigestInput = {
  templateId: string
  templateUpdatedAt: string
  title: string
  locale: string
  effectiveDate: string
  slots: DocumentTemplateFillSlotInput[]
}

export type CanonicalTemplatePreviewValue = string | number | null

export type CanonicalTemplatePreviewSlot = {
  slot: string
  entityType: DocumentTemplateFillSlotInput['entityType']
  entityId: string
  label: string
  href: string
  values: Record<string, CanonicalTemplatePreviewValue>
}

export type CanonicalTemplatePreview = {
  schema: 'documents-template-preview-v1'
  templateId: string
  templateUpdatedAt: string
  title: string
  locale: string
  effectiveDate: string
  slots: CanonicalTemplatePreviewSlot[]
}

function normalizeDate(value: string, errorKey: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new CrudHttpError(400, { error: errorKey })
  return parsed.toISOString()
}

function normalizeValue(value: CanonicalTemplatePreviewValue): CanonicalTemplatePreviewValue {
  if (typeof value === 'string') return value.normalize('NFC')
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CrudHttpError(400, { error: 'documents.templates.invalidValue' })
    }
    return Object.is(value, -0) ? 0 : value
  }
  return null
}

function compareLexicographically(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalizeSlot(slot: DocumentTemplateFillSlotInput): CanonicalTemplatePreviewSlot {
  const parsed = documentTemplateFillSlotSchema.parse(slot)
  const values: Record<string, CanonicalTemplatePreviewValue> = {}
  const normalizedEntries = Object.entries(parsed.values).map(([key, value]) => [
    key.normalize('NFC'),
    normalizeValue(value),
  ] as const).sort(([left], [right]) => compareLexicographically(left, right))
  for (const [index, [key, value]] of normalizedEntries.entries()) {
    if (index > 0 && normalizedEntries[index - 1]![0] === key) {
      throw new CrudHttpError(400, { error: 'documents.templates.duplicateValueField' })
    }
    values[key] = value
  }
  return {
    slot: parsed.slot.normalize('NFC'),
    entityType: documentEntityTypeSchema.parse(parsed.entityType),
    entityId: parsed.entityId,
    label: parsed.label.normalize('NFC'),
    href: parsed.href.normalize('NFC'),
    values,
  }
}

export function canonicalizeTemplatePreviewInput(
  input: TemplatePreviewDigestInput,
): CanonicalTemplatePreview {
  let locale: string
  try {
    locale = new Intl.Locale(input.locale).toString()
  } catch {
    throw new CrudHttpError(400, { error: 'documents.templates.invalidLocale' })
  }

  const slots = input.slots.map(canonicalizeSlot).sort((left, right) => (
    compareLexicographically(left.slot, right.slot)
    || compareLexicographically(left.entityType, right.entityType)
    || compareLexicographically(left.entityId, right.entityId)
  ))
  const slotNames = new Set<string>()
  for (const slot of slots) {
    if (slotNames.has(slot.slot)) {
      throw new CrudHttpError(400, { error: 'documents.templates.duplicateSlot' })
    }
    slotNames.add(slot.slot)
  }

  return {
    schema: 'documents-template-preview-v1',
    templateId: input.templateId,
    templateUpdatedAt: normalizeDate(input.templateUpdatedAt, 'documents.templates.invalidRevision'),
    title: documentTitleSchema.parse(input.title).normalize('NFC'),
    locale,
    effectiveDate: normalizeDate(input.effectiveDate, 'documents.templates.invalidEffectiveDate'),
    slots,
  }
}

export function computeTemplatePreviewDigest(input: TemplatePreviewDigestInput): string {
  const canonical = canonicalizeTemplatePreviewInput(input)
  const digest = createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
  return `sha256:${digest}`
}
