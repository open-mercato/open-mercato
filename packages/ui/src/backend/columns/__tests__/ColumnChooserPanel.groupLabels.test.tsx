// packages/ui/src/backend/columns/__tests__/ColumnChooserPanel.groupLabels.test.tsx
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import { ColumnChooserSection } from '../ColumnChooserPanel'
import type { ColumnChooserField } from '../ColumnChooserPanel'

const availableColumns: ColumnChooserField[] = [
  { key: 'owner', label: 'Owner', group: 'customers.columnGroups.crm' },
  { key: 'email', label: 'Email', group: 'Contact' },
]

function renderSection(locale: Locale, dict: Record<string, string>, columns = availableColumns) {
  return render(
    <I18nProvider locale={locale} dict={dict}>
      <ColumnChooserSection
        availableColumns={columns}
        visibleColumnKeys={[]}
        columnOrder={[]}
        onToggleColumn={() => {}}
        onReorderColumns={() => {}}
      />
    </I18nProvider>,
  )
}

describe('ColumnChooserSection group labels', () => {
  it('translates group labels a host registered in its locale file', () => {
    renderSection('pl', { 'customers.columnGroups.crm': 'CRM PL' })
    expect(screen.getByText('CRM PL')).toBeInTheDocument()
    expect(screen.queryByText('customers.columnGroups.crm')).not.toBeInTheDocument()
  })

  it('renders unrecognized group strings verbatim', () => {
    renderSection('pl', { 'customers.columnGroups.crm': 'CRM PL' })
    expect(screen.getByText('Contact')).toBeInTheDocument()
  })

  it('falls back to the raw group label when no translation is registered', () => {
    renderSection('en', {})
    expect(screen.getByText('customers.columnGroups.crm')).toBeInTheDocument()
    expect(screen.getByText('Contact')).toBeInTheDocument()
  })

  it('never resolves tenant-authored group titles as translation keys', () => {
    renderSection('pl', { 'Deal pipeline': 'Lejek sprzedaży' }, [
      { key: 'stage', label: 'Stage', group: 'Deal pipeline' },
    ])
    expect(screen.getByText('Deal pipeline')).toBeInTheDocument()
    expect(screen.queryByText('Lejek sprzedaży')).not.toBeInTheDocument()
  })

  it('translates the ungrouped fallback for columns that declare no group', () => {
    renderSection('pl', { 'ui.columnChooser.ungrouped': 'Pozostałe' }, [
      { key: 'notes', label: 'Notes' },
    ])
    expect(screen.getByText('Pozostałe')).toBeInTheDocument()
    expect(screen.queryByText('Other')).not.toBeInTheDocument()
  })

  it('keys grouping on the raw group string so two groups sharing a translation stay apart', () => {
    renderSection('pl', {
      'customers.columnGroups.crm': 'CRM',
      'customers.columnGroups.pipeline': 'CRM',
    }, [
      { key: 'owner', label: 'Owner', group: 'customers.columnGroups.crm' },
      { key: 'stage', label: 'Stage', group: 'customers.columnGroups.pipeline' },
    ])
    expect(screen.getAllByText('CRM')).toHaveLength(2)
  })
})
