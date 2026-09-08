import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type {
  VectorBuildContext,
  VectorIndexSource,
  VectorModuleConfig,
  VectorResultPresenter,
} from '@open-mercato/shared/modules/vector'

function readTitle(record: Record<string, unknown>): string | null {
  if (typeof record.title !== 'string') return null
  const title = record.title.trim()
  return title.length > 0 ? title : null
}

async function buildPresenter(record: Record<string, unknown>): Promise<VectorResultPresenter> {
  const { t } = await resolveTranslations()
  return {
    title: readTitle(record) ?? String(record.id ?? ''),
    subtitle: record.is_done === true
      ? t('example.search.todo.subtitle.done', 'Completed')
      : t('example.search.todo.subtitle.open', 'Open'),
    icon: 'check-square',
    badge: t('example.search.todo.badge', 'Todo'),
  }
}

async function buildTodoVectorSource(ctx: VectorBuildContext): Promise<VectorIndexSource | null> {
  const title = readTitle(ctx.record)
  if (!title) return null
  const labels = Array.isArray(ctx.customFields.labels)
    ? ctx.customFields.labels.filter((label): label is string => typeof label === 'string')
    : []
  const input = labels.length > 0 ? [title, ...labels] : title
  return {
    input,
    presenter: await buildPresenter(ctx.record),
    links: [{
      href: `/backend/todos/${encodeURIComponent(String(ctx.record.id ?? ''))}/edit`,
      kind: 'primary',
    }],
    checksumSource: {
      id: ctx.record.id,
      title,
      isDone: ctx.record.is_done === true,
      labels,
    },
  }
}

export const vectorConfig: VectorModuleConfig = {
  defaultDriverId: 'pgvector',
  entities: [
    {
      entityId: 'example:todo',
      enabled: true,
      priority: 5,
      buildSource: buildTodoVectorSource,
      formatResult: async (ctx) => buildPresenter(ctx.record),
      resolveUrl: (ctx) => `/backend/todos/${encodeURIComponent(String(ctx.record.id ?? ''))}/edit`,
      fieldPolicy: {
        searchable: ['title', 'labels'],
        excluded: ['notes'],
      },
    },
  ],
}

export const config = vectorConfig

export default vectorConfig

