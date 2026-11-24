import * as React from 'react'
import type { KeyValueProps } from '../contracts/key-value'

const resolveEdit = async (): Promise<void> => undefined

const readOnlyItems: KeyValueProps['items'] = [
  { key: 'owner', label: 'Owner', value: 'Anna Kowalska' },
  { key: 'email', label: 'Email', value: 'anna@example.com', hint: 'Primary contact' },
  { key: 'segment', label: 'Segment', value: 'Enterprise' },
  { key: 'created', label: 'Created', value: '2026-03-14' },
]

export const keyValueFixtures: Record<
  'readOnly' | 'twoColumns' | 'editable' | 'richValue' | 'loading' | 'error' | 'empty',
  KeyValueProps
> = {
  readOnly: { items: readOnlyItems },
  twoColumns: { items: readOnlyItems, columns: 2 },
  editable: {
    columns: 2,
    onEdit: resolveEdit,
    items: [
      { key: 'name', label: 'Name', value: 'Acme Corp', editable: true, editor: 'text' },
      {
        key: 'notes',
        label: 'Notes',
        value: 'Prefers email contact in the morning.',
        editable: true,
        editor: 'textarea',
      },
      {
        key: 'stage',
        label: 'Stage',
        value: 'qualified',
        editable: true,
        editor: 'select',
        options: [
          { value: 'new', label: 'New' },
          { value: 'qualified', label: 'Qualified' },
          { value: 'won', label: 'Won' },
        ],
      },
      { key: 'renewal', label: 'Renewal date', value: '2026-09-01', editable: true, editor: 'date' },
      { key: 'id', label: 'Record ID', value: 'REC-1042' },
    ],
  },
  richValue: {
    items: [
      {
        key: 'website',
        label: 'Website',
        value: React.createElement('a', { href: 'https://example.com', className: 'text-primary underline' }, 'example.com'),
      },
      { key: 'plan', label: 'Plan', value: React.createElement('span', null, 'Business, billed yearly') },
    ],
  },
  loading: { items: [], status: 'loading' },
  error: { items: [], status: 'error', errorMessage: 'Could not load details.' },
  empty: { items: [], status: 'empty' },
}
