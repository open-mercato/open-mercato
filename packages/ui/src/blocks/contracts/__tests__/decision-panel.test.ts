import { decisionPanelPropsSchema } from '../decision-panel'
import { decisionPanelFixtures } from '../../decision-panel/fixtures'

const noop = () => undefined
const approve = { id: 'approve', label: 'Approve', tone: 'primary' }
const reject = { id: 'reject', label: 'Reject', tone: 'destructive' }
const base = { state: 'pending', title: 'Leave request', decisions: [approve, reject], onDecide: noop }

function firstIssue(input: unknown) {
  const result = decisionPanelPropsSchema.safeParse(input)
  return result.success ? null : result.error.issues[0]
}

describe('DecisionPanel contract', () => {
  it('accepts a pending panel with two decisions', () => {
    expect(decisionPanelPropsSchema.safeParse(base).success).toBe(true)
  })

  it('accepts every fixture', () => {
    for (const [name, fixture] of Object.entries(decisionPanelFixtures)) {
      const result = decisionPanelPropsSchema.safeParse(fixture)
      expect({ name, success: result.success }).toEqual({ name, success: true })
    }
  })

  it('accepts a full panel', () => {
    const result = decisionPanelPropsSchema.safeParse({
      ...base,
      description: 'Five days off',
      headingLevel: 2,
      statusLabel: 'Awaiting your sign-off',
      requester: { name: 'Morgan Lee', avatarUrl: '/avatars/morgan.png', note: 'Flights are booked.' },
      requestedAt: '2026-03-10T08:40:00Z',
      highlight: { label: 'Working days', value: '5', caption: '11 days left after this' },
      decisions: [
        approve,
        {
          ...reject,
          icon: 'x',
          commentRequired: true,
          confirm: { title: 'Reject the request?', description: 'The requester is notified.', confirmLabel: 'Reject request' },
        },
        { id: 'later', label: 'Decide later', tone: 'neutral', disabled: true, disabledReason: 'Not available yet' },
      ],
      submittingDecisionId: 'approve',
      commentMode: 'optional',
      commentLabel: 'Note',
      commentPlaceholder: 'Add a note',
      commentRequiredMessage: 'Say why',
      comment: 'Fine by me',
      onCommentChange: noop,
      disabledReason: 'Only managers can decide',
      variant: 'plain',
      layout: 'stacked',
    })
    expect(result.success).toBe(true)
  })

  it('requires state and title and rejects unknown states', () => {
    expect(decisionPanelPropsSchema.safeParse({ ...base, state: undefined }).success).toBe(false)
    expect(decisionPanelPropsSchema.safeParse({ ...base, title: '' }).success).toBe(false)
    expect(decisionPanelPropsSchema.safeParse({ ...base, state: 'approved' }).success).toBe(false)
  })

  it('rejects duplicate decision ids', () => {
    const issue = firstIssue({ ...base, decisions: [approve, { ...reject, id: 'approve' }] })
    expect(issue?.message).toBe('Decision ids must be unique')
    expect(issue?.path).toEqual(['decisions'])
  })

  it('rejects more than four decisions', () => {
    const decisions = ['one', 'two', 'three', 'four', 'five'].map((id) => ({ id, label: id }))
    expect(decisionPanelPropsSchema.safeParse({ ...base, decisions }).success).toBe(false)
  })

  it('rejects a pending panel without decisions unless it is loading, failed or empty', () => {
    const issue = firstIssue({ state: 'pending', title: 'Leave request' })
    expect(issue?.message).toBe('A pending or submitting panel needs at least one decision')
    for (const status of ['loading', 'error', 'empty']) {
      expect(decisionPanelPropsSchema.safeParse({ state: 'pending', title: 'Leave request', status }).success).toBe(true)
    }
  })

  it('rejects decisions without onDecide while a decision can still be made', () => {
    const issue = firstIssue({ ...base, onDecide: undefined })
    expect(issue?.message).toBe('decisions require onDecide')
    expect(issue?.path).toEqual(['onDecide'])
  })

  it('requires the outcome in the decided state and allows it without decisions', () => {
    const issue = firstIssue({ state: 'decided', title: 'Leave request' })
    expect(issue?.message).toBe('state decided requires decided')
    expect(
      decisionPanelPropsSchema.safeParse({
        state: 'decided',
        title: 'Leave request',
        decided: { label: 'Approved', tone: 'success', by: 'Dana Reyes', at: '2026-03-12T10:15:00Z', comment: 'Fine' },
      }).success,
    ).toBe(true)
  })

  it('rejects an outcome time that is not an ISO date time', () => {
    const result = decisionPanelPropsSchema.safeParse({
      state: 'decided',
      title: 'Leave request',
      decided: { label: 'Approved', at: 'yesterday' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects a requester without a name, a request time that is not ISO and an incomplete highlight', () => {
    expect(decisionPanelPropsSchema.safeParse({ ...base, requester: { name: '' } }).success).toBe(false)
    expect(decisionPanelPropsSchema.safeParse({ ...base, requestedAt: '2 days ago' }).success).toBe(false)
    expect(decisionPanelPropsSchema.safeParse({ ...base, highlight: { label: 'Amount' } }).success).toBe(false)
    expect(decisionPanelPropsSchema.safeParse({ ...base, statusLabel: '' }).success).toBe(false)
  })

  it('rejects a submittingDecisionId that matches no decision', () => {
    const issue = firstIssue({ ...base, submittingDecisionId: 'escalate' })
    expect(issue?.path).toEqual(['submittingDecisionId'])
  })

  it('rejects a decision that needs a comment when the comment field is off', () => {
    const issue = firstIssue({ ...base, commentMode: 'none', decisions: [approve, { ...reject, commentRequired: true }] })
    expect(issue?.message).toBe('A decision with commentRequired needs a comment field')
  })

  it('rejects a controlled comment without onCommentChange', () => {
    const issue = firstIssue({ ...base, comment: 'Fine' })
    expect(issue?.path).toEqual(['onCommentChange'])
  })

  it('rejects undoLabel without onUndo', () => {
    const issue = firstIssue({ state: 'decided', title: 'Leave request', decided: { label: 'Approved' }, undoLabel: 'Reopen' })
    expect(issue?.path).toEqual(['onUndo'])
  })

  it('rejects a disabledReason on an enabled decision', () => {
    const issue = firstIssue({ ...base, decisions: [{ ...approve, disabledReason: 'Not allowed' }] })
    expect(issue?.message).toBe('disabledReason requires disabled: true')
  })

  it('rejects icon names that are not kebab-case and non-function callbacks', () => {
    expect(decisionPanelPropsSchema.safeParse({ ...base, decisions: [{ ...approve, icon: 'CheckCircle' }] }).success).toBe(false)
    expect(decisionPanelPropsSchema.safeParse({ ...base, onDecide: 'approve' }).success).toBe(false)
  })

  it('marks callbacks as events and slots as slots', () => {
    const shape = decisionPanelPropsSchema.shape
    expect(shape.onDecide.unwrap().meta()).toEqual({ kind: 'event' })
    expect(shape.onUndo.unwrap().meta()).toEqual({ kind: 'event' })
    expect(shape.children.unwrap().meta()).toEqual({ kind: 'slot' })
    expect(shape.footer.unwrap().meta()).toEqual({ kind: 'slot' })
  })

  it('rejects facts that share a key', () => {
    const fact = { key: 'vendor', label: 'Vendor', value: 'Alder Lane Events' }
    expect(decisionPanelPropsSchema.safeParse({ ...decisionPanelFixtures.spendRequest, facts: [fact] }).success).toBe(true)
    expect(decisionPanelPropsSchema.safeParse({ ...decisionPanelFixtures.spendRequest, facts: [fact, fact] }).success).toBe(false)
  })
})
