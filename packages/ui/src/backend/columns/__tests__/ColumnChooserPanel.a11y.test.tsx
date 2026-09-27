import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { ColumnChooserSection } from '../ColumnChooserPanel'

const columns = [
  { key: 'name', label: 'Customer name', group: 'Customer', alwaysVisible: true },
  { key: 'email', label: 'Email address', group: 'Customer' },
  { key: 'status', label: 'Status', group: 'Deal' },
]

describe('ColumnChooserSection accessibility', () => {
  it('names visible and available column switches from their column labels', () => {
    render(
      <I18nProvider locale="en" dict={{}}>
        <ColumnChooserSection
          availableColumns={columns}
          visibleColumnKeys={['name', 'email']}
          columnOrder={['name', 'email', 'status']}
          onToggleColumn={jest.fn()}
          onReorderColumns={jest.fn()}
        />
      </I18nProvider>,
    )

    expect(screen.getByRole('switch', { name: 'Customer name' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Email address' })).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Deal' }))

    expect(screen.getByRole('switch', { name: 'Status' })).not.toBeChecked()
  })
})
