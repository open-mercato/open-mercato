import { defineFields, cf } from '@/modules/dsl'
import { E } from '@open-mercato/example/datamodel/entities'
import type { CustomFieldSet } from '@/modules/entities'

// Custom fields for the example Todo entity (entityId: 'example:todo')
export const fieldSets: CustomFieldSet[] = [
  defineFields(E.example.todo, [
    cf.integer('priority', { label: 'Priority', description: '1 (low) to 5 (high)', defaultValue: 3, filterable: true, formEditable: true }),
    cf.select('severity', ['low', 'medium', 'high'], { label: 'Severity', defaultValue: 'medium', filterable: true, formEditable: true }),
    cf.boolean('blocked', { label: 'Blocked', defaultValue: false, filterable: true, formEditable: true }),
    // Multi-select labels CF; stored as multiple rows (EAV)
    cf.select('labels', ['frontend', 'backend', 'ops', 'bug', 'feature'], { label: 'Labels', filterable: true, formEditable: true, multi: true }),
    cf.multiline('description', { label: 'Description', formEditable: true }),
    // Assignees selection (multi-select). In a real app, derive options dynamically.
    cf.select('assignee', ['alice', 'bob', 'charlie', 'diana'], { label: 'Assignees', formEditable: true, multi: true }),
  ], 'example'),

  
]

export default fieldSets
