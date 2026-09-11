/**
 * @jest-environment jsdom
 *
 * Step 2.10 (workflows UX Phase 3a, issue #4244): the chip row rendered along a
 * transition. Covers the condition chip, the activity-icon cap with its `+N`
 * overflow badge, the `otherwise` chip, semantic-zoom collapse to dots, the
 * accessible (never colour-only) labelling, and the chip → dialog-section bridge.
 */
import * as React from 'react'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { WorkflowRouteChips } from '../WorkflowRouteChips'
import { buildRouteChipModel } from '../../lib/route-chips'
import { WORKFLOW_ROUTE_CHIP_EVENT, requestRouteChipSection, type RouteChipEventDetail } from '../../lib/route-chip-events'
import {
  NODE_HANDLE_SIZE,
  NODE_HEIGHT,
  ROUTE_CHIP_CLASS,
  ROUTE_CHIP_HEIGHT,
  ROUTE_CHIP_ICON_CLASS,
  ROUTE_CHIP_ICON_SIZE,
  ROUTE_CHIP_LABEL_ICON_CLASS,
  ROUTE_CHIP_PADDING_CLASS,
} from '../../lib/node-geometry'

const activity = (activityType: string, index: number) => ({
  activityId: `a${index}`,
  activityName: `Activity ${index}`,
  activityType,
  config: {},
})

describe('WorkflowRouteChips', () => {
  it('renders the condition summary and opens the condition section on click', () => {
    const onOpenSection = jest.fn()
    const model = buildRouteChipModel({ condition: { field: 'amount', operator: '>', value: 5000 } })

    renderWithProviders(<WorkflowRouteChips model={model} onOpenSection={onOpenSection} />)

    expect(screen.getByText('amount > 5000')).toBeInTheDocument()
    fireEvent.click(screen.getByText('amount > 5000'))
    expect(onOpenSection).toHaveBeenCalledWith('condition')
  })

  it('caps activity chips at three and renders a +N overflow badge', () => {
    const model = buildRouteChipModel({
      activities: [0, 1, 2, 3, 4].map((index) => activity('SEND_EMAIL', index)),
    })

    renderWithProviders(<WorkflowRouteChips model={model} onOpenSection={jest.fn()} />)

    const activityChips = screen.getAllByRole('button', { name: 'workflows.routeChips.activityLabel' })
    expect(activityChips).toHaveLength(3)
    expect(screen.getByTestId('route-chip-overflow')).toHaveTextContent('+2')
  })

  it('opens the activities section from the overflow badge', () => {
    const onOpenSection = jest.fn()
    const model = buildRouteChipModel({ activities: [0, 1, 2, 3].map((index) => activity('WAIT', index)) })

    renderWithProviders(<WorkflowRouteChips model={model} onOpenSection={onOpenSection} />)

    fireEvent.click(screen.getByTestId('route-chip-overflow'))
    expect(onOpenSection).toHaveBeenCalledWith('activities')
  })

  it('renders the otherwise chip with an icon, not colour alone', () => {
    const model = buildRouteChipModel({ hasConditionedSibling: true })

    const { container } = renderWithProviders(<WorkflowRouteChips model={model} />)

    const chip = screen.getByTestId('route-chip-otherwise')
    expect(chip).toHaveTextContent('workflows.routeChips.otherwise')
    expect(container.querySelector('[data-testid="route-chip-otherwise"] svg')).not.toBeNull()
  })

  it('collapses to dots below the semantic-zoom threshold', () => {
    const model = buildRouteChipModel({
      condition: { field: 'amount', operator: '>', value: 5000 },
      activities: [activity('WAIT', 0)],
    })

    renderWithProviders(<WorkflowRouteChips model={model} collapsed />)

    expect(screen.queryByTestId('route-chips')).not.toBeInTheDocument()
    const collapsed = screen.getByTestId('route-chips-collapsed')
    expect(collapsed).toHaveAttribute('aria-label', 'workflows.routeChips.collapsed')
    expect(collapsed.querySelectorAll('span')).toHaveLength(2)
  })

  it('renders nothing for a bare route', () => {
    renderWithProviders(<WorkflowRouteChips model={buildRouteChipModel({})} />)
    expect(screen.queryByTestId('route-chips')).not.toBeInTheDocument()
    expect(screen.queryByTestId('route-chips-collapsed')).not.toBeInTheDocument()
  })

  it('every chip carries an accessible label', () => {
    const model = buildRouteChipModel({
      condition: { field: 'amount', operator: '>', value: 1 },
      activities: [0, 1, 2, 3].map((index) => activity('CALL_API', index)),
    })

    renderWithProviders(<WorkflowRouteChips model={model} />)

    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('aria-label')).toBeTruthy()
    }
  })
})

describe('route chip radius', () => {
  it('uses a DS radius step, never the 4px `rounded` that is on neither scale', () => {
    const model = buildRouteChipModel({ condition: { field: 'amount', operator: '>', value: 5000 } })
    renderWithProviders(<WorkflowRouteChips model={model} />)

    const chip = screen.getAllByRole('button')[0]
    expect(chip.className).toContain('rounded-md')
    expect(chip.className).not.toMatch(/(?:^|\s)rounded(?:\s|$)/)
  })
})

/**
 * The activity chip is the only face an activity has on the canvas, and it used
 * to render a 12px glyph in a ~18px box — the size of a connection handle, which
 * is a dot you aim at rather than a mark you read. Its geometry now comes from
 * the canvas size registry, so the component cannot quietly shrink it back.
 */
describe('route chip geometry comes from one constant', () => {
  it('derives the Tailwind icon class from the pixel size', () => {
    expect(ROUTE_CHIP_ICON_SIZE).toBe(20)
    expect(ROUTE_CHIP_ICON_CLASS).toBe('size-5')
    expect(ROUTE_CHIP_CLASS).toContain(ROUTE_CHIP_PADDING_CLASS)
  })

  it('reads at canvas zoom: a chip glyph is bigger than a connection handle', () => {
    expect(ROUTE_CHIP_ICON_SIZE).toBeGreaterThan(NODE_HANDLE_SIZE)
  })

  it('still never competes with the cards it connects', () => {
    expect(ROUTE_CHIP_HEIGHT).toBeLessThan(NODE_HEIGHT / 2)
  })

  it('renders the activity icon at exactly that size', () => {
    const model = buildRouteChipModel({ activities: [activity('SEND_EMAIL', 0)] })

    const { container } = renderWithProviders(<WorkflowRouteChips model={model} />)

    const icon = container.querySelector('[data-testid="route-chips"] button svg')
    expect(icon?.getAttribute('class')).toContain(ROUTE_CHIP_ICON_CLASS)
  })

  it('leaves the component spelling no chip size of its own', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'WorkflowRouteChips.tsx'), 'utf8')
    expect(source).not.toMatch(/\bsize-(?:3|4|5)\b/)
    expect(source).not.toMatch(/\bp[xy]?-[\d.]+/)
  })
})

describe('route chip → dialog bridge', () => {
  it('announces the requested edge and section on window', () => {
    const received: RouteChipEventDetail[] = []
    const listener = (event: Event) => received.push((event as CustomEvent<RouteChipEventDetail>).detail)
    window.addEventListener(WORKFLOW_ROUTE_CHIP_EVENT, listener)

    requestRouteChipSection('e_start_end', 'activities')

    window.removeEventListener(WORKFLOW_ROUTE_CHIP_EVENT, listener)
    expect(received).toEqual([{ edgeId: 'e_start_end', section: 'activities' }])
  })
})

/**
 * A chip that also carries text is a different case from the icon-only activity
 * chip: its glyph shares a line with a `text-xs` label, so scaling it to the
 * canvas size makes the icon tower over the words it belongs to.
 */
describe('chips that carry a label size their glyph against the label', () => {
  it('renders the condition glyph at the label size, not the canvas size', () => {
    const model = buildRouteChipModel({ condition: { field: 'amount', operator: '>', value: 5000 } })

    const { container } = renderWithProviders(<WorkflowRouteChips model={model} />)

    const icon = container.querySelector('[data-testid="route-chips"] button svg')
    expect(icon?.getAttribute('class')).toContain(ROUTE_CHIP_LABEL_ICON_CLASS)
    expect(icon?.getAttribute('class')).not.toContain(ROUTE_CHIP_ICON_CLASS)
  })

  it('renders the otherwise glyph at the label size too', () => {
    const model = buildRouteChipModel({ hasConditionedSibling: true })

    const { container } = renderWithProviders(<WorkflowRouteChips model={model} />)

    const icon = container.querySelector('[data-testid="route-chip-otherwise"] svg')
    expect(icon?.getAttribute('class')).toContain(ROUTE_CHIP_LABEL_ICON_CLASS)
  })
})
