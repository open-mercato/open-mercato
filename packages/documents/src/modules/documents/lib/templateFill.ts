import {
  getEntityRegistryEntry,
  type DocumentEntityType,
  type EntityPickerItem,
} from './entityRegistry'

export type TemplateFillSlot = {
  slot: string
  entityType: DocumentEntityType
  rawItem?: Record<string, unknown> | null
  entityId?: string
  label?: string
  href?: string
  values?: Record<string, string | number | null>
}

export type FillTemplateTokensOptions = {
  locale?: string
  now?: Date
}

export type TemplateRenderResult = {
  html: string
  unresolvedTokens: string[]
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

function resolvePickerItem(slot: TemplateFillSlot): EntityPickerItem | null {
  const entry = getEntityRegistryEntry(slot.entityType)
  if (!entry) return null
  if (slot.rawItem) return entry.mapItem(slot.rawItem)
  if (!slot.entityId || !slot.label || !slot.href) return null
  return { id: slot.entityId, label: slot.label, href: slot.href }
}

function buildEntityChip(slot: TemplateFillSlot): string | null {
  const entry = getEntityRegistryEntry(slot.entityType)
  const item = resolvePickerItem(slot)
  if (!entry || !item) return null
  const href = entry.resolveHref(item)
  if (!href || !entry.isCanonicalHref(item, href)) return null

  const escapedType = escapeHtml(slot.entityType)
  const escapedId = escapeHtml(item.id)
  const escapedLabel = escapeHtml(item.label)
  const escapedHref = escapeHtml(href)

  return `<span data-entity-ref data-entity-type="${escapedType}" data-entity-id="${escapedId}" data-label="${escapedLabel}" data-href="${escapedHref}" class="om-entity-ref">${escapedLabel}</span>`
}

function resolveTokenValue(
  slot: TemplateFillSlot,
  field: string,
): { resolved: boolean; value: string } {
  if (slot.values && Object.prototype.hasOwnProperty.call(slot.values, field)) {
    const value = slot.values[field]
    return { resolved: true, value: value == null ? '' : String(value) }
  }

  const entry = getEntityRegistryEntry(slot.entityType)
  const tokenField = entry?.tokenFields.find((candidate) => candidate.field === field)
  if (!tokenField || !slot.rawItem) return { resolved: false, value: '' }
  const value = tokenField.extract(slot.rawItem)
  return value == null ? { resolved: false, value: '' } : { resolved: true, value }
}

function collectUnresolvedTokens(html: string): string[] {
  const tokens = new Set<string>()
  for (const match of html.matchAll(/{{\s*([^{}]+?)\s*}}/g)) {
    const token = match[1]?.trim()
    if (token) tokens.add(token)
  }
  const withoutValidTokens = html.replace(/{{\s*[^{}]+?\s*}}/g, '')
  if (withoutValidTokens.includes('{{') || withoutValidTokens.includes('}}')) {
    tokens.add('invalid-token-syntax')
  }
  return Array.from(tokens).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
}

export function renderTemplateTokens(
  bodyHtml: string,
  slots: TemplateFillSlot[],
  options: FillTemplateTokensOptions = {},
): TemplateRenderResult {
  const date = (options.now ?? new Date()).toLocaleDateString(options.locale, { timeZone: 'UTC' })
  let filled = replaceToken(bodyHtml, 'date', escapeHtml(date))

  for (const slot of slots) {
    const entry = getEntityRegistryEntry(slot.entityType)
    if (!entry) continue

    const chip = buildEntityChip(slot)
    if (chip != null) filled = replaceToken(filled, `${slot.slot}.chip`, chip)

    for (const tokenField of entry.tokenFields) {
      const resolved = resolveTokenValue(slot, tokenField.field)
      if (!resolved.resolved) continue
      filled = replaceToken(
        filled,
        `${slot.slot}.${tokenField.field}`,
        escapeHtml(resolved.value),
      )
    }
  }

  const unresolvedTokens = collectUnresolvedTokens(filled)
  const html = unresolvedTokens.includes('invalid-token-syntax')
    ? ''
    : filled
        .replace(/{{\s*[^{}]+?\s*}}/g, '')
        .replace(/ {2,}/g, ' ')

  return { html, unresolvedTokens }
}

export function fillTemplateTokens(
  bodyHtml: string,
  slots: TemplateFillSlot[],
  options: FillTemplateTokensOptions = {},
): string {
  return renderTemplateTokens(bodyHtml, slots, options).html
}
