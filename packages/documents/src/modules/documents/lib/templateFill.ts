import {
  getEntityRegistryEntry,
  type DocumentEntityType,
} from './entityRegistry'

export type TemplateFillSlot = {
  slot: string
  entityType: DocumentEntityType
  rawItem: Record<string, unknown> | null
}

export type FillTemplateTokensOptions = {
  locale?: string
  now?: Date
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceToken(source: string, token: string, replacement: string): string {
  return source.replace(new RegExp(`{{\\s*${escapeRegExp(token)}\\s*}}`, 'g'), () => replacement)
}

function buildEntityChip(slot: TemplateFillSlot): string {
  const entry = getEntityRegistryEntry(slot.entityType)
  if (!entry || !slot.rawItem) return ''
  const item = entry.mapItem(slot.rawItem)
  if (!item) return ''

  const escapedType = escapeHtml(slot.entityType)
  const escapedId = escapeHtml(item.id)
  const escapedLabel = escapeHtml(item.label)
  const escapedHref = escapeHtml(entry.href(item.id))

  return `<span data-entity-ref data-entity-type="${escapedType}" data-entity-id="${escapedId}" data-label="${escapedLabel}" data-href="${escapedHref}" class="om-entity-ref">${escapedLabel}</span>`
}

export function fillTemplateTokens(
  bodyHtml: string,
  slots: TemplateFillSlot[],
  options: FillTemplateTokensOptions = {},
): string {
  const date = (options.now ?? new Date()).toLocaleDateString(options.locale)
  let filled = replaceToken(bodyHtml, 'date', escapeHtml(date))

  for (const slot of slots) {
    const entry = getEntityRegistryEntry(slot.entityType)
    filled = replaceToken(filled, `${slot.slot}.chip`, buildEntityChip(slot))
    if (!entry || !slot.rawItem) continue

    for (const tokenField of entry.tokenFields) {
      const value = tokenField.extract(slot.rawItem)
      filled = replaceToken(
        filled,
        `${slot.slot}.${tokenField.field}`,
        value ? escapeHtml(value) : '',
      )
    }
  }

  return filled
    .replace(/{{\s*[^}]+\s*}}/g, '')
    .replace(/ {2,}/g, ' ')
}
