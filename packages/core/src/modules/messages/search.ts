import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchIndexSource,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'

function appendLine(lines: string[], label: string, value: unknown) {
  if (value === null || value === undefined) return
  const text = Array.isArray(value)
    ? value.map((item) => (item === null || item === undefined ? '' : String(item))).filter(Boolean).join(', ')
    : (typeof value === 'object' ? JSON.stringify(value) : String(value))
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

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

function buildMessagePresenter(record: Record<string, unknown>): SearchResultPresenter {
  const title = pickString(record.subject) ?? 'Message'
  const body = snippet(record.body)
  const externalName = pickString(record.external_name, record.externalName)
  const subtitle = [externalName, body].filter(Boolean).join(' · ') || undefined
  return {
    title: String(title),
    subtitle,
    icon: 'mail',
    badge: 'Message',
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'messages:message',
      enabled: true,
      priority: 5,
      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Subject', record.subject)
        appendLine(lines, 'Body', record.body)
        appendLine(lines, 'From name', record.external_name ?? record.externalName)
        if (!lines.length) return null
        return {
          text: lines,
          presenter: buildMessagePresenter(record),
          checksumSource: {
            record: {
              subject: record.subject,
              body: record.body,
              external_name: record.external_name ?? record.externalName,
              external_email_hash: record.external_email_hash ?? record.externalEmailHash,
            },
          },
        }
      },
      formatResult: async (ctx) => buildMessagePresenter(ctx.record),
      resolveUrl: async (ctx) => {
        const id = pickString(ctx.record.id)
        return id ? `/backend/messages/${encodeURIComponent(id)}` : null
      },
      fieldPolicy: {
        searchable: ['subject', 'body', 'external_name'],
        hashOnly: ['external_email'],
        excluded: ['action_data', 'action_result'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
