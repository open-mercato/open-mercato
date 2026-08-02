import type { SearchBuildContext, SearchModuleConfig, SearchResultPresenter } from '@open-mercato/shared/modules/search'
import { REFERENCE_TASK_ENTITY_ID } from './data/entity-id'

function readText(record: Record<string, unknown>, snake: string, camel = snake): string | null {
  const value = record[snake] ?? record[camel]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function buildReferenceTaskPresenter(ctx: SearchBuildContext): SearchResultPresenter {
  return {
    title: readText(ctx.record, 'title') ?? readText(ctx.record, 'id') ?? REFERENCE_TASK_ENTITY_ID,
    subtitle: readText(ctx.record, 'status') ?? undefined,
    icon: 'list-checks',
  }
}

export const searchConfig: SearchModuleConfig = {
  defaultStrategies: ['tokens'],
  entities: [
    {
      entityId: REFERENCE_TASK_ENTITY_ID,
      enabled: true,
      priority: 10,
      strategies: ['tokens'],
      aclFeatures: ['reference_module.view'],
      fieldPolicy: {
        searchable: ['title', 'status'],
        excluded: ['description', 'target_label_snapshot', 'payload'],
      },
      buildSource: (ctx) => {
        const title = readText(ctx.record, 'title')
        if (!title) return null
        const status = readText(ctx.record, 'status')
        return {
          text: status ? [title, status] : [title],
          fields: { status },
          presenter: buildReferenceTaskPresenter(ctx),
          checksumSource: { title, status },
        }
      },
      formatResult: buildReferenceTaskPresenter,
      resolveUrl: (ctx) => {
        const id = readText(ctx.record, 'id')
        return id ? `/backend/reference-module/tasks/${encodeURIComponent(id)}` : null
      },
    },
  ],
}

export default searchConfig
