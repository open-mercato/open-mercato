import type { VectorModuleConfig } from '@open-mercato/shared/modules/vector'

export const vectorConfig: VectorModuleConfig = {
  defaultDriverId: 'pgvector',
  entities: [
    {
      entityId: 'example:todo',
      buildSource: ({ record }) => ({
        input: [
          `Todo: ${record.title ?? ''}`,
          `Status: ${record.is_done ? 'done' : 'open'}`,
        ],
        checksumSource: {
          title: record.title,
          isDone: record.is_done,
          updatedAt: record.updated_at ?? record.updatedAt ?? null,
        },
      }),
      formatResult: ({ record }) => ({
        title: String(record.title ?? 'Todo'),
        subtitle: record.is_done ? 'Completed' : 'Open',
        icon: record.is_done ? 'check-circle' : 'circle',
      }),
      resolveUrl: ({ record }) => `/backend/todos/${encodeURIComponent(record.id ?? '')}/edit`,
    },
  ],
}

export default vectorConfig
export const config = vectorConfig
