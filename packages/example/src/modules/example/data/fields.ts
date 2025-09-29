import { defineFields, cf } from '@/modules/dsl'
import { E } from '@open-mercato/example/datamodel/entities'
import type { CustomFieldSet } from '@/modules/entities'

// Custom fields for the example Todo entity (entityId: 'example:todo')
export const fieldSets: CustomFieldSet[] = [
  defineFields(E.example.todo, [
    cf.integer('priority', { label: 'Priority', description: '1 (low) to 5 (high)', defaultValue: 3, filterable: true, formEditable: true }),
    cf.select('severity', ['low', 'medium', 'high'], { label: 'Severity', defaultValue: 'medium', filterable: true, formEditable: true }),
    cf.boolean('blocked', { label: 'Blocked', defaultValue: false, filterable: true, formEditable: true }),
    // Free-form labels as tags input (multi text)
    cf.text('labels', { label: 'Labels', formEditable: true, multi: true, filterable: true, input: 'tags', optionsUrl: '/api/example/tags' }),
    // Rich description (markdown editor by default)
    cf.multiline('description', { label: 'Description', formEditable: true, editor: 'markdown' }),
    // Assignees selection (multi-select) loaded dynamically from API; render as listbox
    // Keep fallback options for initial UX; UI will use optionsUrl when present
    cf.select('assignee', ['alice', 'bob', 'charlie', 'diana'], { label: 'Assignees', formEditable: true, multi: true, optionsUrl: '/api/example/assignees', input: 'listbox' }),
  ], 'example'),

  
]

export default fieldSets
