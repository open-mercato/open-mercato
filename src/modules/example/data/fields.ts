import { defineFields, cf, entityId } from '@/modules/dsl'
import type { CustomFieldSet } from '@/modules/entities'

// Declare custom fields for the Todo entity (entityId: 'example:todo')
// These are seeded to DB via: `npm run mercato custom_fields seed-defs -- --global`
export const fieldSets: CustomFieldSet[] = [
  defineFields(entityId('example', 'todo'), [
    cf.integer('priority', { label: 'Priority', description: '1 (low) to 5 (high)', defaultValue: 3, filterable: true }),
    cf.select('severity', ['low', 'medium', 'high'], { label: 'Severity', defaultValue: 'medium', filterable: true }),
    cf.boolean('blocked', { label: 'Blocked', defaultValue: false, filterable: true }),
  ], 'example'),
]

export default fieldSets

