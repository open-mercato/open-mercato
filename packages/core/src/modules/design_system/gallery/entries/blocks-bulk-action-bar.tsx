import * as React from 'react'
import { BulkActionBar } from '@open-mercato/ui/blocks/bulk-action-bar'
import { bulkActionBarFixtures } from '@open-mercato/ui/blocks/bulk-action-bar/fixtures'
import { bulkActionBarPropsSchema } from '@open-mercato/ui/blocks/contracts/bulk-action-bar'
import type { GalleryEntry } from '../types'

const bulkActionBarCode = (props: string) => `import { BulkActionBar } from '@open-mercato/ui/blocks/bulk-action-bar'

<BulkActionBar
${props}
/>`

function FloatingPreview() {
  return (
    <div className="relative h-56 transform-gpu overflow-hidden rounded-card border border-border bg-background">
      <ul className="divide-y divide-border text-sm text-foreground">
        {['Northwind renewal', 'Harbor logistics pilot', 'Summit retail expansion', 'Lakeside onboarding', 'Ridge supply contract'].map(
          (name) => (
            <li key={name} className="px-4 py-3">
              {name}
            </li>
          ),
        )}
      </ul>
      <BulkActionBar {...bulkActionBarFixtures.floating} />
    </div>
  )
}

export const bulkActionBarEntry: GalleryEntry = {
  id: 'bulk-action-bar',
  title: 'BulkActionBar',
  importPath: '@open-mercato/ui/blocks/bulk-action-bar',
  contract: {
    schema: bulkActionBarPropsSchema,
    importPath: '@open-mercato/ui/blocks/contracts/bulk-action-bar',
    implementationPath: '@open-mercato/ui/blocks/bulk-action-bar/BulkActionBar',
  },
  descriptionKey: 'design_system.entries.bulk-action-bar.description',
  keywords: ['selection', 'bulk', 'batch', 'toolbar', 'multi-select', 'actions'],
  usage: {
    do: [
      'Keep the selection in the host and pass selectedCount; the bar hides itself at zero',
      'Return a promise from onAction so the bar shows the pending state for you',
      'Pass totalCount and onSelectAllMatching when the list has more matching records than the current page',
      'Use position="inline" inside dialogs, drawers and panels',
      'Give disabled actions a disabledReason',
    ],
    dont: [
      'Do not run the bulk operation inside the block',
      'Do not skip the confirmation for destructive actions in onAction',
      'Do not render two floating bars on one page',
    ],
  },
  accessibility: [
    'The bar is a toolbar with an accessible label and never takes focus when it appears',
    'The selection count is announced through a polite live region when it changes',
    'Escape clears the selection unless focus is in a text field or a menu or dialog is open; turn it off with clearOnEscape={false}',
    'A disabled action stays focusable and exposes its reason as its description',
    'The entrance animation is skipped when reduced motion is requested',
  ],
  variants: [
    {
      id: 'default',
      title: 'Default',
      render: () => <BulkActionBar {...bulkActionBarFixtures.default} />,
      code: bulkActionBarCode(`  selectedCount={selectedIds.length}
  actions={[
    { key: 'assign-owner', label: 'Assign owner', icon: 'user-round' },
    { key: 'change-stage', label: 'Change stage', icon: 'workflow' },
    { key: 'export', label: 'Export', icon: 'download' },
  ]}
  onAction={handleBulkAction}
  onClear={() => setSelectedIds([])}`),
    },
    {
      id: 'with-overflow',
      title: 'With overflow',
      description: 'Three actions stay visible; the rest and every destructive action move to the menu.',
      render: () => <BulkActionBar {...bulkActionBarFixtures.withOverflow} />,
      code: bulkActionBarCode(`  selectedCount={selectedIds.length}
  actions={[
    { key: 'assign-owner', label: 'Assign owner', icon: 'user-round' },
    { key: 'change-stage', label: 'Change stage', icon: 'workflow' },
    { key: 'export', label: 'Export', icon: 'download' },
    { key: 'add-tag', label: 'Add tag', icon: 'tag' },
    { key: 'delete', label: 'Delete', icon: 'trash-2', tone: 'destructive' },
  ]}
  maxVisibleActions={3}
  onAction={handleBulkAction}
  onClear={clearSelection}`),
    },
    {
      id: 'with-summary',
      title: 'With summary',
      render: () => <BulkActionBar {...bulkActionBarFixtures.withSummary} />,
      code: bulkActionBarCode(`  selectedCount={selectedIds.length}
  summary={t(keys.bulkTotal, 'Total {amount}', { amount: formatMoney(selectedTotal) })}
  actions={bulkActions}
  onAction={handleBulkAction}
  onClear={clearSelection}`),
    },
    {
      id: 'select-all-matching',
      title: 'Select all matching',
      description: 'The page is selected and more records match the current filters.',
      render: () => <BulkActionBar {...bulkActionBarFixtures.selectAllMatching} />,
      code: bulkActionBarCode(`  selectedCount={selectedIds.length}
  totalCount={total}
  allMatchingSelected={allMatching}
  onSelectAllMatching={() => setAllMatching(true)}
  actions={bulkActions}
  onAction={handleBulkAction}
  onClear={clearSelection}`),
    },
    {
      id: 'all-matching-selected',
      title: 'All matching selected',
      description: 'After the prompt is accepted the count names the whole matching set.',
      render: () => <BulkActionBar {...bulkActionBarFixtures.allMatchingSelected} />,
      code: bulkActionBarCode(`  selectedCount={selectedIds.length}
  totalCount={total}
  allMatchingSelected
  onSelectAllMatching={() => setAllMatching(true)}
  actions={bulkActions}
  onAction={handleBulkAction}
  onClear={clearSelection}`),
    },
    {
      id: 'pending',
      title: 'Action pending',
      description: 'Set by the block while the onAction promise is unresolved, or by the host through pendingActionKey.',
      render: () => <BulkActionBar {...bulkActionBarFixtures.pending} />,
      code: bulkActionBarCode(`  selectedCount={selectedIds.length}
  actions={bulkActions}
  pendingActionKey={runningJob?.actionKey}
  onAction={(actionKey) => runBulkAction(actionKey, selectedIds)}
  onClear={clearSelection}`),
    },
    {
      id: 'progress',
      title: 'Progress',
      render: () => <BulkActionBar {...bulkActionBarFixtures.progress} />,
      code: bulkActionBarCode(`  selectedCount={selectedIds.length}
  actions={bulkActions}
  progress={{ label: t(keys.bulkUpdatingStage, 'Updating stage'), done: job.processed, total: job.total }}
  onAction={handleBulkAction}
  onClear={clearSelection}`),
    },
    {
      id: 'disabled-action',
      title: 'Disabled action',
      render: () => <BulkActionBar {...bulkActionBarFixtures.disabledAction} />,
      code: bulkActionBarCode(`  selectedCount={selectedIds.length}
  actions={[
    {
      key: 'create-report',
      label: 'Create report',
      icon: 'file-text',
      disabled: !sameCustomer,
      disabledReason: sameCustomer ? undefined : t(keys.bulkReportBlocked, 'Select projects of one customer to create a report'),
    },
    { key: 'assign-members', label: 'Assign members', icon: 'users' },
  ]}
  onAction={handleBulkAction}
  onClear={clearSelection}`),
    },
    {
      id: 'single-action',
      title: 'Single action',
      render: () => <BulkActionBar {...bulkActionBarFixtures.singleAction} />,
      code: bulkActionBarCode(`  selectedCount={selectedIds.length}
  actions={[{ key: 'export', label: 'Export', icon: 'download' }]}
  onAction={handleBulkAction}
  onClear={clearSelection}`),
    },
    {
      id: 'floating',
      title: 'Floating',
      description:
        'The default position: fixed at the bottom centre of the viewport while the list scrolls. The preview confines it to a frame.',
      render: () => <FloatingPreview />,
      code: bulkActionBarCode(`  selectedCount={selectedIds.length}
  position="floating"
  actions={[
    { key: 'assign-owner', label: 'Assign owner', icon: 'user-round' },
    { key: 'change-stage', label: 'Change stage', icon: 'workflow' },
    { key: 'delete', label: 'Delete', icon: 'trash-2', tone: 'destructive' },
  ]}
  onAction={handleBulkAction}
  onClear={clearSelection}`),
    },
  ],
}
