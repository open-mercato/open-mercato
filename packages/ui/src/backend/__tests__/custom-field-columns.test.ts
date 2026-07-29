import { mapCustomFieldKindToFilterType, supportsCustomFieldColumn } from '../utils/customFieldColumns'
import type { CustomFieldDefDto } from '../utils/customFieldDefs'

describe('mapCustomFieldKindToFilterType', () => {
  it('maps phone to a free-text filter (#62)', () => {
    expect(mapCustomFieldKindToFilterType('phone')).toBe('text')
  })

  it('keeps the established mappings for other kinds', () => {
    expect(mapCustomFieldKindToFilterType('boolean')).toBe('boolean')
    expect(mapCustomFieldKindToFilterType('integer')).toBe('number')
    expect(mapCustomFieldKindToFilterType('float')).toBe('number')
    expect(mapCustomFieldKindToFilterType('date')).toBe('date')
    expect(mapCustomFieldKindToFilterType('select')).toBe('select')
    expect(mapCustomFieldKindToFilterType('dictionary')).toBe('select')
    expect(mapCustomFieldKindToFilterType('text')).toBe('text')
  })
})

describe('supportsCustomFieldColumn', () => {
  it('renders a phone value as a normal list column (#62)', () => {
    expect(supportsCustomFieldColumn({ key: 'work_phone', kind: 'phone' } as CustomFieldDefDto)).toBe(true)
  })

  it('still excludes attachment columns', () => {
    expect(supportsCustomFieldColumn({ key: 'files', kind: 'attachment' } as CustomFieldDefDto)).toBe(false)
  })
})
