import { buildFilterDefsFromCustomFields, type CustomFieldDefDto } from '../utils/customFieldFilters'

describe('buildFilterDefsFromCustomFields', () => {
  it('maps boolean/select/text and respects filterable/multi', () => {
    const defs: CustomFieldDefDto[] = [
      { key: 'blocked', kind: 'boolean', filterable: true },
      {
        key: 'severity',
        kind: 'select',
        filterable: true,
        options: [
          { value: 'low', label: 'low' },
          { value: 'medium', label: 'medium' },
          { value: 'high', label: 'high' },
        ],
      },
      {
        key: 'labels',
        kind: 'select',
        filterable: true,
        options: [
          { value: 'bug', label: 'bug' },
          { value: 'feature', label: 'feature' },
        ],
        multi: true,
      },
      { key: 'notes', kind: 'multiline', filterable: true },
      { key: 'hidden', kind: 'text', filterable: false },
    ]

    const out = buildFilterDefsFromCustomFields(defs)

    // boolean => checkbox
    expect(out.find(f => f.id === 'cf_blocked')!.type).toBe('checkbox')
    // select single => select with options and multiple false
    const sev = out.find(f => f.id === 'cf_severity')!
    expect(sev.type).toBe('select')
    if (sev.type !== 'select') throw new Error('expected select')
    expect(sev.multiple).toBeFalsy()
    expect((sev.options || []).map((o) => o.value)).toEqual(['low','medium','high'])
    // select multi => select with multiple true and id with In suffix
    const labels = out.find(f => f.id === 'cf_labelsIn')!
    expect(labels.type).toBe('select')
    if (labels.type !== 'select') throw new Error('expected select')
    expect(labels.multiple).toBe(true)
    expect((labels.options || []).map((o) => o.value)).toEqual(['bug','feature'])
    // text-like (multiline) => text
    expect(out.find(f => f.id === 'cf_notes')!.type).toBe('text')
    // non-filterable omitted
    expect(out.some(f => f.id === 'cf_hidden')).toBe(false)
  })

  it('maps multi text to tags with async suggestions support', () => {
    const defs: CustomFieldDefDto[] = [
      {
        key: 'labels',
        kind: 'text',
        filterable: true,
        multi: true,
        options: [
          { value: 'bug', label: 'bug' },
          { value: 'feature', label: 'feature' },
        ],
      },
    ]
    const out = buildFilterDefsFromCustomFields(defs)
    const labels = out.find(f => f.id === 'cf_labelsIn')!
    expect(labels.type).toBe('tags')
    if (labels.type !== 'tags') throw new Error('expected tags')
    expect((labels.options || []).map((o) => o.value)).toEqual(['bug','feature'])
  })
})
