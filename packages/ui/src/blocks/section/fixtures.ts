import type { SectionProps } from '../contracts/section'

const noop = () => undefined

export const sectionFixtures: Record<string, SectionProps> = {
  default: {
    title: 'Company details',
    description: 'Used on quotes, orders and invoices.',
    icon: 'building',
    actions: [
      { key: 'edit', label: 'Edit', icon: 'pencil-line' },
      { key: 'copy', label: 'Copy details', icon: 'copy' },
      { key: 'history', label: 'View history', icon: 'clock', href: '#history' },
    ],
    onAction: noop,
  },
  overflowingActions: {
    title: 'Contacts',
    count: 4,
    icon: 'users',
    actions: [
      { key: 'add', label: 'Add contact', icon: 'user-plus' },
      { key: 'import', label: 'Import', icon: 'file-spreadsheet' },
      { key: 'export', label: 'Export', icon: 'download' },
      { key: 'history', label: 'View history', icon: 'clock', href: '#history' },
      { key: 'remove-all', label: 'Remove all', icon: 'trash-2', tone: 'destructive' },
    ],
    onAction: noop,
  },
  settingsSplit: {
    title: 'Order notifications',
    description: 'Who hears about an order and how often they are reminded.',
    layout: 'split',
    footerNote: 'Applies to orders placed from now on.',
  },
  plain: {
    title: 'Billing details',
    description: 'Shown on invoices.',
    variant: 'plain',
    actions: [{ key: 'edit', label: 'Edit', icon: 'pencil-line' }],
    onAction: noop,
  },
  plainSecond: {
    title: 'Payment',
    description: 'Applied to new orders.',
    variant: 'plain',
    actions: [{ key: 'edit', label: 'Edit', icon: 'pencil-line' }],
    onAction: noop,
  },
  flush: {
    title: 'Team members',
    count: 4,
    padding: 'none',
    actions: [{ key: 'invite', label: 'Invite', icon: 'user-plus' }],
    onAction: noop,
  },
  collapsible: {
    title: 'Advanced settings',
    description: 'Rarely changed options for rounding and numbering.',
    icon: 'sliders-horizontal',
    collapsible: true,
    defaultCollapsed: true,
    summary: 'Rounding per line, numbers reset yearly',
  },
  collapsibleExpanded: {
    title: 'Shipping rules',
    count: 3,
    icon: 'truck',
    collapsible: true,
    summary: 'Free above 400 EUR, two carriers',
    actions: [{ key: 'add', label: 'Add rule', icon: 'plus-square' }],
    onAction: noop,
  },
  errorTone: {
    title: 'Delete this company',
    description: 'Removes the company with its contacts and addresses. Orders and invoices are kept.',
    tone: 'error',
  },
  loading: {
    title: 'Recent orders',
    icon: 'package',
    status: 'loading',
    actions: [{ key: 'create', label: 'Create order', icon: 'plus-square' }],
    onAction: noop,
  },
  error: {
    title: 'Recent orders',
    icon: 'package',
    status: 'error',
    errorMessage: 'Recent orders could not be loaded.',
    onRetry: noop,
  },
  empty: {
    title: 'Recent orders',
    icon: 'package',
    status: 'empty',
    emptyTitle: 'No orders yet',
    emptyDescription: 'Orders placed by this company will be listed here.',
    actions: [{ key: 'create', label: 'Create order', icon: 'plus-square' }],
    onAction: noop,
  },
  narrow: {
    title: 'Warehouse locations with same day delivery',
    description: 'Locations that can ship an order on the day it is placed.',
    count: 12,
    actions: [
      { key: 'add', label: 'Add location', icon: 'plus-square' },
      { key: 'import', label: 'Import', icon: 'file-spreadsheet' },
      { key: 'remove-all', label: 'Remove all', icon: 'trash-2', tone: 'destructive' },
    ],
    onAction: noop,
  },
}
