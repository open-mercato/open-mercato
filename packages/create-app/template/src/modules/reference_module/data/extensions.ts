import { defineLink, entityId } from '@open-mercato/shared/modules/dsl'
import type { EntityExtension } from '@open-mercato/shared/modules/entities'
import { REFERENCE_TASK_ENTITY_ID } from './entity-id'

export const extensions: EntityExtension[] = [
  defineLink(REFERENCE_TASK_ENTITY_ID, entityId('reference_module', 'reference_task_link'), {
    join: { baseKey: 'id', extensionKey: 'task_id' },
    cardinality: 'one-to-many',
    required: false,
    description: 'Scoped polymorphic IDs connect tasks to optional customer, catalog, or sales records without cross-module ORM relationships.',
  }),
]

export default extensions
