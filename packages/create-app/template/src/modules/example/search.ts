import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchIndexSource,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

function todoTitle(record: Record<string, unknown>): string {
  const title = record.title
  if (typeof title === 'string' && title.trim().length > 0) return title.trim()
  return String(record.id ?? '')
}

function isDone(record: Record<string, unknown>): boolean {
  return record.is_done === true || record.isDone === true
}

function labelValues(customFields: Record<string, unknown>): string[] {
  const labels = customFields.labels
  if (Array.isArray(labels)) return labels.map(String).filter(Boolean)
  if (typeof labels === 'string' && labels.trim().length > 0) return [labels.trim()]
  return []
}

async function buildPresenter(ctx: SearchBuildContext): Promise<SearchResultPresenter> {
  const { t } = await resolveTranslations()
  return {
    title: todoTitle(ctx.record),
    subtitle: isDone(ctx.record)
      ? t('example.search.status.done', 'Done')
      : t('example.search.status.open', 'Open'),
    icon: 'lucide:check-square',
    badge: t('example.search.badge.todo', 'Todo'),
  }
}

/**
 * `example:example_customer_priority` is deliberately absent. It stores a customer
 * id and a priority enum and carries no human-readable text, so indexing it would
 * only add noise; without a config here it stays out of search results entirely.
 */
export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'example:todo',
      /**
       * The same feature `GET /api/example/todos` enforces. Global search, the
       * hybrid `GET /api/search/search` endpoint and the AI tools all fail closed
       * on a missing `aclFeatures`, so omitting this hides todos from every
       * non-superadmin instead of leaving them ungated.
       */
      aclFeatures: ['example.todos.view'],
      enabled: true,
      priority: 1,
      buildSource: async (ctx): Promise<SearchIndexSource | null> => {
        const lines: string[] = [`Title: ${todoTitle(ctx.record)}`]
        const labels = labelValues(ctx.customFields)
        if (labels.length > 0) lines.push(`Labels: ${labels.join(', ')}`)
        return {
          text: lines,
          presenter: await buildPresenter(ctx),
          checksumSource: { record: ctx.record, customFields: ctx.customFields },
        }
      },
      formatResult: async (ctx) => buildPresenter(ctx),
      resolveUrl: async (ctx) => `/backend/example/todos/${encodeURIComponent(String(ctx.record.id))}/edit`,
      fieldPolicy: {
        searchable: ['title'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
