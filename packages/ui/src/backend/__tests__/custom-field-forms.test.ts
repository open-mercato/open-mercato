import { buildFormFieldsFromCustomFields } from '../utils/customFieldForms'
import type { CustomFieldDefDto } from '../utils/customFieldFilters'
import { FieldRegistry } from '../fields/registry'

describe('buildFormFieldsFromCustomFields', () => {
  beforeAll(() => {
    FieldRegistry.register('dictionary', { input: () => null })
    FieldRegistry.register('phone', { input: () => null })
  })

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
      { key: 'work_phone', kind: 'phone', filterable: true, formEditable: true },
      { key: 'notes', kind: 'multiline', filterable: false, formEditable: true },
      // text with editor hint should render richtext
      { key: 'desc', kind: 'text', filterable: false, formEditable: true, editor: 'htmlRichText' },
      {
        key: 'region',
        kind: 'dictionary',
        dictionaryId: 'dictionary-1',
        optionsUrl: '/api/dictionaries/dictionary-1/entries',
        filterable: true,
        formEditable: true,
      },
      {
        key: 'regions',
        kind: 'dictionary',
        dictionaryId: 'dictionary-1',
        optionsUrl: '/api/dictionaries/dictionary-1/entries',
        multi: true,
        filterable: true,
        formEditable: true,
      },
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
    // Phone resolves to a custom input via the field registry
    expect(byId['cf_work_phone']?.type).toBe('custom')
    // Multiline now defaults to richtext (markdown editor)
    expect(byId['cf_notes']?.type).toBe('richtext')
    expect(byId['cf_desc']?.type).toBe('richtext')
    if (byId['cf_desc']?.type === 'richtext') {
      expect(byId['cf_desc'].editor).toBe('html')
    }
    expect(byId['cf_region']?.type).toBe('custom')
    expect(byId['cf_regions']?.type).toBe('select')
    if (byId['cf_regions']?.type === 'select') {
      expect(byId['cf_regions'].multiple).toBe(true)
      expect(byId['cf_regions'].listbox).toBe(true)
      expect(typeof byId['cf_regions'].loadOptions).toBe('function')
    }
    expect(byId['cf_hidden']).toBeUndefined()
  })
})
