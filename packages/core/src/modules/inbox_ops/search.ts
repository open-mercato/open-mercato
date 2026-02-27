import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchResultPresenter,
  SearchIndexSource,
} from '@open-mercato/shared/modules/search'

type SearchContext = SearchBuildContext & {
  tenantId: string
}

function assertTenantContext(ctx: SearchBuildContext): asserts ctx is SearchContext {
  if (typeof ctx.tenantId !== 'string' || ctx.tenantId.length === 0) {
    throw new Error('[search.inbox_ops] Missing tenantId in search build context')
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'inbox_ops:inbox_proposal',
      enabled: true,
      priority: 6,
      fieldPolicy: {
        searchable: ['summary'],
        excluded: ['metadata', 'participants'],
      },
      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        assertTenantContext(ctx)
        const record = ctx.record
        if (!record.summary) return null

        return {
          text: String(record.summary || ''),
          fields: {
            status: record.status,
            confidence: record.confidence,
            detected_language: record.detected_language,
          },
          presenter: {
            title: String(record.summary || 'Inbox Proposal').slice(0, 80),
            subtitle: `Confidence: ${record.confidence} - Status: ${record.status}`,
            icon: 'inbox',
          },
          checksumSource: {
            summary: record.summary,
            status: record.status,
            confidence: record.confidence,
            detectedLanguage: record.detected_language,
          },
        }
      },
      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        return {
          title: String(ctx.record.summary || 'Inbox Proposal').slice(0, 80),
          subtitle: `Confidence: ${ctx.record.confidence} - Status: ${ctx.record.status}`,
          icon: 'inbox',
        }
      },
      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const id = ctx.record.id
        if (!id) return null
        return `/backend/inbox-ops/proposals/${encodeURIComponent(String(id))}`
      },
    },
  ],
}

export const config = searchConfig
export default searchConfig
