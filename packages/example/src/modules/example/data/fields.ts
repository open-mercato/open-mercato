import { defineFields, cf } from '@/modules/dsl'
import { E } from '@open-mercato/example/datamodel/entities'
import type { CustomFieldSet } from '@/modules/entities'

// Custom fields for the example Todo entity (entityId: 'example:todo')
export const fieldSets: CustomFieldSet[] = [
  defineFields(E.example.todo, [
    cf.integer('priority', { label: 'Priority', description: '1 (low) to 5 (high)', defaultValue: 3, filterable: true }),
    cf.select('severity', ['low', 'medium', 'high'], { label: 'Severity', defaultValue: 'medium', filterable: true }),
    cf.boolean('blocked', { label: 'Blocked', defaultValue: false, filterable: true }),
  ], 'example'),
]

export default fieldSets
