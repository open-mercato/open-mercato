import type { SearchModuleConfig } from '@open-mercato/shared/modules/search'

function pickString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function appendLine(lines: string[], prefix: string, value: any): void {
  if (value != null && String(value).trim().length > 0) {
    lines.push(`${prefix}: ${value}`)
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'fms_documents:fms_document',
      enabled: true,
      priority: 8,

      buildSource: async (ctx) => {
        const { record } = ctx
        const lines: string[] = []

        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Category', record.category)
        appendLine(lines, 'Description', record.description)

        const title = pickString(record.name) ?? 'Untitled Document'
        const subtitle = pickString(record.category) ?? undefined

        const checksumSource = [
          record.name,
          record.category,
          record.description,
        ]
          .filter(Boolean)
          .join('|')

        return {
          text: lines,
          presenter: {
            title,
            subtitle,
            icon: 'file-text',
            badge: pickString(record.category) ?? undefined,
          },
          checksumSource,
        }
      },

      formatResult: async (ctx) => {
        const { record } = ctx

        return {
          title: pickString(record.name) ?? 'Untitled Document',
          subtitle: pickString(record.category) ?? undefined,
          icon: 'file-text',
          badge: pickString(record.category) ?? undefined,
        }
      },

      resolveUrl: async (ctx) => {
        return `/backend/fms-documents?id=${ctx.record.id}`
      },

      fieldPolicy: {
        searchable: ['name', 'category', 'description'],
        hashOnly: [],
        excluded: [
          'id',
          'organization_id',
          'tenant_id',
          'attachment_id',
          'related_entity_id',
          'related_entity_type',
          'extracted_data',
          'processed_at',
          'created_by',
          'updated_by',
          'deleted_at',
        ],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig