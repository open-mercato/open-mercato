// packages/ui/src/backend/filters/__tests__/FilterFieldPicker.groupLabels.test.tsx
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { FilterFieldPicker } from '../FilterFieldPicker'
import type { FilterFieldDef } from '@open-mercato/shared/lib/query/advanced-filter'

const fields: FilterFieldDef[] = [
  { key: 'owner', label: 'Owner', type: 'text', group: 'customers.columnGroups.crm' },
  { key: 'email', label: 'Email', type: 'text', group: 'Contact' },
  { key: 'ungrouped', label: 'Ungrouped', type: 'text' },
]

function renderPicker(locale: string, dict: Record<string, string>) {
  return render(
    <I18nProvider locale={locale as never} dict={dict}>
      <FilterFieldPicker fields={fields} open onSelect={() => {}} onOpenChange={() => {}} triggerRef={{ current: null }} />
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
})
