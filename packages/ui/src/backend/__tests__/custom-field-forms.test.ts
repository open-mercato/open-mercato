import { buildFormFieldsFromCustomFields } from '../utils/customFieldForms'
import type { CustomFieldDefDto } from '../utils/customFieldFilters'

describe('buildFormFieldsFromCustomFields', () => {
  it('maps kinds to CrudField and filters by formEditable', () => {
    const defs: CustomFieldDefDto[] = [
      { key: 'blocked', kind: 'boolean', filterable: true, formEditable: true },
      { key: 'priority', kind: 'integer', filterable: true, formEditable: true },
      {
        key: 'severity',
        kind: 'select',
        options: [
          { id: 'low', value: 'low' },
          { id: 'high', value: 'high' },
        ],
        multi: false,
        filterable: true,
        formEditable: true,
      },
      {
        key: 'labels',
        kind: 'select',
        options: [
          { id: 'bug', value: 'bug' },
          { id: 'feature', value: 'feature' },
        ],
        multi: true,
        filterable: true,
        formEditable: true,
      },
      { key: 'notes', kind: 'multiline', filterable: false, formEditable: true },
      // text with editor hint should render richtext
      { key: 'desc', kind: 'text', filterable: false, formEditable: true, editor: 'htmlRichText' },
      { key: 'hidden', kind: 'text', filterable: true, formEditable: false },
    ]

    const fields = buildFormFieldsFromCustomFields(defs)
    const byId: Record<string, any> = Object.fromEntries(fields.map(f => [f.id, f]))
    expect(byId['cf_blocked']?.type).toBe('checkbox')
    expect(byId['cf_priority']?.type).toBe('number')
    expect(byId['cf_severity']?.type).toBe('select')
    expect(byId['cf_labels']?.type).toBe('select')
    if (byId['cf_labels']?.type === 'select') {
      expect(byId['cf_labels'].multiple).toBe(true)
    }
    // Multiline now defaults to richtext (markdown editor)
    expect(byId['cf_notes']?.type).toBe('richtext')
    expect(byId['cf_desc']?.type).toBe('richtext')
    if (byId['cf_desc']?.type === 'richtext') {
      expect(byId['cf_desc'].editor).toBe('html')
    }
    expect(byId['cf_hidden']).toBeUndefined()
  })
})
