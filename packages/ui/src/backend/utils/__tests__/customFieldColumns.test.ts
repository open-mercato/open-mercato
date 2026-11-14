import { applyCustomFieldVisibility } from '../customFieldColumns'
import type { CustomFieldDefDto } from '../customFieldDefs'

const definitions: CustomFieldDefDto[] = [
  { key: 'priority', kind: 'integer', label: 'Business priority' },
  { key: 'description', kind: 'multiline', label: 'Description' },
]

describe('custom-field column headers', () => {
  it('keeps tenant-defined labels authoritative over host defaults', () => {
    const columns = applyCustomFieldVisibility([{ accessorKey: 'cf_priority', header: 'Priorytet' }], definitions)
    expect(columns[0].header).toBe('Business priority')
    expect(columns[0].meta).toMatchObject({ label: 'Business priority' })
    expect(columns[1].header).toBe('Description')
  })

  it('uses definition labels when a column has no header', () => {
    const columns = applyCustomFieldVisibility([{ accessorKey: 'cf_priority' }], definitions)
    expect(columns[0].header).toBe('Business priority')
  })

  it('omits hidden fields and preserves custom header renderers', () => {
    const header = () => 'Custom'
    const columns = applyCustomFieldVisibility([
      { accessorKey: 'cf_priority', header },
      { accessorKey: 'cf_description', header: 'Opis' },
    ], [definitions[0], { ...definitions[1], listVisible: false }])
    expect(columns).toHaveLength(1)
    expect(columns[0].header).toBe(header)
  })
})
