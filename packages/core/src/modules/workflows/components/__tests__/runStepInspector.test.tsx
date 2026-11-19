/**
 * @jest-environment jsdom
 *
 * Per-step I/O inspector (spec §8.3).
 *
 * The load-bearing behaviours: a step that ran more than once shows EVERY
 * attempt (collapsing them hides exactly the execution an operator opened the
 * run to find), and every status reads as a label plus a glyph rather than a
 * colour (§4.6).
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { RunStepInspector } from '../run/RunStepInspector'
import { RunStatusBadge, instanceStatusBadgeClass } from '../run/RunStatusBadge'
import { runEventBadgeClass } from '../run/RunEventBadge'

describe('RunStepInspector', () => {
  it('prompts for a selection when no node is selected', () => {
    renderWithProviders(<RunStepInspector stepId={null} executions={[]} />)
    expect(screen.getByText(/select a step on the canvas/i)).toBeInTheDocument()
  })

  it('says a selected step never executed instead of rendering an empty panel', () => {
    renderWithProviders(<RunStepInspector stepId="charge" stepLabel="Charge card" executions={[]} />)
    expect(screen.getByText('Charge card')).toBeInTheDocument()
    expect(screen.getByText(/has not executed in this run/i)).toBeInTheDocument()
  })

  it('renders input, output, duration and attempts for one execution', () => {
    renderWithProviders(
      <RunStepInspector
        stepId="charge"
        stepLabel="Charge card"
        executions={[
          {
            id: 'si-1',
            stepId: 'charge',
            status: 'COMPLETED',
            inputData: { amount: 100 },
            outputData: { chargeId: 'ch_1' },
            enteredAt: '2026-07-29T10:00:00.000Z',
            exitedAt: '2026-07-29T10:00:02.000Z',
            executionTimeMs: 1234,
            retryCount: 1,
          },
        ]}
      />
    )

    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.getByText('1.2s')).toBeInTheDocument()
    // retryCount 1 means the step ran twice.
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('keeps every execution of a repeated step, newest last', () => {
    renderWithProviders(
      <RunStepInspector
        stepId="charge"
        executions={[
          { id: 'si-1', stepId: 'charge', status: 'FAILED' },
          { id: 'si-2', stepId: 'charge', status: 'COMPLETED' },
        ]}
      />
    )

    expect(screen.getByText('Execution 1')).toBeInTheDocument()
    expect(screen.getByText('Execution 2')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('surfaces the error payload only when the step recorded one', () => {
    const { rerender } = renderWithProviders(
      <RunStepInspector stepId="charge" executions={[{ id: 'si-1', stepId: 'charge', status: 'COMPLETED' }]} />
    )
    expect(screen.queryByText('Error')).not.toBeInTheDocument()

    rerender(
      <RunStepInspector
        stepId="charge"
        executions={[{ id: 'si-1', stepId: 'charge', status: 'FAILED', errorData: { message: 'declined' } }]}
      />
    )
    expect(screen.getByText('Error')).toBeInTheDocument()
  })

  it('offers sub-workflow navigation from the inspector rather than hijacking the node click', () => {
    const onOpenChildInstance = jest.fn()
    renderWithProviders(
      <RunStepInspector
        stepId="fulfil"
        executions={[]}
        childInstanceIds={['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']}
        onOpenChildInstance={onOpenChildInstance}
      />
    )

    const button = screen.getByRole('button', { name: /open sub-workflow/i })
    button.click()
    expect(onOpenChildInstance).toHaveBeenCalledWith('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })
})

describe('run status badges — never colour-only (§4.6)', () => {
  it.each([
    ['completed', 'Completed'],
    ['active', 'Running'],
    ['failed', 'Failed'],
    ['skipped', 'Skipped'],
    ['paused', 'Waiting'],
    ['pending', 'Not started'],
  ] as const)('%s renders a text label alongside its token', (status, label) => {
    const { container } = renderWithProviders(<RunStatusBadge status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('distinguishes skipped from never-started, which the canvas mapping collapses', () => {
    const { container: skipped } = renderWithProviders(<RunStatusBadge status="skipped" />)
    const { container: pending } = renderWithProviders(<RunStatusBadge status="pending" />)
    expect(skipped.innerHTML).not.toEqual(pending.innerHTML)
  })
})

describe('class-only badge helpers (mobile overview)', () => {
  it('maps instance statuses onto status tokens, never palette shades', () => {
    for (const status of ['RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED', 'COMPENSATING', 'COMPENSATED']) {
      expect(instanceStatusBadgeClass(status)).toMatch(/^bg-(status-|muted)/)
      expect(instanceStatusBadgeClass(status)).not.toMatch(/-\d{2,3}\b/)
    }
  })

  it('falls back to a neutral token for an unknown status instead of returning undefined', () => {
    expect(instanceStatusBadgeClass('SOMETHING_NEW')).toContain('bg-muted')
  })

  it('maps event types onto status tokens', () => {
    expect(runEventBadgeClass('STEP_FAILED')).toContain('status-error')
    expect(runEventBadgeClass('STEP_EXITED')).toContain('status-success')
    expect(runEventBadgeClass('WHATEVER')).toContain('status-neutral')
  })
})
