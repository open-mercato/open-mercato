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
          { value: 'low', label: 'low' },
          { value: 'high', label: 'high' },
        ],
        multi: false,
        filterable: true,
        formEditable: true,
      },
      {
        key: 'labels',
        kind: 'select',
        options: [
          { value: 'bug', label: 'bug' },
          { value: 'feature', label: 'feature' },
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

  it('extracts min/max from gte/lte validation rules for number fields', () => {
    const defs: CustomFieldDefDto[] = [
      {
        key: 'priority',
        kind: 'integer',
        filterable: true,
        formEditable: true,
        validation: [
          { rule: 'required', message: 'Priority is required' },
          { rule: 'integer', message: 'Priority must be an integer' },
          { rule: 'gte', param: 1, message: 'Priority must be >= 1' },
          { rule: 'lte', param: 5, message: 'Priority must be <= 5' },
        ],
      } as any,
      {
        key: 'score',
        kind: 'float',
        filterable: true,
        formEditable: true,
      } as any,
    ]

    const fields = buildFormFieldsFromCustomFields(defs)
    const priority = fields.find(f => f.id === 'cf_priority')
    expect(priority?.type).toBe('number')
    if (priority?.type === 'number') {
      expect(priority.min).toBe(1)
      expect(priority.max).toBe(5)
    }

    const score = fields.find(f => f.id === 'cf_score')
    expect(score?.type).toBe('number')
    if (score?.type === 'number') {
      expect(score.min).toBeUndefined()
      expect(score.max).toBeUndefined()
    }
  })
})
