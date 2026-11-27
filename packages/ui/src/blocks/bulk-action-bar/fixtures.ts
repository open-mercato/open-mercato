import type { BlockAction } from '../contracts/shared'
import type { BulkActionBarProps } from '../contracts/bulk-action-bar'

const noop = () => undefined

const assignOwner: BlockAction = { key: 'assign-owner', label: 'Assign owner', icon: 'user-round' }
const changeStage: BlockAction = { key: 'change-stage', label: 'Change stage', icon: 'workflow' }
const exportCsv: BlockAction = { key: 'export', label: 'Export', icon: 'download' }
const addTag: BlockAction = { key: 'add-tag', label: 'Add tag', icon: 'tag' }
const remove: BlockAction = { key: 'delete', label: 'Delete', icon: 'trash-2', tone: 'destructive' }

const base = {
  selectedCount: 3,
  position: 'inline',
  onAction: noop,
  onClear: noop,
} satisfies Partial<BulkActionBarProps>

export const bulkActionBarFixtures: Record<string, BulkActionBarProps> = {
  default: { ...base, actions: [assignOwner, changeStage, exportCsv] },
  withOverflow: { ...base, actions: [assignOwner, changeStage, exportCsv, addTag, remove] },
  withSummary: { ...base, summary: 'Total 48,200.00 USD', actions: [assignOwner, changeStage, exportCsv] },
  selectAllMatching: {
    ...base,
    selectedCount: 25,
    totalCount: 128,
    onSelectAllMatching: noop,
    actions: [assignOwner, exportCsv, remove],
  },
  allMatchingSelected: {
    ...base,
    selectedCount: 25,
    totalCount: 128,
    allMatchingSelected: true,
    onSelectAllMatching: noop,
    actions: [assignOwner, exportCsv, remove],
  },
  pending: { ...base, pendingActionKey: 'change-stage', actions: [assignOwner, changeStage, exportCsv] },
  progress: {
    ...base,
    selectedCount: 40,
    progress: { label: 'Updating stage', done: 12, total: 40 },
    actions: [assignOwner, changeStage, exportCsv],
  },
  disabledAction: {
    ...base,
    actions: [
      {
        key: 'create-report',
        label: 'Create report',
        icon: 'file-text',
        disabled: true,
        disabledReason: 'Select projects of one customer to create a report',
      },
      { key: 'assign-members', label: 'Assign members', icon: 'users' },
    ],
  },
  singleAction: { ...base, selectedCount: 1, actions: [exportCsv] },
  destructiveInline: {
    ...base,
    destructivePlacement: 'inline',
    maxVisibleActions: 4,
    actions: [changeStage, assignOwner, exportCsv, remove],
  },
  floating: { ...base, position: 'floating', actions: [assignOwner, changeStage, remove] },
}
