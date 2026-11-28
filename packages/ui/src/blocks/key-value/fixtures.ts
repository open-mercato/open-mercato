import * as React from 'react'
import { Building2, CalendarDays, Mail, UserRound } from 'lucide-react'
import type { KeyValueProps } from '../contracts/key-value'

const resolveEdit = async (): Promise<void> => undefined
const retry = (): void => undefined

const linkClassName =
  '-my-2 inline-flex min-h-8 items-center rounded-sm text-accent-indigo underline underline-offset-4 outline-none transition-colors hover:text-accent-indigo/80 focus-visible:shadow-focus'

const readOnlyItems: KeyValueProps['items'] = [
  { key: 'owner', label: 'Owner', value: 'Anna Kowalska' },
  { key: 'email', label: 'Email', value: 'anna@example.com', hint: 'Primary contact' },
  { key: 'segment', label: 'Segment', value: 'Enterprise' },
  { key: 'created', label: 'Created', value: '2026-03-14', format: 'date' },
]

const itemIcons: Record<string, React.ReactNode> = {
  owner: React.createElement(UserRound),
  email: React.createElement(Mail),
  segment: React.createElement(Building2),
  created: React.createElement(CalendarDays),
}

const editableItems: KeyValueProps['items'] = [
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
]

const longItems: KeyValueProps['items'] = [
  {
    key: 'billing',
    label: 'Billing address used for invoices and credit notes',
    value: 'Aleje Jerozolimskie 181B, 02-222 Warszawa, Mazowieckie, Poland',
    hint: 'Shown on every invoice issued after the next billing cycle starts',
  },
  {
    key: 'reference',
    label: 'Reference',
    value: 'PO-2026-000184-EMEA-RENEWAL-ENTERPRISE-ANNUAL-PREPAID-0001',
  },
  { key: 'owner', label: 'Owner', value: 'Anna Kowalska' },
]

export const keyValueFixtures: Record<
  | 'readOnly'
  | 'twoColumns'
  | 'vertical'
  | 'bordered'
  | 'borderedOdd'
  | 'withIcons'
  | 'longContent'
  | 'withFooter'
  | 'editable'
  | 'editingText'
  | 'editingTextarea'
  | 'editingSelect'
  | 'editingDate'
  | 'richValue'
  | 'loading'
  | 'error'
  | 'empty',
  KeyValueProps
> = {
  readOnly: { items: readOnlyItems },
  twoColumns: { items: readOnlyItems, columns: 2 },
  vertical: { items: readOnlyItems, columns: 2, layout: 'vertical' },
  bordered: { items: readOnlyItems, columns: 2, bordered: true },
  borderedOdd: { items: readOnlyItems.slice(0, 3), columns: 2, bordered: true },
  withIcons: { items: readOnlyItems.map((item) => ({ ...item, icon: itemIcons[item.key] })) },
  longContent: { items: longItems },
  withFooter: {
    items: readOnlyItems,
    footer: React.createElement('p', { className: 'text-xs text-muted-foreground' }, 'Synced from the billing system'),
  },
  editable: { columns: 2, onEdit: resolveEdit, items: editableItems },
  editingText: { onEdit: resolveEdit, items: editableItems, defaultEditingKey: 'name' },
  editingTextarea: { onEdit: resolveEdit, items: editableItems, defaultEditingKey: 'notes' },
  editingSelect: { onEdit: resolveEdit, items: editableItems, defaultEditingKey: 'stage' },
  editingDate: { onEdit: resolveEdit, items: editableItems, defaultEditingKey: 'renewal' },
  richValue: {
    items: [
      {
        key: 'website',
        label: 'Website',
        value: React.createElement('a', { href: 'https://example.com', className: linkClassName }, 'example.com'),
      },
      { key: 'plan', label: 'Plan', value: React.createElement('span', null, 'Business, billed yearly') },
    ],
  },
  loading: { items: [], status: 'loading' },
  error: { items: [], status: 'error', errorMessage: 'Could not load details.', onRetry: retry },
  empty: { items: [], status: 'empty' },
}
