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

function buildLocationUrl(id: string | null): string | null {
  if (!id) return null
  return `/backend/fms-locations?id=${encodeURIComponent(id)}`
}

function formatLocationType(type: unknown): string {
  if (type === 'port') return 'Port'
  if (type === 'terminal') return 'Terminal'
  return String(type ?? 'Location')
}

function buildLocationPresenter(
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const locode = pickString(record.locode)
  const name = pickString(record.name, customFields.name)
  const city = pickString(record.city)
  const country = pickString(record.country)
  const locationType = formatLocationType(record.type)

  // Title: "LOCODE - Name" when locode exists (e.g., "PLGDN - Port of Gdansk")
  // Otherwise just "Name" (terminals without locode)
  const titleParts = [locode, name].filter(Boolean)
  const title = titleParts.length > 0 ? titleParts.join(' - ') : (record.id as string | undefined) ?? 'Location'

  // Subtitle: "City, Country" (e.g., "Gdansk, Poland")
  const subtitle = [city, country].filter(Boolean).join(', ') || undefined

  return {
    title: String(title),
    subtitle,
    icon: 'map-pin',
    badge: locationType,
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'fms_locations:fms_location',
      enabled: true,
      priority: 8,
      strategies: ['fulltext', 'tokens'],

      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const record = ctx.record
        const lines: string[] = []

        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'LOCODE', record.locode)
        appendLine(lines, 'City', record.city)
        appendLine(lines, 'Country', record.country)
        appendLine(lines, 'Type', formatLocationType(record.type))

        if (!lines.length) return null

        const presenter = buildLocationPresenter(record, ctx.customFields)

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
        return buildLocationPresenter(ctx.record, ctx.customFields)
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const id = ctx.record.id as string | undefined
        return buildLocationUrl(id ?? null)
      },

      fieldPolicy: {
        searchable: ['code', 'name', 'locode', 'city', 'country', 'type'],
        hashOnly: [],
        excluded: ['lat', 'lng', 'port_id'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
