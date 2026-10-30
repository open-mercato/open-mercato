/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { renderHook } from '@testing-library/react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { useAutoDiscoveredFields } from '../useAutoDiscoveredFields'
import type { CustomFieldDefDto } from '../customFieldDefs'

type Row = { id: string; name: string }

const COLUMNS: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'grouped', header: 'Grouped', meta: { columnChooserGroup: 'Shipping' } },
]

const CUSTOM_FIELD_DEFS = [
  { key: 'note', label: 'Note', kind: 'text' },
] as unknown as CustomFieldDefDto[]

function wrapperFor(locale: string, dict: Record<string, string>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <I18nProvider locale={locale} dict={dict}>{children}</I18nProvider>
  }
}

function renderFields(locale: string, dict: Record<string, string>) {
  return renderHook(
    () => useAutoDiscoveredFields<Row>({ columns: COLUMNS, customFieldDefs: CUSTOM_FIELD_DEFS }),
    { wrapper: wrapperFor(locale, dict) },
  ).result.current
}

describe('useAutoDiscoveredFields group labels', () => {
  it('falls back to English group labels when no translation is registered', () => {
    const { columnChooserFields } = renderFields('en', {})
    expect(columnChooserFields.find((field) => field.key === 'name')?.group).toBe('Columns')
    expect(columnChooserFields.find((field) => field.key === 'cf_note')?.group).toBe('Custom Fields')
  })

  it('translates the default and custom-field group labels', () => {
    const { columnChooserFields, advancedFilterFields } = renderFields('pl', {
      'ui.columnChooser.defaultGroup': 'Kolumny',
      'ui.columnChooser.customFieldsGroup': 'Pola niestandardowe',
    })
    expect(columnChooserFields.find((field) => field.key === 'name')?.group).toBe('Kolumny')
    expect(columnChooserFields.find((field) => field.key === 'cf_note')?.group).toBe('Pola niestandardowe')
    expect(advancedFilterFields.find((field) => field.key === 'cf_note')?.group).toBe('Pola niestandardowe')
  })

  it('keeps explicit column-chooser groups untouched', () => {
    const { columnChooserFields } = renderFields('pl', {
      'ui.columnChooser.defaultGroup': 'Kolumny',
      'ui.columnChooser.customFieldsGroup': 'Pola niestandardowe',
    })
    expect(columnChooserFields.find((field) => field.key === 'grouped')?.group).toBe('Shipping')
  })
})
