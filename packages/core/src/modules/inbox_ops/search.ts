import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchResultPresenter,
  SearchIndexSource,
} from '@open-mercato/shared/modules/search'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

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
        searchable: ['summary', 'category'],
        excluded: ['metadata', 'participants'],
      },
      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        assertTenantContext(ctx)
        const record = ctx.record
        if (!record.summary) return null

        const { t } = await resolveTranslations()
        const confidence = String(record.confidence ?? '')
        const status = String(record.status ?? '')
        const category = record.category ? String(record.category) : ''
        const subtitle = category
          ? t('inbox_ops.search.subtitle.templateWithCategory', 'Confidence: {{confidence}} · Status: {{status}} · Category: {{category}}', { confidence, status, category })
          : t('inbox_ops.search.subtitle.template', 'Confidence: {{confidence}} · Status: {{status}}', { confidence, status })

        return {
          text: String(record.summary || ''),
          fields: {
            status: record.status,
            confidence: record.confidence,
            category: record.category,
            detected_language: record.detected_language,
          },
          presenter: {
            title: String(record.summary || t('inbox_ops.search.fallback.title', 'Inbox Proposal')).slice(0, 80),
            subtitle,
            icon: 'inbox',
          },
          checksumSource: {
            summary: record.summary,
            status: record.status,
            confidence: record.confidence,
            category: record.category,
            detectedLanguage: record.detected_language,
          },
        }
      },
      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        const { t } = await resolveTranslations()
        const confidence = String(ctx.record.confidence ?? '')
        const status = String(ctx.record.status ?? '')
        const category = ctx.record.category ? String(ctx.record.category) : ''
        const subtitle = category
          ? t('inbox_ops.search.subtitle.templateWithCategory', 'Confidence: {{confidence}} · Status: {{status}} · Category: {{category}}', { confidence, status, category })
          : t('inbox_ops.search.subtitle.template', 'Confidence: {{confidence}} · Status: {{status}}', { confidence, status })
        return {
          title: String(ctx.record.summary || t('inbox_ops.search.fallback.title', 'Inbox Proposal')).slice(0, 80),
          subtitle,
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
