import * as React from 'react'
import { DecisionPanel } from '@open-mercato/ui/blocks/decision-panel'
import { decisionPanelFixtures } from '@open-mercato/ui/blocks/decision-panel/fixtures'
import {
  decisionPanelPropsSchema,
  type DecisionOutcome,
  type DecisionPanelProps,
} from '@open-mercato/ui/blocks/contracts/decision-panel'
import type { GalleryEntry } from '../types'

const SUBMIT_DELAY_MS = 1200

const OUTCOME_LABELS: Record<string, string> = {
  approve: 'Approved',
  reject: 'Rejected',
  'request-changes': 'Changes requested',
  renew: 'Renewed',
  terminate: 'Terminated',
}

function useDecisionDemo() {
  const [outcome, setOutcome] = React.useState<DecisionOutcome | undefined>(undefined)
  const timers = React.useRef<Array<ReturnType<typeof setTimeout>>>([])

  React.useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((timer) => clearTimeout(timer))
  }, [])

  const decide = (decisionId: string, comment?: string) =>
    new Promise<void>((resolve) => {
      timers.current.push(
        setTimeout(() => {
          setOutcome({
            decisionId,
            label: OUTCOME_LABELS[decisionId] ?? decisionId,
            by: 'Dana Reyes',
            at: new Date().toISOString(),
            comment,
          })
          resolve()
        }, SUBMIT_DELAY_MS),
      )
    })

  return { outcome, decide, undo: () => setOutcome(undefined) }
}

const HOUR_MS = 60 * 60 * 1000

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString()
}

type DemoTimes = { requestedHoursAgo?: number; decidedHoursAgo?: number }

function useDemoFixture(fixture: DecisionPanelProps, times: DemoTimes): DecisionPanelProps {
  const [stamps] = React.useState(() => ({
    requestedAt: times.requestedHoursAgo === undefined ? undefined : hoursAgo(times.requestedHoursAgo),
    decidedAt: times.decidedHoursAgo === undefined ? undefined : hoursAgo(times.decidedHoursAgo),
  }))
  return {
    ...fixture,
    requestedAt: stamps.requestedAt ?? fixture.requestedAt,
    decided: fixture.decided && stamps.decidedAt ? { ...fixture.decided, at: stamps.decidedAt } : fixture.decided,
  }
}

type PanelDemoProps = { fixture: DecisionPanelProps; times?: DemoTimes; children?: React.ReactNode }

const DEFAULT_TIMES: DemoTimes = { requestedHoursAgo: 50 }

function InteractivePanel({ fixture, times = DEFAULT_TIMES, children }: PanelDemoProps) {
  const demo = useDecisionDemo()
  const props = useDemoFixture(fixture, times)
  return (
    <div className="w-full max-w-xl">
      <DecisionPanel
        {...props}
        state={demo.outcome ? 'decided' : 'pending'}
        decided={demo.outcome}
        onDecide={demo.decide}
        onUndo={demo.undo}
      >
        {children}
      </DecisionPanel>
    </div>
  )
}

function StaticPanel({ fixture, times = DEFAULT_TIMES, children }: PanelDemoProps) {
  const props = useDemoFixture(fixture, times)
  return (
    <div className="w-full max-w-xl">
      <DecisionPanel {...props}>{children}</DecisionPanel>
    </div>
  )
}

function NarrowPanel({ fixture, times = DEFAULT_TIMES }: PanelDemoProps) {
  const props = useDemoFixture(fixture, times)
  return (
    <div className="w-full max-w-xs">
      <DecisionPanel {...props} />
    </div>
  )
}

type Detail = { label: string; value: string }

const LEAVE_DETAILS: Detail[] = [
  { label: 'Working days', value: '5' },
  { label: 'Balance after', value: '11 days' },
  { label: 'Cover', value: 'Robin Vale' },
  { label: 'Last leave', value: '4 months ago' },
]

function RequestDetails({ details }: { details: Detail[] }) {
  return (
    <dl className="divide-y divide-border border-y border-border">
      {details.map((detail) => (
        <div key={detail.label} className="grid min-w-0 grid-cols-3 gap-x-4 py-2 text-sm leading-5">
          <dt className="min-w-0 break-words text-muted-foreground">{detail.label}</dt>
          <dd className="col-span-2 min-w-0 break-words text-foreground">{detail.value}</dd>
        </div>
      ))}
    </dl>
  )
}

const decisionPanelCode = (props: string, children?: string) =>
  children
    ? `import { DecisionPanel } from '@open-mercato/ui/blocks/decision-panel'

<DecisionPanel
${props}
>
${children}
</DecisionPanel>`
    : `import { DecisionPanel } from '@open-mercato/ui/blocks/decision-panel'

<DecisionPanel
${props}
/>`

const APPROVE_REJECT_CODE = `  decisions={[
    { id: 'approve', label: 'Approve', tone: 'primary', icon: 'check' },
    { id: 'reject', label: 'Reject', tone: 'destructive', icon: 'x' },
  ]}`

export const decisionPanelEntry: GalleryEntry = {
  id: 'decision-panel',
  title: 'DecisionPanel',
  importPath: '@open-mercato/ui/blocks/decision-panel',
  contract: {
    schema: decisionPanelPropsSchema,
    importPath: '@open-mercato/ui/blocks/contracts/decision-panel',
    implementationPath: '@open-mercato/ui/blocks/decision-panel/DecisionPanel',
  },
  descriptionKey: 'design_system.entries.decision-panel.description',
  keywords: ['approve', 'reject', 'approval', 'review', 'sign off', 'proposal', 'request changes', 'decision comment'],
  usage: {
    do: [
      'Use it wherever a person approves, rejects or otherwise settles one item: a request, a task, an order, a proposed action',
      'Return a promise from onDecide; the panel shows the pending decision and blocks the others until it settles',
      'Switch state to decided and pass decided with the label, the person and the time once the decision is stored',
      'Pass requester and requestedAt so the panel says whose request it is and how long it has waited',
      'Put the one fact the decision turns on into highlight (an amount, a number of days), the supporting facts into facts, and anything richer into children',
      'Mark one decision as primary; it becomes the one solid button at the right of the bar and the target of Cmd/Ctrl+Enter in the comment field',
      'Set commentRequired on the decisions that need a reason, or commentMode="required" when every decision does',
      'Add confirm to a decision that cannot be undone; the panel asks again in place before it calls onDecide',
      'Pass disabledReason when the viewer may not decide; the bar then shows the reason and no buttons',
      'Use variant="plain" inside a card, dialog or drawer that already draws the frame',
    ],
    dont: [
      'Do not offer more than four decisions; group rare ones in the host or split the step',
      'Do not put a bordered card or a filled box into children; the body already groups the item with spacing',
      'Do not repeat the highlight value in the description or in children; each fact appears once',
      'Do not use it for saving a form or for bulk actions on a list; those have their own blocks',
      'Do not repeat the outcome next to the panel; the banner already states the decision, the person, the time and the comment',
      'Do not fetch or mutate inside the panel; the host owns the request and passes the result as state',
    ],
  },
  accessibility: [
    'The panel is a region named by its title; the heading level is set with headingLevel',
    'The header chip states in words whose move it is, and the outcome banner states what was decided; the tint only supports the text',
    'Request and decision times are time elements with the full date and time in the title',
    'The comment field always has a visible label; a missing comment is announced as an alert and tied to the field with aria-describedby and aria-invalid',
    'Cmd/Ctrl+Enter in the comment field runs the primary decision; inside a confirmation it confirms and Escape cancels',
    'While a decision is being submitted the buttons stay focusable with aria-disabled, the active one is marked busy and the progress is announced in a polite live region',
    'A failed submit is announced as an alert and the buttons work again',
    'When the outcome banner replaces the bar, focus moves to the banner; after undo or a cancelled confirmation it returns to the comment field or the decision button',
    'A decision that is disabled with a reason stays focusable and is described by the reason shown next to the buttons',
    'When the viewer may not decide, the bar holds the reason as text and no disabled buttons are left in the tab order',
    'Keyboard order follows the wide layout: secondary decisions, then the primary one. In a narrow panel the buttons are 40 px tall and stack full width with the primary decision on top',
  ],
  faq: [
    {
      question: 'Why does the confirmation appear inside the panel and not in a dialog?',
      answer:
        'Blocks do not import the dialog helpers from the backend layer. The second step keeps the comment in view and needs no focus trap. A host that wants a dialog leaves confirm out and opens its own dialog in onDecide.',
    },
    {
      question: 'Why does the error message replace the whole panel?',
      answer:
        'With status="error" the message means the item could not be loaded. For a failed submit keep status ready and pass only errorMessage; the panel then shows it above the bar.',
    },
    {
      question: 'When do the buttons stack?',
      answer:
        'The panel measures its own width, not the screen. Below 448 px the buttons stack full width with the primary decision on top; layout="stacked" forces that at any width.',
    },
  ],
  tokens: [
    '--card',
    '--border',
    '--radius-card',
    '--muted-foreground',
    '--destructive',
    '--status-error-text',
    '--status-error-icon',
    '--status-error-solid',
    '--status-error-bg',
    '--status-success-bg',
    '--status-success-text',
    '--status-success-icon',
    '--status-info-bg',
    '--status-info-text',
    '--status-neutral-bg',
    '--status-neutral-text',
    '--muted',
    '--bg-disabled',
    '--text-disabled',
  ],
  variants: [
    {
      id: 'spend-request',
      title: 'Spend request with requester and key fact',
      description:
        'The most complete form: the chip says it waits for you, the requester line says who asked and when, the amount is the anchor and the bar holds the decisions. Try the whole flow.',
      render: () => (
        <InteractivePanel fixture={decisionPanelFixtures.spendRequest} times={{ requestedHoursAgo: 46 }} />
      ),
      code: decisionPanelCode(
        `  state={outcome ? 'decided' : 'pending'}
  title="Spend request"
  requester={{ name: request.requester.name, avatarUrl: request.requester.avatarUrl, note: request.note }}
  requestedAt={request.createdAt}
  highlight={{ label: 'Amount', value: formatMoney(request.amount), caption: overBudgetCaption, captionTone: 'error' }}
  facts={[
    { key: 'purpose', label: 'For', value: request.purpose },
    { key: 'vendor', label: 'Vendor', value: request.vendor },
    { key: 'cost-centre', label: 'Cost centre', value: request.costCentre },
    { key: 'budget-left', label: 'Budget left', value: formatMoney(request.budgetLeft) },
  ]}
  decisions={[
    { id: 'approve', label: 'Approve', tone: 'primary', icon: 'check' },
    { id: 'request-changes', label: 'Request changes', icon: 'pencil-line', commentRequired: true },
    { id: 'reject', label: 'Reject', tone: 'destructive', icon: 'x', commentRequired: true },
  ]}
  onDecide={async (decisionId, comment) => {
    setOutcome(await saveDecision(decisionId, comment))
  }}
  decided={outcome}
  onUndo={() => setOutcome(undefined)}`,
      ),
    },
    {
      id: 'interactive',
      title: 'Approve or reject',
      description: 'The smallest useful panel: two decisions and an optional comment.',
      render: () => <InteractivePanel fixture={decisionPanelFixtures.approveReject} />,
      code: decisionPanelCode(`  state={outcome ? 'decided' : 'pending'}
  title="Leave request"
  description="Five days off, 16 to 20 March."
  requester={{ name: 'Morgan Lee' }}
  requestedAt={request.createdAt}
${APPROVE_REJECT_CODE}
  onDecide={async (decisionId, comment) => {
    setOutcome(await saveDecision(decisionId, comment))
  }}
  decided={outcome}
  onUndo={() => setOutcome(undefined)}`),
    },
    {
      id: 'comment-required',
      title: 'Comment required to reject',
      description: 'Reject without a comment to see the inline message. Approve goes through without one.',
      render: () => <InteractivePanel fixture={decisionPanelFixtures.commentRequiredForReject} times={{ requestedHoursAgo: 5 }} />,
      code: decisionPanelCode(`  state="pending"
  title="Leave request"
  decisions={[
    { id: 'approve', label: 'Approve', tone: 'primary', icon: 'check' },
    { id: 'reject', label: 'Reject', tone: 'destructive', icon: 'x', commentRequired: true },
  ]}
  onDecide={decide}`),
    },
    {
      id: 'three-decisions',
      title: 'Three decisions',
      description: 'Secondary decisions come first, the destructive one furthest from the primary, which closes the row at the right.',
      render: () => <InteractivePanel fixture={decisionPanelFixtures.threeDecisions} times={{ requestedHoursAgo: 27 }} />,
      code: decisionPanelCode(`  state="pending"
  title="Purchase order 1042"
  decisions={[
    { id: 'approve', label: 'Approve', tone: 'primary', icon: 'check' },
    { id: 'request-changes', label: 'Request changes', icon: 'pencil-line', commentRequired: true },
    { id: 'reject', label: 'Reject', tone: 'destructive', icon: 'x', commentRequired: true },
  ]}
  onDecide={decide}`),
    },
    {
      id: 'with-content',
      title: 'With the item under decision',
      description: 'Children show the rest of the item. They sit in the body without a box of their own.',
      render: () => (
        <StaticPanel fixture={decisionPanelFixtures.approveReject}>
          <RequestDetails details={LEAVE_DETAILS} />
        </StaticPanel>
      ),
      code: decisionPanelCode(
        `  state="pending"
  title="Leave request"
  description="Five days off, 16 to 20 March."
  requester={{ name: 'Morgan Lee' }}
  requestedAt={request.createdAt}
${APPROVE_REJECT_CODE}
  onDecide={decide}`,
        '  <LeaveRequestSummary request={request} />',
      ),
    },
    {
      id: 'submitting',
      title: 'Submitting',
      description:
        'The chosen button shows the spinner, the others are inert and the comment is read-only. The host can drive this with state and submittingDecisionId when it does not return a promise.',
      render: () => <StaticPanel fixture={decisionPanelFixtures.submitting} />,
      code: decisionPanelCode(`  state="submitting"
  submittingDecisionId="approve"
  title="Leave request"
${APPROVE_REJECT_CODE}
  comment={comment}
  onCommentChange={setComment}
  onDecide={decide}`),
    },
    {
      id: 'decided-approved',
      title: 'Decided: approved',
      description: 'The outcome is one sentence in a tinted banner; the header chip is gone, so the decision is stated once.',
      render: () => <StaticPanel fixture={decisionPanelFixtures.decidedApproved} times={{ requestedHoursAgo: 50, decidedHoursAgo: 3 }} />,
      code: decisionPanelCode(`  state="decided"
  title="Leave request"
  requester={{ name: 'Morgan Lee' }}
  requestedAt={request.createdAt}
  decided={{ decisionId: 'approve', label: 'Approved', by: 'Dana Reyes', at: request.decidedAt }}`),
    },
    {
      id: 'decided-rejected',
      title: 'Decided: rejected with a comment and undo',
      description: 'The tint follows the decision, the comment is quoted under the sentence and onUndo adds the quiet action that reopens the item.',
      render: () => <StaticPanel fixture={decisionPanelFixtures.decidedRejected} times={{ requestedHoursAgo: 50, decidedHoursAgo: 20 }} />,
      code: decisionPanelCode(`  state="decided"
  title="Leave request"
  requester={{ name: 'Morgan Lee' }}
  requestedAt={request.createdAt}
  decided={{
    decisionId: 'reject',
    label: 'Rejected',
    by: 'Dana Reyes',
    at: request.decidedAt,
    comment: request.decisionComment,
  }}
  onUndo={reopen}
  undoLabel="Reopen request"`),
    },
    {
      id: 'failed',
      title: 'Failed submit',
      description: 'The message is announced as an alert above the bar and every decision can be tried again.',
      render: () => <StaticPanel fixture={decisionPanelFixtures.failed} />,
      code: decisionPanelCode(`  state="pending"
  title="Leave request"
${APPROVE_REJECT_CODE}
  errorMessage={t(connectionLostKey)}
  onDecide={decide}`),
    },
    {
      id: 'viewer-may-not-decide',
      title: 'Viewer may not decide',
      description: 'The chip says the request waits for approval, and the bar holds the reason in place of the buttons and the comment field.',
      render: () => <StaticPanel fixture={decisionPanelFixtures.viewerMayNotDecide} />,
      code: decisionPanelCode(`  state="pending"
  title="Leave request"
${APPROVE_REJECT_CODE}
  disabledReason="Only the team manager can decide on this request."
  onDecide={decide}`),
    },
    {
      id: 'destructive-confirm',
      title: 'Destructive decision with confirmation',
      description: 'Terminate asks again inside the bar. Only the confirming button is solid red; Escape cancels.',
      render: () => <InteractivePanel fixture={decisionPanelFixtures.destructiveConfirm} times={{ requestedHoursAgo: 96 }} />,
      code: decisionPanelCode(`  state="pending"
  title="Supplier contract"
  commentMode="none"
  decisions={[
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
  ]}
  onDecide={decide}`),
    },
    {
      id: 'plain',
      title: 'Plain variant',
      description: 'No frame and no padding, for a card, dialog or drawer that already frames the content. The bar keeps its hairline.',
      render: () => <StaticPanel fixture={decisionPanelFixtures.plain} />,
      code: decisionPanelCode(`  variant="plain"
  state="pending"
  title="Leave request"
${APPROVE_REJECT_CODE}
  onDecide={decide}`),
    },
    {
      id: 'stacked-narrow',
      title: 'Stacked in a narrow column',
      description:
        'In a narrow panel the chip wraps under the title and the buttons stack full width with the primary decision on top. layout="stacked" forces the stack at any width.',
      render: () => <NarrowPanel fixture={decisionPanelFixtures.stacked} />,
      code: decisionPanelCode(`  layout="stacked"
  state="pending"
  title="Leave request"
  decisions={[
    { id: 'approve', label: 'Approve', tone: 'primary', icon: 'check' },
    { id: 'request-changes', label: 'Request changes', icon: 'pencil-line', commentRequired: true },
    { id: 'reject', label: 'Reject', tone: 'destructive', icon: 'x' },
  ]}
  onDecide={decide}`),
    },
    {
      id: 'loading',
      title: 'Loading',
      description: 'The skeleton mirrors the header, the key fact, the comment field and the bar.',
      render: () => <StaticPanel fixture={decisionPanelFixtures.loading} />,
      code: decisionPanelCode(`  status="loading"
  state="pending"
  title="Leave request"`),
    },
  ],
}
