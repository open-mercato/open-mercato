/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { ChangedFieldsTable } from '../display-helpers'

const dict: Record<string, string> = {
  'audit_logs.actions.details.changed_fields': 'Changed fields',
  'audit_logs.actions.details.field': 'Field',
  'audit_logs.actions.details.before': 'Before',
  'audit_logs.actions.details.after': 'After',
  'audit_logs.actions.details.no_changes': 'No tracked field changes',
}

const t = ((key: string) => dict[key] ?? key) as TranslateFn

const changeRows = [
  { field: 'lifecycleStage', from: 'lead', to: 'customer' },
  { field: 'cf_billing_address', from: null, to: { city: 'Bristol' } },
]

describe('ChangedFieldsTable', () => {
  it('renders the table header from the shared i18n keys', () => {
    render(<ChangedFieldsTable changeRows={changeRows} noneLabel="None" t={t} />)
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual(['Field', 'Before', 'After'])
  })

  it('renders each field and its values exactly once', () => {
    render(<ChangedFieldsTable changeRows={changeRows} noneLabel="None" t={t} />)
    expect(screen.getAllByText('Lifecycle Stage')).toHaveLength(1)
    expect(screen.getAllByText('lead')).toHaveLength(1)
    expect(screen.getAllByText('customer')).toHaveLength(1)
    expect(screen.getAllByText('Billing Address')).toHaveLength(1)
  })

  it('repeats the before/after labels inside every row so the stacked layout stays readable', () => {
    render(<ChangedFieldsTable changeRows={changeRows} noneLabel="None" t={t} />)
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(changeRows.length)
    for (const row of rows) {
      expect(within(row).getByText('Before')).toBeInTheDocument()
      expect(within(row).getByText('After')).toBeInTheDocument()
    }
  })

  it('uses the beforeLabel/afterLabel overrides for both the header and the per-row labels', () => {
    render(
      <ChangedFieldsTable
        changeRows={changeRows}
        noneLabel="None"
        t={t}
        beforeLabel="Incoming"
        afterLabel="Current"
      />,
    )
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual(['Field', 'Incoming', 'Current'])
    expect(screen.getAllByText('Incoming')).toHaveLength(1 + changeRows.length)
    expect(screen.getAllByText('Current')).toHaveLength(1 + changeRows.length)
    expect(screen.queryByText('Before')).not.toBeInTheDocument()
  })

  it('falls back to noneLabel for empty values', () => {
    render(<ChangedFieldsTable changeRows={changeRows} noneLabel="None" t={t} />)
    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('renders the empty state instead of a table when there are no changes', () => {
    render(<ChangedFieldsTable changeRows={[]} noneLabel="None" t={t} />)
    expect(screen.getByText('No tracked field changes')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
