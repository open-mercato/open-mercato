import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'
import { REFERENCE_TASK_ENTITY_ID } from './data/entity-id'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: REFERENCE_TASK_ENTITY_ID,
    fields: [{ field: 'description' }],
  },
  {
    entityId: 'reference_module:reference_task_link',
    fields: [{ field: 'target_label_snapshot' }],
  },
  {
    entityId: 'reference_module:reference_task_undo_snapshot',
    fields: [{ field: 'payload' }],
  },
]

export default defaultEncryptionMaps
