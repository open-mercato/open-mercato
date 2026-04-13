import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'vector:vector_search',
    fields: [
      { field: 'links' },
      { field: 'payload' },
      { field: 'result_title' },
      { field: 'result_subtitle' },
      { field: 'result_icon' },
      { field: 'result_badge' },
      { field: 'result_snapshot' },
      { field: 'primary_link_href' },
      { field: 'primary_link_label' },
    ],
  },
]

export default defaultEncryptionMaps
