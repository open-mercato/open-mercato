import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DecisionPanel } from '../DecisionPanel'
import { decisionPanelFixtures } from '../fixtures'
import { decisionPanelPropsSchema, type DecisionPanelProps } from '../../contracts/decision-panel'

function renderPanel(props: DecisionPanelProps) {
  return renderWithProviders(<DecisionPanel {...props} />)
}

function slot(name: string) {
  return document.querySelector(`[data-slot="${name}"]`) as HTMLElement | null
}

function decisionButton(id: string) {
  return document.querySelector(`[data-slot="decision-panel-decision"][data-decision-id="${id}"]`) as HTMLButtonElement
}

function commentField() {
  return screen.getByRole('textbox') as HTMLTextAreaElement
}

function deferred() {
  let resolve: () => void = () => undefined
  let reject: (reason: Error) => void = () => undefined
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const base = decisionPanelFixtures.approveReject

describe('DecisionPanel', () => {
  it('renders the title, description, labelled comment field and decisions with the primary last', () => {
    renderPanel(base)
    const root = slot('decision-panel') as HTMLElement
    expect(root.tagName).toBe('SECTION')
    expect(screen.getByRole('region', { name: 'Leave request' })).toBe(root)
    expect(screen.getByRole('heading', { level: 3, name: 'Leave request' })).toBeTruthy()
    expect(slot('decision-panel-description')?.textContent).toContain('Five days off')
    expect(screen.getByLabelText(/Comment/)).toBe(commentField())
    const buttons = Array.from(document.querySelectorAll('[data-slot="decision-panel-decision"]'))
    expect(buttons.map((button) => button.getAttribute('data-decision-id'))).toEqual(['reject', 'approve'])
    expect(decisionButton('approve').className).toContain('bg-primary')
    expect(decisionButton('reject').className).toContain('border-destructive')
    expect(decisionButton('reject').className).not.toContain('bg-status-error-solid')
  })

  it('passes the trimmed comment to onDecide and omits an empty one', () => {
    const onDecide = jest.fn()
    renderPanel({ ...base, onDecide })
    fireEvent.click(decisionButton('approve'))
    expect(onDecide).toHaveBeenLastCalledWith('approve', undefined)
    fireEvent.change(commentField(), { target: { value: '  Enjoy  ' } })
    fireEvent.click(decisionButton('reject'))
    expect(onDecide).toHaveBeenLastCalledWith('reject', 'Enjoy')
  })

  it('reports comment changes in controlled mode and shows the host value', () => {
    const onCommentChange = jest.fn()
    renderPanel({ ...base, comment: 'Draft', onCommentChange })
    expect(commentField().value).toBe('Draft')
    fireEvent.change(commentField(), { target: { value: 'Draft two' } })
    expect(onCommentChange).toHaveBeenCalledWith('Draft two')
    expect(commentField().value).toBe('Draft')
  })

  it('blocks a decision that needs a comment and ties the message to the field', () => {
    const onDecide = jest.fn()
    renderPanel({ ...decisionPanelFixtures.commentRequiredForReject, onDecide })
    expect(slot('decision-panel-comment-hint')?.textContent).toBe('Required for: Reject')
    fireEvent.click(decisionButton('reject'))
    expect(onDecide).not.toHaveBeenCalled()
    const message = slot('decision-panel-comment-error') as HTMLElement
    expect(message.getAttribute('role')).toBe('alert')
    expect(commentField().getAttribute('aria-invalid')).toBe('true')
    expect(commentField().getAttribute('aria-describedby')?.split(' ')).toContain(message.id)
    expect(document.activeElement).toBe(commentField())
    fireEvent.change(commentField(), { target: { value: 'Too many absences' } })
    expect(slot('decision-panel-comment-error')).toBeNull()
    fireEvent.click(decisionButton('reject'))
    expect(onDecide).toHaveBeenCalledWith('reject', 'Too many absences')
  })

  it('lets a decision without the requirement through with an empty comment', () => {
    const onDecide = jest.fn()
    renderPanel({ ...decisionPanelFixtures.commentRequiredForReject, onDecide })
    fireEvent.click(decisionButton('approve'))
    expect(onDecide).toHaveBeenCalledWith('approve', undefined)
  })

  it('requires a comment for every decision in required mode', () => {
    const onDecide = jest.fn()
    renderPanel({ ...base, commentMode: 'required', commentRequiredMessage: 'Say why', onDecide })
    expect(commentField().getAttribute('aria-required')).toBe('true')
    fireEvent.click(decisionButton('approve'))
    expect(onDecide).not.toHaveBeenCalled()
    expect(slot('decision-panel-comment-error')?.textContent).toBe('Say why')
  })

  it('hides the comment field in none mode', () => {
    renderPanel({ ...base, commentMode: 'none' })
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('submits the primary decision on Ctrl+Enter and Cmd+Enter in the comment field', () => {
    const onDecide = jest.fn()
    renderPanel({ ...base, onDecide })
    fireEvent.change(commentField(), { target: { value: 'Fine' } })
    fireEvent.keyDown(commentField(), { key: 'Enter' })
    expect(onDecide).not.toHaveBeenCalled()
    fireEvent.keyDown(commentField(), { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(commentField(), { key: 'Enter', metaKey: true })
    expect(onDecide.mock.calls).toEqual([
      ['approve', 'Fine'],
      ['approve', 'Fine'],
    ])
  })

  it('ignores the shortcut when no decision is primary', () => {
    const onDecide = jest.fn()
    renderPanel({ ...base, decisions: [{ id: 'reject', label: 'Reject', tone: 'destructive' }], onDecide })
    fireEvent.keyDown(commentField(), { key: 'Enter', ctrlKey: true })
    expect(onDecide).not.toHaveBeenCalled()
  })

  it('owns the pending state while the returned promise is unresolved', async () => {
    const pending = deferred()
    const onDecide = jest.fn(() => pending.promise)
    renderPanel({ ...base, onDecide })
    fireEvent.click(decisionButton('approve'))
    expect(slot('decision-panel')?.getAttribute('data-state')).toBe('submitting')
    expect(slot('decision-panel')?.getAttribute('aria-busy')).toBe('true')
    expect(decisionButton('approve').getAttribute('aria-busy')).toBe('true')
    expect(decisionButton('approve').querySelector('[data-slot="decision-panel-pending-icon"]')).not.toBeNull()
    expect(decisionButton('reject').getAttribute('aria-disabled')).toBe('true')
    expect(commentField().readOnly).toBe(true)
    expect(slot('decision-panel-status')?.textContent).toBe('Submitting: Approve')
    fireEvent.click(decisionButton('reject'))
    fireEvent.click(decisionButton('approve'))
    expect(onDecide).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    expect(slot('decision-panel')?.getAttribute('data-state')).toBe('pending')
    expect(decisionButton('reject').getAttribute('aria-disabled')).toBeNull()
  })

  it('shows a default alert and enables the buttons again when the promise rejects', async () => {
    const pending = deferred()
    renderPanel({ ...base, onDecide: () => pending.promise })
    fireEvent.click(decisionButton('approve'))
    await act(async () => {
      pending.reject(new Error('[internal] offline'))
      await pending.promise.catch(() => undefined)
    })
    await waitFor(() => expect(slot('decision-panel-error')).not.toBeNull())
    expect(slot('decision-panel-error')?.getAttribute('role')).toBe('alert')
    expect(slot('decision-panel-error')?.textContent).toBe('Could not record the decision')
    expect(decisionButton('approve').getAttribute('aria-disabled')).toBeNull()
  })

  it('shows the host submit error as an alert with the buttons enabled', () => {
    renderPanel(decisionPanelFixtures.failed)
    expect(screen.getByRole('alert').textContent).toContain('The connection was lost')
    expect(decisionButton('approve').getAttribute('aria-disabled')).toBeNull()
    expect(decisionButton('approve').disabled).toBe(false)
  })

  it('renders the host-controlled submitting state', () => {
    const onDecide = jest.fn()
    renderPanel({ ...decisionPanelFixtures.submitting, onDecide })
    expect(decisionButton('approve').getAttribute('aria-busy')).toBe('true')
    expect(decisionButton('reject').getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(decisionButton('reject'))
    expect(onDecide).not.toHaveBeenCalled()
    expect(slot('decision-panel-error')).toBeNull()
  })

  it('replaces the buttons and the comment field with the reason when the viewer may not decide', () => {
    renderPanel(decisionPanelFixtures.viewerMayNotDecide)
    const reason = slot('decision-panel-reason') as HTMLElement
    expect(reason.textContent).toBe('Only the team manager can decide on this request.')
    expect(slot('decision-panel-bar')?.contains(reason)).toBe(true)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(slot('decision-panel-chip')?.textContent).toBe('Awaiting approval')
    expect(slot('decision-panel-chip')?.getAttribute('data-tone')).toBe('neutral')
  })

  it('states whose move it is in the header chip and accepts a custom label', () => {
    const { unmount } = renderPanel(base)
    expect(slot('decision-panel-chip')?.textContent).toBe('Awaiting your decision')
    expect(slot('decision-panel-chip')?.getAttribute('data-tone')).toBe('info')
    unmount()
    renderPanel({ ...base, statusLabel: 'Awaiting your sign-off' })
    expect(slot('decision-panel-chip')?.textContent).toBe('Awaiting your sign-off')
  })

  it('shows the requester with the request time and the note', () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    renderPanel({ ...decisionPanelFixtures.spendRequest, requestedAt: recent })
    const line = slot('decision-panel-requester') as HTMLElement
    expect(slot('decision-panel-requester-name')?.textContent).toBe('Priya Nair')
    expect(line.querySelector('p')?.textContent).toBe('Priya Nair requested 2 days ago')
    const time = line.querySelector('time') as HTMLTimeElement
    expect(time.getAttribute('datetime')).toBe(recent)
    expect(time.getAttribute('title')).toBeTruthy()
    expect(slot('decision-panel-requester-note')?.textContent).toBe('The venue holds the booking until Friday.')
  })

  it('shows the request time alone and leaves the line out without requester data', () => {
    const { unmount } = renderPanel({ ...base, requester: undefined, requestedAt: '2024-03-10T08:40:00Z' })
    expect(slot('decision-panel-requester')?.textContent).toContain('Requested')
    expect(slot('decision-panel-requester')?.textContent).toContain('2024')
    unmount()
    renderPanel({ ...base, requester: undefined, requestedAt: undefined })
    expect(slot('decision-panel-requester')).toBeNull()
  })

  it('shows the highlight as label, large value and caption', () => {
    renderPanel(decisionPanelFixtures.spendRequest)
    const highlight = slot('decision-panel-highlight') as HTMLElement
    expect(highlight.querySelector('dt')?.textContent).toBe('Amount')
    expect(slot('decision-panel-highlight-value')?.textContent).toBe('4,850.00 EUR')
    expect(slot('decision-panel-highlight-caption')?.textContent).toBe('520.00 EUR over budget')
    expect(slot('decision-panel-highlight-caption')?.getAttribute('data-tone')).toBe('error')
  })

  it('lists facts as label and value rows under the highlight', () => {
    renderPanel(decisionPanelFixtures.spendRequest)
    const rows = Array.from(document.querySelectorAll('[data-slot="decision-panel-fact"]'))
    expect(rows).toHaveLength(4)
    expect(rows[1].querySelector('dt')?.textContent).toBe('Vendor')
    expect(rows[1].querySelector('dd')?.textContent).toBe('Alder Lane Events')
  })

  it('shows the shortcut hint only when the comment field can run the primary decision', () => {
    const { unmount } = renderPanel(base)
    expect(slot('decision-panel-shortcut')?.textContent).toBe('Approve with Ctrl+Enter')
    unmount()
    renderPanel({ ...base, commentMode: 'none' })
    expect(slot('decision-panel-shortcut')).toBeNull()
  })

  it('keeps the decisions in a bar after the body', () => {
    renderPanel(base)
    const bar = slot('decision-panel-bar') as HTMLElement
    expect(bar.className).toContain('border-t')
    expect(bar.contains(slot('decision-panel-decisions'))).toBe(true)
    expect(slot('decision-panel-body')?.contains(bar)).toBe(false)
  })

  it('keeps a decision with a reason focusable and describes it by the visible reason', () => {
    const onDecide = jest.fn()
    renderPanel({ ...decisionPanelFixtures.decisionDisabled, onDecide })
    const button = decisionButton('approve')
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    const reasonId = button.getAttribute('aria-describedby') as string
    expect(document.getElementById(reasonId)?.textContent).toContain('remaining leave balance')
    fireEvent.click(button)
    expect(onDecide).not.toHaveBeenCalled()
  })

  it('disables a decision natively when no reason is given', () => {
    renderPanel({ ...base, decisions: [{ id: 'approve', label: 'Approve', tone: 'primary', disabled: true }] })
    expect(decisionButton('approve').disabled).toBe(true)
  })

  it('asks for confirmation inline before a decision that carries confirm', () => {
    const onDecide = jest.fn()
    renderPanel({ ...decisionPanelFixtures.destructiveConfirm, onDecide })
    decisionButton('terminate').focus()
    fireEvent.click(decisionButton('terminate'))
    expect(onDecide).not.toHaveBeenCalled()
    const confirm = slot('decision-panel-confirm') as HTMLElement
    expect(screen.getByRole('group', { name: 'Terminate the contract?' })).toBe(confirm)
    expect(slot('decision-panel-decisions')).toBeNull()
    const accept = slot('decision-panel-confirm-accept') as HTMLElement
    expect(accept.textContent).toBe('Terminate contract')
    expect(accept.className).toContain('bg-status-error-solid')
    expect(document.activeElement).toBe(slot('decision-panel-confirm-cancel'))
    expect(slot('decision-panel-bar')?.contains(confirm)).toBe(true)
    expect(confirm.querySelectorAll('button')[1]).toBe(accept)
    fireEvent.click(accept)
    expect(onDecide).toHaveBeenCalledWith('terminate', undefined)
    expect(slot('decision-panel-confirm')).toBeNull()
  })

  it('cancels the confirmation with Escape and returns focus to the decision', () => {
    const onDecide = jest.fn()
    renderPanel({ ...decisionPanelFixtures.destructiveConfirm, onDecide })
    decisionButton('terminate').focus()
    fireEvent.click(decisionButton('terminate'))
    fireEvent.keyDown(slot('decision-panel-confirm-cancel') as HTMLElement, { key: 'Escape' })
    expect(slot('decision-panel-confirm')).toBeNull()
    expect(onDecide).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(decisionButton('terminate'))
  })

  it('confirms with Ctrl+Enter inside the confirmation', () => {
    const onDecide = jest.fn()
    renderPanel({ ...decisionPanelFixtures.destructiveConfirm, onDecide })
    fireEvent.click(decisionButton('terminate'))
    fireEvent.keyDown(slot('decision-panel-confirm-accept') as HTMLElement, { key: 'Enter', ctrlKey: true })
    expect(onDecide).toHaveBeenCalledWith('terminate', undefined)
  })

  it('checks the comment before it asks for confirmation', () => {
    const onDecide = jest.fn()
    renderPanel({
      ...base,
      decisions: [{ id: 'reject', label: 'Reject', tone: 'destructive', commentRequired: true, confirm: { title: 'Reject?' } }],
      onDecide,
    })
    fireEvent.click(decisionButton('reject'))
    expect(slot('decision-panel-confirm')).toBeNull()
    expect(slot('decision-panel-comment-error')).not.toBeNull()
  })

  it('shows the outcome as a tinted banner with one sentence, time and comment, and no decision controls', () => {
    renderPanel(decisionPanelFixtures.decidedRejected)
    const outcome = slot('decision-panel-outcome') as HTMLElement
    expect(outcome.getAttribute('data-tone')).toBe('error')
    expect(outcome.className).toContain('bg-status-error-bg')
    expect(slot('decision-panel-outcome-sentence')?.textContent).toBe('Rejected by Dana Reyes')
    expect(outcome.querySelector('dl')).toBeNull()
    expect(slot('decision-panel-chip')).toBeNull()
    expect(slot('decision-panel-requester')?.textContent).toContain('Morgan Lee')
    expect(slot('decision-panel-bar')).toBeNull()
    expect(outcome.contains(slot('decision-panel-undo'))).toBe(true)
    const time = outcome.querySelector('time') as HTMLTimeElement
    expect(time.getAttribute('datetime')).toBe('2026-03-12T10:15:00Z')
    expect(time.textContent?.length).toBeGreaterThan(0)
    expect(slot('decision-panel-outcome-comment')?.textContent).toContain('short that week')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(slot('decision-panel-decisions')).toBeNull()
    expect(slot('decision-panel-status')?.textContent).toBe('Decision recorded: Rejected')
  })

  it('shows a recent decision as relative time with the full date as a title, and an old one as a date', () => {
    const recent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const { unmount } = renderPanel({ state: 'decided', title: 'Leave request', decided: { label: 'Approved', at: recent } })
    const recentTime = document.querySelector('time') as HTMLTimeElement
    expect(recentTime.textContent).toBe('2 hours ago')
    expect(recentTime.getAttribute('title')).toBeTruthy()
    unmount()
    renderPanel({ state: 'decided', title: 'Leave request', decided: { label: 'Approved', at: '2024-03-12T10:15:00Z' } })
    const oldTime = document.querySelector('time') as HTMLTimeElement
    expect(oldTime.textContent).toContain('2024')
    expect(oldTime.textContent).not.toContain(':')
    expect(oldTime.getAttribute('title')).toContain('2024')
  })

  it('derives the outcome tone from the decision and lets the host override it', () => {
    const { unmount } = renderPanel(decisionPanelFixtures.decidedApproved)
    expect(slot('decision-panel-outcome')?.getAttribute('data-tone')).toBe('success')
    unmount()
    renderPanel({ state: 'decided', title: 'Leave request', decided: { label: 'Escalated', tone: 'warning' } })
    expect(slot('decision-panel-outcome')?.getAttribute('data-tone')).toBe('warning')
    expect(slot('decision-panel-outcome-sentence')?.textContent).toBe('Escalated')
  })

  it('offers undo only with onUndo and uses the given label', () => {
    const onUndo = jest.fn()
    const { unmount } = renderPanel({ ...decisionPanelFixtures.decidedRejected, onUndo })
    fireEvent.click(screen.getByRole('button', { name: 'Reopen request' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    unmount()
    renderPanel(decisionPanelFixtures.decidedApproved)
    expect(slot('decision-panel-undo')).toBeNull()
  })

  it('moves focus to the outcome when the decision is recorded while focus is inside', () => {
    function Host() {
      const [decided, setDecided] = React.useState(false)
      return (
        <DecisionPanel
          {...base}
          state={decided ? 'decided' : 'pending'}
          decided={decided ? { decisionId: 'approve', label: 'Approved' } : undefined}
          onDecide={() => setDecided(true)}
          onUndo={() => setDecided(false)}
        />
      )
    }
    renderWithProviders(<Host />)
    decisionButton('approve').focus()
    fireEvent.click(decisionButton('approve'))
    expect(document.activeElement).toBe(slot('decision-panel-outcome'))
    const undo = slot('decision-panel-undo') as HTMLElement
    undo.focus()
    fireEvent.click(undo)
    expect(document.activeElement).toBe(commentField())
  })

  it('renders children and footer slots', () => {
    renderPanel({ ...base, children: <p>Five days, 16 to 20 March</p>, footer: <span>Decisions are logged</span> })
    expect(slot('decision-panel-content')?.textContent).toBe('Five days, 16 to 20 March')
    expect(slot('decision-panel-footer')?.textContent).toBe('Decisions are logged')
  })

  it('draws the frame only in the card variant', () => {
    const { unmount } = renderPanel(base)
    expect(slot('decision-panel')?.className).toContain('border-border')
    expect(slot('decision-panel-bar')?.className).toContain('px-4')
    unmount()
    renderPanel(decisionPanelFixtures.plain)
    expect(slot('decision-panel')?.className).not.toContain('border')
    expect(slot('decision-panel-bar')?.className).not.toContain('px-4')
    expect(slot('decision-panel')?.getAttribute('data-variant')).toBe('plain')
  })

  it('uses the requested heading level', () => {
    renderPanel({ ...base, headingLevel: 2 })
    expect(screen.getByRole('heading', { level: 2, name: 'Leave request' })).toBeTruthy()
  })

  it('renders a skeleton while loading', () => {
    renderPanel(decisionPanelFixtures.loading)
    expect(slot('decision-panel')?.getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders the load error with retry', () => {
    const onRetry = jest.fn()
    renderPanel({ ...decisionPanelFixtures.error, onRetry })
    expect(screen.getByRole('alert').textContent).toContain('Could not load the request')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders the empty state or the emptyState slot', () => {
    const { unmount } = renderPanel(decisionPanelFixtures.empty)
    expect(screen.getByText('Nothing to decide')).toBeTruthy()
    unmount()
    renderPanel({ ...decisionPanelFixtures.empty, emptyState: <p>All caught up</p> })
    expect(screen.getByText('All caught up')).toBeTruthy()
  })

  it('keeps every fixture valid against the contract', () => {
    for (const fixture of Object.values(decisionPanelFixtures)) {
      expect(decisionPanelPropsSchema.safeParse(fixture).success).toBe(true)
    }
  })
})
