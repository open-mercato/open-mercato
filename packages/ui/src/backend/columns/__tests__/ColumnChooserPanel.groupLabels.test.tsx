// packages/ui/src/backend/columns/__tests__/ColumnChooserPanel.groupLabels.test.tsx
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { ColumnChooserSection } from '../ColumnChooserPanel'
import type { ColumnChooserField } from '../ColumnChooserPanel'

const availableColumns: ColumnChooserField[] = [
  { key: 'owner', label: 'Owner', group: 'customers.columnGroups.crm' },
  { key: 'email', label: 'Email', group: 'Contact' },
]

function renderSection(locale: string, dict: Record<string, string>) {
  return render(
    <I18nProvider locale={locale as never} dict={dict}>
      <ColumnChooserSection
        availableColumns={availableColumns}
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
})
