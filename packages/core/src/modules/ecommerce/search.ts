import type { SearchBuildContext, SearchIndexSource, SearchModuleConfig, SearchResultPresenter } from '@open-mercato/shared/modules/search'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const ECOMMERCE_STORES_URL = '/backend/config/ecommerce'

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function pickText(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    const text = normalizeText(candidate)
    if (text) return text
  }
  return null
}

function readRecordText(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const text = normalizeText(record[key])
    if (text) return text
  }
  return null
}

function formatSubtitle(...parts: Array<unknown>): string | undefined {
  const text = parts
    .map((part) => normalizeText(part))
    .filter((value): value is string => Boolean(value))
  if (!text.length) return undefined
  return text.join(' · ')
}

function buildIndexSource(
  ctx: SearchBuildContext,
  presenter: SearchResultPresenter,
  lines: string[],
): SearchIndexSource | null {
  if (!lines.length) return null
  return {
    text: lines,
    presenter,
    checksumSource: { record: ctx.record, customFields: ctx.customFields },
  }
}

function appendLine(lines: string[], label: string, value: unknown) {
  if (value === null || value === undefined) return
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

function buildStoreUrl(storeId: string | null): string | null {
  if (!storeId) return null
  return `${ECOMMERCE_STORES_URL}/${encodeURIComponent(storeId)}`
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'ecommerce:ecommerce_store',
      enabled: true,
      priority: 6,
      buildSource: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Slug', record.slug)
        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'Status', record.status)
        const label = translate('ecommerce.search.badge.store', 'Store')
        const title = pickText(
          readRecordText(record, 'name'),
          readRecordText(record, 'slug'),
          readRecordText(record, 'code'),
          readRecordText(record, 'id'),
        ) ?? label
        const isActive = record.status === 'active'
        const statusText = !isActive ? translate('ecommerce.search.status.inactive', 'Inactive') : null
        const subtitle = formatSubtitle(
          readRecordText(record, 'slug'),
          readRecordText(record, 'code'),
          statusText,
        )
        const presenter: SearchResultPresenter = { title, subtitle, icon: 'store', badge: label }
        return buildIndexSource(ctx, presenter, lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const label = translate('ecommerce.search.badge.store', 'Store')
        const title = pickText(
          readRecordText(record, 'name'),
          readRecordText(record, 'slug'),
          readRecordText(record, 'id'),
        ) ?? label
        const isActive = record.status === 'active'
        const statusText = !isActive ? translate('ecommerce.search.status.inactive', 'Inactive') : null
        const subtitle = formatSubtitle(readRecordText(record, 'slug'), statusText)
        return { title, subtitle, icon: 'store', badge: label }
      },
      resolveUrl: async (ctx) => buildStoreUrl(readRecordText(ctx.record, 'id')),
      fieldPolicy: {
        searchable: ['name', 'slug', 'code', 'status'],
        excluded: ['settings', 'metadata', 'supported_locales', 'supportedLocales'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
