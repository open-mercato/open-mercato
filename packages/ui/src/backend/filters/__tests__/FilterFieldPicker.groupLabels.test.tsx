// packages/ui/src/backend/filters/__tests__/FilterFieldPicker.groupLabels.test.tsx
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import { FilterFieldPicker } from '../FilterFieldPicker'
import type { FilterFieldDef } from '@open-mercato/shared/lib/query/advanced-filter'

const fields: FilterFieldDef[] = [
  { key: 'owner', label: 'Owner', type: 'text', group: 'customers.columnGroups.crm' },
  { key: 'email', label: 'Email', type: 'text', group: 'Contact' },
  { key: 'ungrouped', label: 'Ungrouped', type: 'text' },
]

function renderPicker(locale: Locale, dict: Record<string, string>, pickerFields = fields) {
  return render(
    <I18nProvider locale={locale} dict={dict}>
      <FilterFieldPicker fields={pickerFields} open onSelect={() => {}} onOpenChange={() => {}} triggerRef={{ current: null }} />
    </I18nProvider>,
  )
}

describe('FilterFieldPicker group labels', () => {
  it('translates group labels a host registered in its locale file', () => {
    renderPicker('pl', {
      'customers.columnGroups.crm': 'CRM PL',
      'ui.advancedFilter.fieldPicker.ungrouped': 'Więcej',
    })
    expect(screen.getByText('CRM PL')).toBeInTheDocument()
    expect(screen.queryByText('customers.columnGroups.crm')).not.toBeInTheDocument()
  })

  it('renders unrecognized group strings verbatim', () => {
    renderPicker('pl', { 'customers.columnGroups.crm': 'CRM PL' })
    expect(screen.getByText('Contact')).toBeInTheDocument()
  })

  it('translates the fallback group label for fields without a group', () => {
    renderPicker('pl', { 'ui.advancedFilter.fieldPicker.ungrouped': 'Więcej' })
    expect(screen.getByText('Więcej')).toBeInTheDocument()
    expect(screen.queryByText('More')).not.toBeInTheDocument()
  })

  it('falls back to the English label when no translation is registered', () => {
    renderPicker('en', {})
    expect(screen.getByText('More')).toBeInTheDocument()
    expect(screen.getByText('Contact')).toBeInTheDocument()
  })

  it('never resolves tenant-authored group titles as translation keys', () => {
    renderPicker('pl', { 'Deal pipeline': 'Lejek sprzedaży' }, [
      { key: 'stage', label: 'Stage', type: 'text', group: 'Deal pipeline' },
    ])
    expect(screen.getByText('Deal pipeline')).toBeInTheDocument()
    expect(screen.queryByText('Lejek sprzedaży')).not.toBeInTheDocument()
  })

  it('keeps ungrouped identity locale-independent instead of splitting on the translated label', () => {
    renderPicker('pl', { 'ui.advancedFilter.fieldPicker.ungrouped': 'Więcej' }, [
      { key: 'ungrouped', label: 'Ungrouped', type: 'text' },
      { key: 'more', label: 'More field', type: 'text', group: 'More' },
    ])
    expect(screen.getByText('Więcej')).toBeInTheDocument()
    expect(screen.getByText('More')).toBeInTheDocument()
  })

  it('keys grouping on the raw group string so two groups sharing a translation stay apart', () => {
    renderPicker('pl', {
      'customers.columnGroups.crm': 'CRM',
      'customers.columnGroups.pipeline': 'CRM',
    }, [
      { key: 'owner', label: 'Owner', type: 'text', group: 'customers.columnGroups.crm' },
      { key: 'stage', label: 'Stage', type: 'text', group: 'customers.columnGroups.pipeline' },
    ])
    expect(screen.getAllByText('CRM')).toHaveLength(2)
  })
})
