import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchResultPresenter,
  SearchIndexSource,
} from '@open-mercato/shared/modules/search'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

function pickString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function snippet(value: unknown, max = 140): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.length) return undefined
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 3)}...`
}

function appendLine(lines: string[], label: string, value: unknown) {
  if (value === null || value === undefined) return
  const text = Array.isArray(value)
    ? value.map((item) => (item === null || item === undefined ? '' : String(item))).filter(Boolean).join(', ')
    : (typeof value === 'object' ? JSON.stringify(value) : String(value))
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

function appendCustomFieldLines(lines: string[], customFields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(customFields)) {
    if (value === null || value === undefined) continue
    appendLine(lines, key.replace(/^cf:/, ''), value)
  }
}

function formatSubtitle(...parts: Array<unknown>): string | undefined {
  const text = parts
    .map((part) => (part === null || part === undefined ? '' : String(part)))
    .map((part) => part.trim())
    .filter(Boolean)
  if (text.length === 0) return undefined
  return text.join(' · ')
}

function buildResourcePresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const title =
    pickString(record.name, record.display_name, record.displayName, customFields.name, customFields.display_name) ??
    (record.id as string | undefined) ??
    t('resources.search.badge.resource', 'Resource')
  const description = snippet(record.description ?? customFields.description)
  const capacity = record.capacity ?? record.capacity_value ?? record.capacityValue
  const capacityUnit = pickString(record.capacity_unit_name, record.capacityUnitName, record.capacity_unit_value, record.capacityUnitValue)
  const capacityLabel = capacity != null ? `${capacity}${capacityUnit ? ` ${capacityUnit}` : ''}` : null
  return {
    title: String(title),
    subtitle: formatSubtitle(description, capacityLabel),
    icon: 'box',
    badge: t('resources.search.badge.resource', 'Resource'),
  }
}

function buildResourceTypePresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const title =
    pickString(record.name, record.display_name, record.displayName, customFields.name, customFields.display_name) ??
    (record.id as string | undefined) ??
    t('resources.search.badge.resourceType', 'Resource type')
  const description = snippet(record.description ?? customFields.description)
  return {
    title: String(title),
    subtitle: formatSubtitle(description),
    icon: 'shapes',
    badge: t('resources.search.badge.resourceType', 'Resource type'),
  }
}

function buildIndexSource(
  ctx: SearchBuildContext,
  presenter: SearchResultPresenter,
  lines: string[],
): SearchIndexSource | null {
  appendCustomFieldLines(lines, ctx.customFields)
  if (!lines.length) return null
  return {
    text: lines,
    presenter,
    checksumSource: { record: ctx.record, customFields: ctx.customFields },
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'resources:resources_resource',
      enabled: true,
      priority: 8,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name ?? record.display_name ?? ctx.customFields.name)
        appendLine(lines, 'Description', record.description ?? ctx.customFields.description)
        appendLine(lines, 'Capacity', record.capacity ?? record.capacity_value ?? record.capacityValue)
        appendLine(lines, 'Capacity unit', record.capacity_unit_name ?? record.capacityUnitName ?? record.capacity_unit_value)
        appendLine(lines, 'Resource type', record.resource_type_id ?? record.resourceTypeId)
        appendLine(lines, 'Tags', record.tags)
        return buildIndexSource(ctx, buildResourcePresenter(t, record, ctx.customFields), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildResourcePresenter(t, ctx.record, ctx.customFields)
      },
      resolveUrl: async (ctx) => `/backend/resources/resources/${encodeURIComponent(String(ctx.record.id))}`,
      fieldPolicy: {
        searchable: ['name', 'description', 'capacity', 'capacity_unit_name', 'capacity_unit_value', 'tags'],
      },
    },
    {
      entityId: 'resources:resources_resource_type',
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name ?? record.display_name ?? ctx.customFields.name)
        appendLine(lines, 'Description', record.description ?? ctx.customFields.description)
        appendLine(lines, 'Icon', record.appearance_icon ?? record.appearanceIcon)
        appendLine(lines, 'Color', record.appearance_color ?? record.appearanceColor)
        return buildIndexSource(ctx, buildResourceTypePresenter(t, record, ctx.customFields), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildResourceTypePresenter(t, ctx.record, ctx.customFields)
      },
      resolveUrl: async (ctx) => `/backend/resources/resource-types/${encodeURIComponent(String(ctx.record.id))}/edit`,
      fieldPolicy: {
        searchable: ['name', 'description', 'appearance_icon', 'appearance_color'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
