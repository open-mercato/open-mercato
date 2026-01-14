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
  const text = Array.isArray(value)
    ? value.map((item) => (item === null || item === undefined ? '' : String(item))).filter(Boolean).join(', ')
    : (typeof value === 'object' ? JSON.stringify(value) : String(value))
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

function buildContractorUrl(id: string | null): string | null {
  if (!id) return null
  return `/backend/contractors?id=${encodeURIComponent(id)}`
}

function buildContractorPresenter(
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const name = pickString(
    record.name,
    record.short_name,
    record.shortName,
    customFields.name,
  )
  const title = name ?? (record.id as string | undefined) ?? 'Contractor'

  const shortName = pickString(record.short_name, record.shortName)
  const isActive = record.is_active ?? record.isActive
  const status = typeof isActive === 'boolean'
    ? (isActive ? 'Active' : 'Inactive')
    : undefined

  return {
    title: String(title),
    subtitle: formatSubtitle(shortName !== name ? shortName : null, status),
    icon: 'building-2',
    badge: 'Contractor',
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'contractors:contractor',
      enabled: true,
      priority: 9,

      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const record = ctx.record
        const lines: string[] = []

        appendLine(lines, 'Name', record.name ?? ctx.customFields.name)
        appendLine(lines, 'Short name', record.short_name ?? record.shortName)
        appendLine(lines, 'Tax ID', record.tax_id ?? record.taxId)
        appendLine(lines, 'Status', (record.is_active ?? record.isActive) ? 'Active' : 'Inactive')

        if (!lines.length) return null

        const presenter = buildContractorPresenter(record, ctx.customFields)

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
        return buildContractorPresenter(ctx.record, ctx.customFields)
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const id = ctx.record.id as string | undefined
        return buildContractorUrl(id ?? null)
      },

      fieldPolicy: {
        searchable: ['name', 'short_name'],
        hashOnly: ['tax_id'],
        excluded: ['parent_id', 'role_type_ids'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
