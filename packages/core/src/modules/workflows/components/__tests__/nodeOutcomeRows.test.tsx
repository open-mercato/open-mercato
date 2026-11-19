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
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { NodeOutcomeRows } from '../nodes/NodeOutcomeRows'
import { InvokeAgentNode } from '../nodes/InvokeAgentNode'
import { UserTaskNode } from '../nodes/UserTaskNode'
import {
  buildAgentOutcomeRows,
  buildAllAgentOutcomeRows,
  buildDecisionOutcomeRows,
  buildDefaultRouteRow,
  isDecisionSourceHandle,
  readDecisionLabel,
} from '../../lib/node-outcome-rows'
import { outcomeSourceHandleId } from '../../lib/outcome-routing'
import { DEFAULT_SOURCE_HANDLE_ID } from '../../lib/route-kinds'

jest.mock('@xyflow/react', () => ({
  Handle: ({ id, 'aria-label': ariaLabel }: { id: string; 'aria-label'?: string }) => (
    <span data-testid="handle" data-handle-id={id} aria-label={ariaLabel} />
  ),
  Position: { Right: 'right', Left: 'left' },
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

  it('can reveal every authorable outcome without changing the default rows', () => {
    expect(buildAllAgentOutcomeRows().map((row) => row.labelKey)).toEqual([
      'workflows.outcomes.approved',
      'workflows.outcomes.researcher',
      'workflows.outcomes.rejected',
      'workflows.outcomes.guardrailBlocked',
      'workflows.outcomes.error',
    ])
    expect(buildAgentOutcomeRows([], agentStep)).toHaveLength(1)
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

  it('recognizes only authored decision handles', () => {
    const decisions = [{ id: 'done', label: 'Done', transitionId: 't_done' }]
    expect(isDecisionSourceHandle(decisions, 't_done')).toBe(true)
    expect(isDecisionSourceHandle(decisions, 'source')).toBe(false)
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

  it('renders an accessible progressive reveal control', () => {
    const onReveal = jest.fn()
    renderWithProviders(
      <NodeOutcomeRows
        rows={buildAgentOutcomeRows([], agentStep)}
        revealLabel="+ outcome"
        onReveal={onReveal}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '+ outcome' }))
    expect(onReveal).toHaveBeenCalledTimes(1)
  })

  it('reveals in place without bubbling to the node click that opens the dialog', () => {
    // Regression: the reveal control lives inside the React Flow node, so a
    // click that bubbles reaches onNodeClick and opens the edit dialog instead
    // of disclosing the rows on the card.
    const onReveal = jest.fn()
    const onNodeClick = jest.fn()
    renderWithProviders(
      <div onClick={onNodeClick}>
        <NodeOutcomeRows
          rows={buildAgentOutcomeRows([], agentStep)}
          revealLabel="+ outcome"
          onReveal={onReveal}
        />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: '+ outcome' }))
    expect(onReveal).toHaveBeenCalledTimes(1)
    expect(onNodeClick).not.toHaveBeenCalled()
  })

  it('renders nothing at all when a node has no rows', () => {
    const { container } = renderWithProviders(<NodeOutcomeRows rows={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('the default route is the footer last row, not a floating handle', () => {
  it('keeps the handle id the canvas and every stored transition already use', () => {
    expect(buildDefaultRouteRow().handleId).toBe(DEFAULT_SOURCE_HANDLE_ID)
    expect(DEFAULT_SOURCE_HANDLE_ID).toBe('source')
  })

  it('pairs the row with a label and a glyph of its own, never colour alone', () => {
    const row = buildDefaultRouteRow()
    expect(row.labelFallback).toBe('default')
    expect(row.labelKey).toBe('workflows.outcomes.default')
    expect(row.glyph).toBe('corner')
    expect(buildAllAgentOutcomeRows().map((outcome) => outcome.glyph)).not.toContain(row.glyph)
  })

  it('renders last, so every outgoing connection leaves from a row', () => {
    const rows = buildAgentOutcomeRows([outcomeTransition('rejected')], agentStep)
    const { container } = renderWithProviders(
      <NodeOutcomeRows rows={rows} defaultRow={buildDefaultRouteRow()} isConnectable />,
    )

    const handleIds = Array.from(container.querySelectorAll('[data-handle-id]')).map((node) =>
      node.getAttribute('data-handle-id'),
    )
    expect(handleIds).toEqual([
      outcomeSourceHandleId('approved'),
      outcomeSourceHandleId('rejected'),
      DEFAULT_SOURCE_HANDLE_ID,
    ])
    expect(screen.getByText('default')).toBeInTheDocument()
  })

  it('stays out of the footer when a node passes none, so its own handle still renders', () => {
    const { container } = renderWithProviders(
      <NodeOutcomeRows rows={buildAgentOutcomeRows([], agentStep)} isConnectable />,
    )
    expect(container.querySelector(`[data-handle-id="${DEFAULT_SOURCE_HANDLE_ID}"]`)).toBeNull()
  })

  it('gives an agent node with no outcome routes a default exit, in the footer', () => {
    const props = {
      id: agentStep,
      data: { label: 'Assess request', outcomeRows: buildAgentOutcomeRows([], agentStep) },
      isConnectable: true,
      selected: false,
    } as unknown as React.ComponentProps<typeof InvokeAgentNode>

    renderWithProviders(<InvokeAgentNode {...props} />)

    expect(
      document.querySelectorAll(`[data-handle-id="${DEFAULT_SOURCE_HANDLE_ID}"]`),
    ).toHaveLength(1)
    expect(
      document.querySelector(`[data-default-route-handle="${DEFAULT_SOURCE_HANDLE_ID}"]`),
    ).not.toBeNull()
  })

  it('drops the floating error handle when the outcome footer renders, so nothing overlaps the rows', () => {
    // Regression: the floating ErrorOutputHandle (pinned at top:75%) was
    // rendered unconditionally, so once the footer grew — e.g. after revealing
    // every outcome — the red handle covered the newly shown rows. The footer
    // already expresses error routing (the `error` disposition row plus the
    // inheritance note), so the floating handle must follow the default handle
    // and stay off a footered node.
    const props = {
      id: agentStep,
      data: { label: 'Assess request', outcomeRows: buildAllAgentOutcomeRows() },
      isConnectable: true,
      selected: false,
    } as unknown as React.ComponentProps<typeof InvokeAgentNode>

    renderWithProviders(<InvokeAgentNode {...props} />)

    expect(document.querySelector('[data-testid="workflow-error-handle"]')).toBeNull()
    // The error routing is still present as a footer row, not a floating dot.
    expect(
      document.querySelector(`[data-outcome-handle="${outcomeSourceHandleId('error')}"]`),
    ).not.toBeNull()
  })

  it('leaves a user task with no decisions exactly as it was', () => {
    const props = {
      id: 'approve',
      data: { label: 'Approve order' },
      isConnectable: true,
      selected: false,
    } as unknown as React.ComponentProps<typeof UserTaskNode>

    renderWithProviders(<UserTaskNode {...props} />)

    expect(
      document.querySelectorAll(`[data-handle-id="${DEFAULT_SOURCE_HANDLE_ID}"]`),
    ).toHaveLength(1)
    expect(document.querySelector('[data-default-route-handle]')).toBeNull()
  })

  it('moves a decision-bearing user task default route into the footer', () => {
    const props = {
      id: 'approve',
      data: {
        label: 'Approve order',
        decisions: [{ id: 'done', label: 'Done', transitionId: 't_done', style: 'primary' }],
      },
      isConnectable: true,
      selected: false,
    } as unknown as React.ComponentProps<typeof UserTaskNode>

    renderWithProviders(<UserTaskNode {...props} />)

    expect(
      document.querySelectorAll(`[data-handle-id="${DEFAULT_SOURCE_HANDLE_ID}"]`),
    ).toHaveLength(1)
    expect(
      document.querySelector(`[data-default-route-handle="${DEFAULT_SOURCE_HANDLE_ID}"]`),
    ).not.toBeNull()
  })
})

describe('invoke-agent progressive outcome authoring', () => {
  it('reveals every outcome handle from the localized add control', () => {
    const props = {
      id: agentStep,
      data: {
        label: 'Assess request',
        outcomeRows: buildAgentOutcomeRows([], agentStep),
      },
      isConnectable: true,
      selected: false,
    } as unknown as React.ComponentProps<typeof InvokeAgentNode>

    renderWithProviders(<InvokeAgentNode {...props} />)
    expect(document.querySelectorAll('[data-outcome-handle]')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '+ outcome' }))

    expect(document.querySelectorAll('[data-outcome-handle]')).toHaveLength(5)
    expect(screen.queryByRole('button', { name: '+ outcome' })).toBeNull()
  })
})
