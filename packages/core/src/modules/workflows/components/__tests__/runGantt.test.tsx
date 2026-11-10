/**
 * @jest-environment jsdom
 *
 * Run Gantt (spec §8.3). The model is unit-tested in
 * `lib/__tests__/run-gantt.test.ts`; what matters here is that a bar is a
 * NAMED, focusable control carrying its real duration — the compression is a
 * rendering decision and must never reach a label.
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { RunGantt } from '../run/RunGantt'
import type { RunStepInstanceInput } from '../../lib/run-execution'

const BASE = Date.parse('2026-07-29T10:00:00.000Z')

function step(stepId: string, offsetSeconds: number, durationSeconds: number): RunStepInstanceInput {
  return {
    id: `si-${stepId}`,
    stepId,
    stepName: stepId,
    stepType: 'AUTOMATED',
    status: 'COMPLETED',
    enteredAt: new Date(BASE + offsetSeconds * 1000).toISOString(),
    exitedAt: new Date(BASE + (offsetSeconds + durationSeconds) * 1000).toISOString(),
  }
}

describe('RunGantt', () => {
  it('says so when nothing has executed rather than rendering an empty frame', () => {
    renderWithProviders(<RunGantt stepInstances={[]} />)
    expect(screen.getByText(/no step executions have been recorded/i)).toBeInTheDocument()
  })

  it('renders one named, focusable bar per step execution', () => {
    renderWithProviders(<RunGantt stepInstances={[step('validate', 0, 2), step('charge', 2, 3)]} />)

    const bars = screen.getAllByRole('button')
    expect(bars).toHaveLength(2)
    expect(screen.getByRole('button', { name: /validate — completed, 2\.0s/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /charge — completed, 3\.0s/i })).toBeInTheDocument()
  })

  it('reports the REAL duration of a collapsed wait, not the compressed one', () => {
    const threeDays = 3 * 24 * 60 * 60
    renderWithProviders(
      <RunGantt
        stepInstances={[step('validate', 0, 1), step('approve', 1, threeDays), step('ship', 1 + threeDays, 1)]}
      />
    )

    expect(screen.getByRole('button', { name: /approve — completed, 3d 0h/i })).toBeInTheDocument()
    expect(screen.getByText(/waiting time collapsed/i)).toBeInTheDocument()
    expect(screen.getByText(/durations shown are always the real elapsed time/i)).toBeInTheDocument()
  })

  it('does not advertise collapsing when nothing was collapsed', () => {
    renderWithProviders(<RunGantt stepInstances={[step('a', 0, 1), step('b', 1, 1)]} />)
    expect(screen.queryByText(/waiting time collapsed/i)).not.toBeInTheDocument()
  })

  it('selects the step when a bar is activated', () => {
    const onSelectStep = jest.fn()
    renderWithProviders(<RunGantt stepInstances={[step('validate', 0, 2)]} onSelectStep={onSelectStep} />)

    screen.getByRole('button', { name: /validate/i }).click()
    expect(onSelectStep).toHaveBeenCalledWith('validate')
  })

  it('marks an unfinished step as running against the injected clock', () => {
    renderWithProviders(
      <RunGantt
        stepInstances={[
          {
            id: 'si-1',
            stepId: 'awaiting',
            stepName: 'awaiting',
            status: 'ACTIVE',
            enteredAt: new Date(BASE).toISOString(),
            exitedAt: null,
          },
        ]}
        now={BASE + 45_000}
      />
    )

    expect(screen.getByText('(running)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /awaiting — running, 45s/i })).toBeInTheDocument()
  })
})
