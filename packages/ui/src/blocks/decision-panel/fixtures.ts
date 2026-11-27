import type { Decision, DecisionPanelProps } from '../contracts/decision-panel'

const noop = () => undefined

const approve: Decision = { id: 'approve', label: 'Approve', tone: 'primary', icon: 'check' }
const reject: Decision = { id: 'reject', label: 'Reject', tone: 'destructive', icon: 'x' }
const requestChanges: Decision = {
  id: 'request-changes',
  label: 'Request changes',
  tone: 'neutral',
  icon: 'pencil-line',
  commentRequired: true,
}

const leaveRequest = {
  title: 'Leave request',
  description: 'Five days off, 16 to 20 March.',
  requester: { name: 'Morgan Lee' },
  requestedAt: '2026-03-10T08:40:00Z',
}

const spendRequest = {
  title: 'Spend request',
  requester: { name: 'Priya Nair', note: 'The venue holds the booking until Friday.' },
  requestedAt: '2026-03-11T14:05:00Z',
  highlight: { label: 'Amount', value: '4,850.00 EUR', caption: '520.00 EUR over budget', captionTone: 'error' as const },
  facts: [
    { key: 'purpose', label: 'For', value: 'Team offsite venue, 2 days' },
    { key: 'vendor', label: 'Vendor', value: 'Alder Lane Events' },
    { key: 'cost-centre', label: 'Cost centre', value: 'Product, 4410' },
    { key: 'budget-left', label: 'Budget left', value: '4,330.00 EUR' },
  ],
}

export const decisionPanelFixtures: Record<string, DecisionPanelProps> = {
  spendRequest: {
    ...spendRequest,
    state: 'pending',
    decisions: [approve, requestChanges, { ...reject, commentRequired: true }],
    commentPlaceholder: 'Add a note for the requester',
    onDecide: noop,
  },
  approveReject: {
    ...leaveRequest,
    state: 'pending',
    decisions: [approve, reject],
    commentPlaceholder: 'Add a note for the requester',
    onDecide: noop,
  },
  commentRequiredForReject: {
    ...leaveRequest,
    state: 'pending',
    decisions: [approve, { ...reject, commentRequired: true }],
    onDecide: noop,
  },
  threeDecisions: {
    title: 'Purchase order 1042',
    description: 'Office chairs for the harbour branch, 12 pieces.',
    requester: { name: 'Tomas Berg' },
    requestedAt: '2026-03-11T09:20:00Z',
    state: 'pending',
    decisions: [approve, requestChanges, { ...reject, commentRequired: true }],
    onDecide: noop,
  },
  submitting: {
    ...leaveRequest,
    state: 'submitting',
    submittingDecisionId: 'approve',
    decisions: [approve, reject],
    comment: 'Enjoy the time off.',
    onCommentChange: noop,
    onDecide: noop,
  },
  decidedApproved: {
    ...leaveRequest,
    state: 'decided',
    decisions: [approve, reject],
    decided: { decisionId: 'approve', label: 'Approved', by: 'Dana Reyes', at: '2026-03-12T10:15:00Z' },
  },
  decidedRejected: {
    ...leaveRequest,
    state: 'decided',
    decisions: [approve, reject],
    decided: {
      decisionId: 'reject',
      label: 'Rejected',
      by: 'Dana Reyes',
      at: '2026-03-12T10:15:00Z',
      comment: 'The team is already short that week. Please pick another date.',
    },
    onUndo: noop,
    undoLabel: 'Reopen request',
  },
  failed: {
    ...leaveRequest,
    state: 'pending',
    decisions: [approve, reject],
    errorMessage: 'Could not record the decision. The connection was lost.',
    onDecide: noop,
  },
  viewerMayNotDecide: {
    ...leaveRequest,
    state: 'pending',
    decisions: [approve, reject],
    disabledReason: 'Only the team manager can decide on this request.',
    onDecide: noop,
  },
  destructiveConfirm: {
    title: 'Supplier contract',
    description: 'Alder Lane Supplies, renewal for twelve months.',
    requester: { name: 'Ines Carvalho' },
    requestedAt: '2026-03-09T11:30:00Z',
    state: 'pending',
    commentMode: 'none',
    decisions: [
      { id: 'renew', label: 'Renew', tone: 'primary', icon: 'check' },
      {
        id: 'terminate',
        label: 'Terminate',
        tone: 'destructive',
        icon: 'ban',
        confirm: {
          title: 'Terminate the contract?',
          description: 'The supplier is notified right away. This cannot be undone.',
          confirmLabel: 'Terminate contract',
        },
      },
    ],
    onDecide: noop,
  },
  decisionDisabled: {
    ...leaveRequest,
    state: 'pending',
    decisions: [
      { ...approve, disabled: true, disabledReason: 'Approval needs a remaining leave balance of five days.' },
      reject,
    ],
    onDecide: noop,
  },
  plain: {
    ...leaveRequest,
    state: 'pending',
    variant: 'plain',
    decisions: [approve, reject],
    onDecide: noop,
  },
  stacked: {
    ...leaveRequest,
    state: 'pending',
    layout: 'stacked',
    decisions: [approve, requestChanges, reject],
    onDecide: noop,
  },
  loading: { title: 'Leave request', state: 'pending', status: 'loading' },
  error: { title: 'Leave request', state: 'pending', status: 'error', errorMessage: 'Could not load the request', onRetry: noop },
  empty: { title: 'Leave request', state: 'pending', status: 'empty' },
}
