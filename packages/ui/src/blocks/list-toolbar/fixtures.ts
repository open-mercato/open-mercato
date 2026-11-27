import type { ListToolbarChip, ListToolbarProps, ListToolbarQuickFilter, ListToolbarView } from '../contracts/list-toolbar'

const noop = () => undefined

const search = { value: '', placeholder: 'Search deals' }

const quickFilters: ListToolbarQuickFilter[] = [
  { id: 'mine', label: 'My deals', icon: 'user', active: true, count: 12 },
  { id: 'open', label: 'Open', active: false, count: 48 },
  { id: 'closing', label: 'Closing this month', icon: 'calendar', active: false, count: 7 },
  { id: 'stalled', label: 'No activity in 14 days', active: false, count: 5 },
  { id: 'won', label: 'Won', active: false, disabled: true },
]

const chips: ListToolbarChip[] = [
  { id: 'stage', label: 'Stage: Negotiation' },
  { id: 'owner', label: 'Owner: Maria Lindqvist' },
  { id: 'value', label: 'Value: over 10,000' },
  { id: 'region', label: 'Region: North' },
]

const manyChips: ListToolbarChip[] = [
  ...chips,
  { id: 'source', label: 'Source: Referral' },
  { id: 'created', label: 'Created: last 30 days' },
  { id: 'priority', label: 'Priority: High' },
  { id: 'segment', label: 'Segment: Wholesale' },
  { id: 'currency', label: 'Currency: EUR' },
  { id: 'pipeline', label: 'Pipeline: Renewals', removable: false },
]

const views: ListToolbarView[] = [
  { id: 'table', label: 'Table', icon: 'rows' },
  { id: 'board', label: 'Board', icon: 'grid-3x3' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
]

const secondaryActions = [
  { key: 'import', label: 'Import', icon: 'file-spreadsheet' },
  { key: 'export', label: 'Export', icon: 'download' },
  { key: 'columns', label: 'Edit columns', icon: 'settings' },
]

export const listToolbarFixtures: Record<string, ListToolbarProps> = {
  searchOnly: { search, onSearchChange: noop },
  searchWithQuickFilters: { search, onSearchChange: noop, quickFilters, onQuickFilterToggle: noop },
  appliedFilters: {
    search,
    onSearchChange: noop,
    filtersActiveCount: 4,
    onOpenFilters: noop,
    chips,
    onChipOpen: noop,
    onChipRemove: noop,
    onAddFilter: noop,
    onClearAll: noop,
  },
  manyAppliedFilters: {
    search,
    onSearchChange: noop,
    filtersActiveCount: 10,
    onOpenFilters: noop,
    chips: manyChips,
    onChipOpen: noop,
    onChipRemove: noop,
    onAddFilter: noop,
    onClearAll: noop,
  },
  viewSwitch: {
    search,
    onSearchChange: noop,
    views,
    activeViewId: 'table',
    onViewChange: noop,
  },
  withActions: {
    search,
    onSearchChange: noop,
    primaryAction: { key: 'create', label: 'New deal', icon: 'plus-square' },
    secondaryActions,
    onAction: noop,
  },
  withLinkActions: {
    search,
    onSearchChange: noop,
    primaryAction: { key: 'create', label: 'New deal', icon: 'plus-square', href: '#new-deal' },
    secondaryActions: [
      { key: 'import', label: 'Import', icon: 'file-spreadsheet', href: '#import' },
      { key: 'export', label: 'Export', icon: 'download' },
      { key: 'columns', label: 'Edit columns', icon: 'settings' },
    ],
    onAction: noop,
  },
  full: {
    search,
    onSearchChange: noop,
    quickFilters,
    onQuickFilterToggle: noop,
    filtersActiveCount: 4,
    onOpenFilters: noop,
    chips,
    onChipOpen: noop,
    onChipRemove: noop,
    onAddFilter: noop,
    onClearAll: noop,
    views,
    activeViewId: 'table',
    onViewChange: noop,
    primaryAction: { key: 'create', label: 'New deal', icon: 'plus-square' },
    secondaryActions,
    onAction: noop,
    resultSummary: '128 results',
  },
  busy: {
    search: { value: 'north', placeholder: 'Search deals' },
    onSearchChange: noop,
    quickFilters: quickFilters.slice(0, 3),
    onQuickFilterToggle: noop,
    resultSummary: '128 results',
    busy: true,
  },
  loading: { status: 'loading' },
  sticky: {
    search,
    onSearchChange: noop,
    quickFilters: quickFilters.slice(0, 3),
    onQuickFilterToggle: noop,
    filtersActiveCount: 0,
    onOpenFilters: noop,
    resultSummary: '128 results',
    sticky: 'top',
    stickyOffset: '0px',
  },
}
