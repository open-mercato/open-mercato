/**
 * @jest-environment jsdom
 */
import { renderHook } from '@testing-library/react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useAutoDiscoveredFields } from '../useAutoDiscoveredFields'
import type { CustomFieldDefDto } from '../customFieldDefs'

type Row = { id: string; name: string; person?: { company?: { name?: string } } }

const NO_CUSTOM_FIELDS = [] as unknown as CustomFieldDefDto[]

function renderFields(columns: ColumnDef<Row>[]) {
  return renderHook(
    () => useAutoDiscoveredFields<Row>({ columns, customFieldDefs: NO_CUSTOM_FIELDS }),
  ).result.current
}

describe('useAutoDiscoveredFields with widget-injected columns', () => {
  // DataTable builds columns from the `data-table:<tableId>:columns` injection spot
  // as `accessorFn` + `id` so dotted access paths stay expressible.
  const injectedColumn: ColumnDef<Row> = {
    id: 'person.company.name',
    accessorFn: (row: Row) => row.person?.company?.name,
    header: 'Company',
  }

  it('lists an injected column in the column chooser keyed by its column id', () => {
    const { columnChooserFields } = renderFields([
      { accessorKey: 'name', header: 'Name' },
      injectedColumn,
    ])

    expect(columnChooserFields.map((field) => field.key)).toEqual(['name', 'person.company.name'])
    const injectedChooserField = columnChooserFields.find((field) => field.key === 'person.company.name')
    expect(injectedChooserField?.label).toBe('Company')
    expect(injectedChooserField?.alwaysVisible).toBe(false)
    expect(injectedChooserField?.defaultVisible).toBe(true)
  })

  it('keeps an injected column out of the auto-discovered filter fields', () => {
    const { advancedFilterFields } = renderFields([
      { accessorKey: 'name', header: 'Name' },
      injectedColumn,
    ])

    expect(advancedFilterFields.map((field) => field.key)).toEqual(['name'])
  })

  it('still derives a filter field when an injected column declares an explicit filterKey', () => {
    const { advancedFilterFields, columnChooserFields } = renderFields([
      { ...injectedColumn, meta: { filterKey: 'person_company_name' } } as ColumnDef<Row>,
    ])

    expect(advancedFilterFields.map((field) => field.key)).toEqual(['person_company_name'])
    expect(columnChooserFields.map((field) => field.key)).toEqual(['person.company.name'])
  })

  it('skips a column that has neither an accessorKey nor an id', () => {
    const { columnChooserFields, advancedFilterFields } = renderFields([
      { header: 'Orphan' } as ColumnDef<Row>,
    ])

    expect(columnChooserFields).toEqual([])
    expect(advancedFilterFields).toEqual([])
  })

  it('leaves ordinary accessorKey columns keyed by their accessorKey', () => {
    const { columnChooserFields, advancedFilterFields } = renderFields([
      { accessorKey: 'name', header: 'Name' },
    ])

    expect(columnChooserFields.map((field) => field.key)).toEqual(['name'])
    expect(advancedFilterFields.map((field) => field.key)).toEqual(['name'])
  })
})
