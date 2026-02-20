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

function appendLine(lines: string[], label: string, value: unknown) {
  if (value === null || value === undefined) return
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
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

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'wms:warehouse',
      enabled: true,
      priority: 8,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'Timezone', record.timezone)
        const title = pickString(record.name, record.code, record.id) ?? t('wms.search.badge.warehouse', 'Warehouse')
        return buildIndexSource(
          ctx,
          {
            title: String(title),
            subtitle: pickString(record.code, record.timezone) ?? undefined,
            icon: 'warehouse',
            badge: t('wms.search.badge.warehouse', 'Warehouse'),
          },
          lines
        )
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const title = pickString(record.name, record.code, record.id) ?? t('wms.search.badge.warehouse', 'Warehouse')
        return {
          title: String(title),
          subtitle: pickString(record.code, record.timezone) ?? undefined,
          icon: 'warehouse',
          badge: t('wms.search.badge.warehouse', 'Warehouse'),
        }
      },
      resolveUrl: async (ctx) => `/backend/wms/warehouses`,
      fieldPolicy: { searchable: ['name', 'code', 'timezone'] },
    },
    {
      entityId: 'wms:warehouse_location',
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'Type', record.type)
        appendLine(lines, 'Warehouse', record.warehouseId)
        const title = pickString(record.code, record.id) ?? t('wms.search.badge.location', 'Location')
        return buildIndexSource(
          ctx,
          {
            title: String(title),
            subtitle: pickString(record.type, record.warehouseId) ?? undefined,
            icon: 'mapPin',
            badge: t('wms.search.badge.location', 'Location'),
          },
          lines
        )
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const title = pickString(record.code, record.id) ?? t('wms.search.badge.location', 'Location')
        return {
          title: String(title),
          subtitle: pickString(record.type) ?? undefined,
          icon: 'mapPin',
          badge: t('wms.search.badge.location', 'Location'),
        }
      },
      resolveUrl: async (ctx) => `/backend/wms/locations`,
      fieldPolicy: { searchable: ['code', 'type'] },
    },
  ],
}

export default searchConfig
export const config = searchConfig
