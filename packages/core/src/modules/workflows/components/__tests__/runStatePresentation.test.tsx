/**
 * @jest-environment jsdom
 *
 * Step presentation on the card (spec `2026-07-30-workflow-run-outcomes.md`,
 * Part 2 → Constraints).
 *
 * Two rules are load-bearing and both are asserted here rather than described:
 *
 * 1. **Status is never colour-only.** Every state pairs its DS token with its
 *    own icon shape and an `sr-only` name.
 * 2. **Motion is an enhancement.** `prefers-reduced-motion` disables the spin,
 *    and a working step must still be distinguishable from a waiting one with
 *    the animation off — so the icon and the reason line carry the distinction.
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { WorkflowLegend } from '../WorkflowLegend'
import { STATUS_COLORS } from '../../lib/status-colors'

const DICT = {
  'workflows.nodeStatus.working': 'Working',
  'workflows.nodeStatus.waiting': 'Waiting',
  'workflows.nodeStatus.needs_attention': 'Needs attention',
  'workflows.runState.reason.agentRunning': 'Agent {agent} is running…',
  'workflows.runState.reason.userTaskQueue': 'Waiting for {queue}',
  'workflows.runState.elapsed': 'running for {duration}',
}

function renderCard(props: React.ComponentProps<typeof WorkflowNodeCard>) {
  return renderWithProviders(<WorkflowNodeCard {...props} />, { dict: DICT })
}

function glyphOf(container: HTMLElement): SVGElement {
  // The node-type icon comes first; the status glyph is the second `lucide`.
  const icons = Array.from(container.querySelectorAll('svg.lucide'))
  expect(icons.length).toBeGreaterThan(1)
  return icons[1] as SVGElement
}

describe('working is blue and moving, waiting is amber and still', () => {
  it('paints a working step with the info token and a spinner glyph', () => {
    const { container } = renderCard({ title: 'Enrich deal', nodeType: 'invokeAgent', status: 'working' })

    expect(container.querySelector('[data-node-status="working"]')).not.toBeNull()
    // The DS token, never a raw shade.
    expect(container.querySelector(`.${STATUS_COLORS.working.bg}`)).not.toBeNull()
    expect(glyphOf(container).getAttribute('class')).toContain('animate-spin')
  })

  it('paints a waiting step with the warning token and a static glyph', () => {
    const { container } = renderCard({ title: 'Approve order', nodeType: 'userTask', status: 'waiting' })

    expect(container.querySelector('[data-node-status="waiting"]')).not.toBeNull()
    expect(container.querySelector(`.${STATUS_COLORS.waiting.bg}`)).not.toBeNull()
    expect(glyphOf(container).getAttribute('class')).not.toContain('animate-spin')
  })

  it('gives working, waiting and attention three different icon shapes', () => {
    const shapes = new Set<string>()
    for (const status of ['working', 'waiting', 'needs_attention'] as const) {
      const { container, unmount } = renderCard({ title: 'Step', nodeType: 'automated', status })
      // Lucide stamps the icon name into the class list, so this compares SHAPE,
      // not just "some icon rendered".
      shapes.add(glyphOf(container).getAttribute('class') ?? '')
      unmount()
    }
    expect(shapes.size).toBe(3)
  })

  it('names each new state in text, so none of them is communicated by colour alone', () => {
    for (const [status, name] of [
      ['working', 'Working'],
      ['waiting', 'Waiting'],
      ['needs_attention', 'Needs attention'],
    ] as const) {
      const { container, unmount } = renderCard({ title: 'Step', nodeType: 'automated', status })
      expect(container.querySelector('.sr-only')?.textContent?.trim()).toBe(name)
      unmount()
    }
  })
})

describe('prefers-reduced-motion', () => {
  it('disables the spin without disabling the distinction', () => {
    const working = renderCard({ title: 'Enrich deal', nodeType: 'invokeAgent', status: 'working' })
    const workingGlyph = glyphOf(working.container).getAttribute('class') ?? ''
    const workingName = working.container.querySelector('.sr-only')?.textContent?.trim()
    working.unmount()

    const waiting = renderCard({ title: 'Approve order', nodeType: 'userTask', status: 'waiting' })
    const waitingGlyph = glyphOf(waiting.container).getAttribute('class') ?? ''
    const waitingName = waiting.container.querySelector('.sr-only')?.textContent?.trim()

    // The motion is opted out of by the media query, not by JS — which is what
    // keeps it from ever being the only cue.
    expect(workingGlyph).toContain('motion-reduce:animate-none')
    // With the animation removed, the two states still differ by glyph and name.
    expect(workingGlyph.replace(/animate-spin|motion-reduce:animate-none/g, '').trim()).not.toBe(
      waitingGlyph.replace(/animate-spin|motion-reduce:animate-none/g, '').trim(),
    )
    expect(workingName).not.toBe(waitingName)
  })
})

describe('the reason line', () => {
  it('says what the step is doing, using the agent LABEL', () => {
    renderCard({
      title: 'Enrich deal',
      nodeType: 'invokeAgent',
      status: 'working',
      runReason: {
        key: 'workflows.runState.reason.agentRunning',
        fallback: 'Agent {agent} is running…',
        params: { agent: 'Deal Enricher' },
      },
    })
    expect(screen.getByText(/Agent Deal Enricher is running/)).toBeInTheDocument()
  })

  it('appends the elapsed time on a step that is still going', () => {
    renderCard({
      title: 'Enrich deal',
      nodeType: 'invokeAgent',
      status: 'working',
      runReason: {
        key: 'workflows.runState.reason.agentRunning',
        fallback: 'Agent {agent} is running…',
        params: { agent: 'Deal Enricher' },
      },
      runStartedAt: new Date(Date.now() - 4 * 60 * 1000),
    })
    expect(screen.getByText(/running for 4m/)).toBeInTheDocument()
  })

  it('renders nothing extra when there is no reason to give', () => {
    const { container } = renderCard({ title: 'Step', nodeType: 'automated', status: 'working' })
    expect(container.textContent).not.toContain('running for')
  })
})

describe('the run legend describes what the run canvas actually paints', () => {
  it('lists the presentation states, not the retired lifecycle ones', () => {
    renderWithProviders(<WorkflowLegend />, {
      dict: {
        'workflows.legend.statusTitle': 'Status',
        'workflows.legend.edgeStatesTitle': 'Routes',
        'workflows.legend.status.completed': 'Completed',
        'workflows.legend.status.working': 'Working',
        'workflows.legend.status.waiting': 'Waiting',
        'workflows.legend.status.needsAttention': 'Needs attention',
        'workflows.legend.status.failed': 'Failed',
        'workflows.legend.status.notStarted': 'Not started',
        'workflows.legend.edgeState.completed': 'Taken',
        'workflows.legend.edgeState.pending': 'Not taken',
      },
    })

    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.getByText('Waiting')).toBeInTheDocument()
    expect(screen.getByText('Needs attention')).toBeInTheDocument()
  })
})
