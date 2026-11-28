import * as React from 'react'
import type { EntityHeaderProps } from '../contracts/entity-header'

const noop = () => undefined

export const entityHeaderFixtures: Record<string, EntityHeaderProps> = {
  default: {
    title: 'Acme Corporation',
    subtitle: 'Customer since March 2021',
    avatar: { initials: 'AC' },
    badge: { label: 'Active', tone: 'success' },
    meta: [
      { key: 'owner', label: 'Owner', value: 'Jan Kowalski' },
      { key: 'segment', label: 'Segment', value: 'Enterprise' },
      { key: 'city', label: 'City', value: 'Warsaw' },
    ],
    actions: [
      { key: 'edit', label: 'Edit' },
      { key: 'share', label: 'Share' },
      { key: 'duplicate', label: 'Duplicate' },
      { key: 'delete', label: 'Delete', tone: 'destructive' },
    ],
    primaryActionKey: 'edit',
    onAction: noop,
  },
  readOnly: {
    title: 'Acme Corporation',
    subtitle: 'Customer since March 2021',
    avatar: { initials: 'AC' },
    badge: { label: 'Archived', tone: 'neutral' },
    meta: [
      { key: 'owner', label: 'Owner', value: 'Jan Kowalski' },
      { key: 'segment', label: 'Segment', value: 'Enterprise' },
    ],
  },
  minimal: { title: 'Acme Corporation' },
  loading: { title: 'Acme Corporation', status: 'loading' },
  error: { title: 'Acme Corporation', status: 'error', errorMessage: 'The record could not be loaded' },
  withSlots: {
    title: 'Acme Corporation',
    subtitle: 'Customer since March 2021',
    leading: React.createElement('div', { className: 'size-12 rounded-full bg-muted' }),
    trailing: React.createElement('span', { className: 'text-sm text-muted-foreground' }, 'Synced'),
    below: React.createElement('p', { className: 'text-sm text-muted-foreground' }, 'Last contact two days ago'),
    actions: [{ key: 'edit', label: 'Edit' }],
    primaryActionKey: 'edit',
    onAction: noop,
  },
  disabledAction: {
    title: 'Acme Corporation',
    badge: { label: 'Locked', tone: 'warning' },
    actions: [
      { key: 'edit', label: 'Edit', disabled: true, disabledReason: 'Another user is editing this record' },
      { key: 'share', label: 'Share' },
    ],
    primaryActionKey: 'edit',
    onAction: noop,
  },
}
