/**
 * @jest-environment jsdom
 *
 * Node outcome-row footer (fidelity gap #4, spec §7.2).
 *
 * Two things are load-bearing and are pinned here: the progressive-disclosure
 * rule (only wired outcomes plus `approved`, so five agent nodes in a 60-node
 * flow stay readable), and the §4.6 acceptance criterion that the LABEL carries
 * the meaning — two of these rows paint the same red, which at 10px is not a
 * distinction anyone can read.
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { NodeOutcomeRows } from '../nodes/NodeOutcomeRows'
import {
  buildAgentOutcomeRows,
  buildDecisionOutcomeRows,
  readDecisionLabel,
} from '../../lib/node-outcome-rows'
import { outcomeSourceHandleId } from '../../lib/outcome-routing'

jest.mock('@xyflow/react', () => ({
  Handle: ({ id, 'aria-label': ariaLabel }: { id: string; 'aria-label'?: string }) => (
    <span data-testid="handle" data-handle-id={id} aria-label={ariaLabel} />
  ),
  Position: { Right: 'right' },
}))

const agentStep = 'assess'

function outcomeTransition(outcomeKind: string, fromStepId = agentStep) {
  return { fromStepId, kind: 'outcome', outcomeKind }
}

describe('agent outcome rows — progressive disclosure', () => {
  it('shows approved alone when nothing is wired', () => {
    const rows = buildAgentOutcomeRows([], agentStep)
    expect(rows.map((row) => row.handleId)).toEqual([outcomeSourceHandleId('approved')])
  })

  it('adds only the wired outcomes, in the platform order', () => {
    const rows = buildAgentOutcomeRows(
      [outcomeTransition('error'), outcomeTransition('rejected')],
      agentStep,
    )
    expect(rows.map((row) => row.labelKey)).toEqual([
      'workflows.outcomes.approved',
      'workflows.outcomes.rejected',
      'workflows.outcomes.error',
    ])
  })

  it('ignores routes leaving another step and unknown outcome kinds', () => {
    const rows = buildAgentOutcomeRows(
      [outcomeTransition('rejected', 'other'), outcomeTransition('needsReview')],
      agentStep,
    )
    expect(rows).toHaveLength(1)
  })

  it('gives each outcome its own glyph so two red rows stay distinguishable', () => {
    const rows = buildAgentOutcomeRows(
      [outcomeTransition('rejected'), outcomeTransition('guardrailBlocked')],
      agentStep,
    )
    const red = rows.filter((row) => row.tone === 'error')
    expect(red).toHaveLength(2)
    expect(new Set(red.map((row) => row.glyph)).size).toBe(2)
  })
})

describe('user task decision rows — no engine work needed', () => {
  it('binds each row to the decision own durable transition id', () => {
    const rows = buildDecisionOutcomeRows([
      { id: 'done', label: 'Call done', transitionId: 't_done', style: 'primary' },
      { id: 'unreachable', label: 'Unreachable', transitionId: 't_unreachable', style: 'destructive' },
    ])
    expect(rows.map((row) => row.handleId)).toEqual(['t_done', 't_unreachable'])
    expect(rows.map((row) => row.labelFallback)).toEqual(['Call done', 'Unreachable'])
  })

  it('skips a decision that binds to no route', () => {
    expect(buildDecisionOutcomeRows([{ id: 'orphan', label: 'Orphan' }])).toEqual([])
  })

  it('reads a localized decision label rather than rendering an object', () => {
    expect(readDecisionLabel({ pl: 'Gotowe', en: 'Done' })).toBe('Done')
    expect(readDecisionLabel({ pl: 'Gotowe', en: 'Done' }, 'pl')).toBe('Gotowe')
    expect(readDecisionLabel({ de: 'Fertig' })).toBe('Fertig')
    expect(readDecisionLabel(undefined)).toBe('')
  })
})

describe('the footer never lets colour carry the meaning', () => {
  it('names every row and every handle', () => {
    const rows = buildAgentOutcomeRows(
      [outcomeTransition('rejected'), outcomeTransition('guardrailBlocked')],
      agentStep,
    )
    renderWithProviders(<NodeOutcomeRows rows={rows} isConnectable />)

    for (const row of rows) {
      expect(screen.getByText(row.labelFallback)).toBeInTheDocument()
      const handle = document.querySelector(`[data-handle-id="${row.handleId}"]`)
      expect(handle).not.toBeNull()
      expect(handle?.getAttribute('aria-label')).toBe(row.labelFallback)
    }
  })

  it('states that an unwired outcome inherits the error directive', () => {
    renderWithProviders(
      <NodeOutcomeRows
        rows={buildAgentOutcomeRows([], agentStep)}
        inheritanceNote="unhandled → error directive"
      />,
    )
    expect(screen.getByText('unhandled → error directive')).toBeInTheDocument()
  })

  it('renders nothing at all when a node has no rows', () => {
    const { container } = renderWithProviders(<NodeOutcomeRows rows={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
