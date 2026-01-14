import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchResultPresenter,
  SearchIndexSource,
} from '@open-mercato/shared/modules/search'

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

function formatSubtitle(...parts: Array<unknown>): string | undefined {
  const text = parts
    .map((part) => (part === null || part === undefined ? '' : String(part)))
    .map((part) => part.trim())
    .filter(Boolean)
  if (text.length === 0) return undefined
  return text.join(' · ')
}

function buildChargeCodeUrl(id: string | null): string | null {
  if (!id) return null
  return `/backend/charge-codes?id=${encodeURIComponent(id)}`
}

function formatChargeUnit(unit: unknown): string | null {
  const unitMap: Record<string, string> = {
    per_container: 'Per Container',
    per_shipment: 'Per Shipment',
    per_kg: 'Per KG',
    per_cbm: 'Per CBM',
    per_bl: 'Per B/L',
    per_day: 'Per Day',
  }
  if (typeof unit === 'string' && unit in unitMap) {
    return unitMap[unit]
  }
  if (typeof unit === 'string' && unit.trim()) {
    return unit.trim()
  }
  return null
}

function buildChargeCodePresenter(
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const code = pickString(record.code, customFields.code)
  const description = pickString(record.description, customFields.description)
  const title = code ?? (record.id as string | undefined) ?? 'Charge Code'

  const chargeUnit = formatChargeUnit(record.charge_unit ?? record.chargeUnit)
  const isActive = record.is_active ?? record.isActive
  const status = typeof isActive === 'boolean'
    ? (isActive ? 'Active' : 'Inactive')
    : undefined

  return {
    title: String(title),
    subtitle: formatSubtitle(description, chargeUnit, status),
    icon: 'tag',
    badge: 'Charge Code',
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'fms_products:fms_charge_code',
      enabled: true,
      priority: 7,

      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const record = ctx.record
        const lines: string[] = []

        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'Description', record.description)
        appendLine(lines, 'Charge Unit', formatChargeUnit(record.charge_unit ?? record.chargeUnit))
        appendLine(lines, 'Status', (record.is_active ?? record.isActive) ? 'Active' : 'Inactive')

        if (!lines.length) return null

        const presenter = buildChargeCodePresenter(record, ctx.customFields)

        return {
          text: lines,
          presenter,
          checksumSource: {
            record: ctx.record,
            customFields: ctx.customFields,
          },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        return buildChargeCodePresenter(ctx.record, ctx.customFields)
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const id = ctx.record.id as string | undefined
        return buildChargeCodeUrl(id ?? null)
      },

      fieldPolicy: {
        searchable: ['code', 'description', 'charge_unit'],
        hashOnly: [],
        excluded: ['field_schema'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
