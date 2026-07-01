import type {
  SearchBuildContext,
  SearchIndexSource,
  SearchModuleConfig,
  SearchResultLink,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function appendLine(lines: string[], label: string, value: unknown) {
  const text = stringValue(value)
  if (!text) return
  lines.push(`${label}: ${text}`)
}

function buildIncidentPresenter(record: Record<string, unknown>): SearchResultPresenter {
  return {
    title: stringValue(record.title) ?? stringValue(record.number) ?? 'Incident',
    subtitle: stringValue(record.number) ?? undefined,
  }
}

function buildIncidentLinks(record: Record<string, unknown>): SearchResultLink[] {
  const id = stringValue(record.id)
  const label = stringValue(record.number) ?? stringValue(record.title) ?? 'Open incident'
  if (!id) return []
  return [{ href: `/backend/incidents/${encodeURIComponent(id)}`, label, kind: 'primary' }]
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'incidents:incident',
      enabled: true,
      priority: 10,

      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const lines: string[] = []
        const record = ctx.record
        appendLine(lines, 'Number', record.number)
        appendLine(lines, 'Title', record.title)
        appendLine(lines, 'Description', record.description)
        appendLine(lines, 'Status', record.status)
        if (!lines.length) return null

        return {
          text: lines,
          presenter: buildIncidentPresenter(record),
          links: buildIncidentLinks(record),
          checksumSource: { record, customFields: ctx.customFields },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        return buildIncidentPresenter(ctx.record)
      },

      resolveLinks: async (ctx: SearchBuildContext): Promise<SearchResultLink[] | null> => {
        const links = buildIncidentLinks(ctx.record)
        return links.length ? links : null
      },

      fieldPolicy: {
        searchable: ['title', 'description', 'number'],
        hashOnly: [],
        excluded: [],
      },
      aclFeatures: ['incidents.incident.view'],
    },
  ],
}

export default searchConfig
