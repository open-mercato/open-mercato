import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { StagePath, resolveStageStates } from '../StagePath'
import { stagePathFixtures } from '../fixtures'
import { stagePathPropsSchema, type StagePathProps } from '../../contracts/stage-path'

const stages = [
  { id: 'lead', label: 'Lead' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'proposal', label: 'Proposal' },
  { id: 'negotiation', label: 'Negotiation' },
  { id: 'contract', label: 'Contract' },
]

function renderPath(props: StagePathProps) {
  return renderWithProviders(<StagePath {...props} />)
}

function items() {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-slot="stage-path-item"]'))
}

function stageButton(name: RegExp) {
  return screen.getByRole('button', { name })
}

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function mockWidths(labelWidth: number, frameWidth: number) {
  const scrollWidth = jest.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function scroll(this: HTMLElement) {
    return this.getAttribute('data-slot') === 'stage-path-label' ? labelWidth : 0
  })
  const clientWidth = jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => frameWidth)
  return () => {
    scrollWidth.mockRestore()
    clientWidth.mockRestore()
  }
}

describe('StagePath', () => {
  it('keeps every fixture valid against the contract', () => {
    for (const fixture of Object.values(stagePathFixtures)) {
      expect(stagePathPropsSchema.safeParse(fixture).success).toBe(true)
    }
  })

  it('derives done, current and upcoming from the current stage', () => {
    expect(resolveStageStates(stages, 'proposal', undefined, undefined)).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming'])
  })

  it('uses completedStageIds when given', () => {
    expect(resolveStageStates(stages, 'negotiation', ['lead'], undefined)).toEqual(['done', 'upcoming', 'upcoming', 'current', 'upcoming'])
  })

  it('renders an ordered list with the current stage marked and a text state on every stage', () => {
    renderPath({ stages, currentStageId: 'proposal', ariaLabel: 'Deal stage' })
    const list = screen.getByRole('list', { name: 'Deal stage' })
    expect(list.tagName).toBe('OL')
    const rendered = items()
    expect(rendered).toHaveLength(5)
    expect(rendered.map((item) => item.getAttribute('data-state'))).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming'])
    expect(rendered.filter((item) => item.getAttribute('aria-current') === 'step')).toHaveLength(1)
    expect(rendered[2]?.getAttribute('aria-current')).toBe('step')
    expect(rendered[0]?.textContent).toContain('done')
    expect(rendered[2]?.textContent).toContain('current')
    expect(rendered[4]?.textContent).toContain('not started')
    expect(rendered[0]?.querySelector('svg')).not.toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('draws a segmented bar by default with the label inside every segment', () => {
    renderPath({ stages, currentStageId: 'proposal' })
    expect(document.querySelector('[data-slot="stage-path"]')?.getAttribute('data-appearance')).toBe('bar')
    const segments = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="stage-path-segment"]'))
    expect(segments).toHaveLength(5)
    expect(segments.map((segment) => segment.getAttribute('data-state'))).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming'])
    expect(segments[2]?.className).toContain('bg-status-info-solid')
    expect(segments[0]?.className).toContain('bg-status-info-bg')
    expect(segments[4]?.className).toContain('bg-muted')
    expect(segments[2]?.querySelector('[data-slot="stage-path-label"]')?.textContent).toBe('Proposal')
    expect(document.querySelector('[data-slot="stage-path-connector"]')).toBeNull()
  })

  it('summarises only the current stage under the bar', () => {
    renderPath(stagePathFixtures.detailed as StagePathProps)
    const summary = document.querySelector('[data-slot="stage-path-summary"]') as HTMLElement
    expect(summary.textContent).toContain('Waiting for the parcel from the customer')
    expect(summary.textContent).toContain('3 days in this stage')
    expect(summary.textContent).toContain('Stage 3 of 4')
    expect(summary.textContent).not.toContain('Warranty terms checked')
    expect(document.querySelectorAll('[data-slot="stage-path-summary-description"]')).toHaveLength(1)
  })

  it('turns the whole bar into the success tint for a won outcome', () => {
    renderPath({ stages, currentStageId: 'contract', outcome: { label: 'Won', tone: 'success', description: 'Closed in March' } })
    expect(items().every((item) => item.getAttribute('data-state') === 'done')).toBe(true)
    const segments = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="stage-path-segment"]'))
    expect(segments.every((segment) => segment.className.includes('bg-status-success-bg'))).toBe(true)
    const outcome = document.querySelector('[data-slot="stage-path-outcome"]') as HTMLElement
    expect(outcome.getAttribute('data-tone')).toBe('success')
    expect(outcome.textContent).toContain('Outcome')
    expect(outcome.textContent).toContain('Won')
    const summary = document.querySelector('[data-slot="stage-path-summary"]') as HTMLElement
    expect(summary.textContent).toContain('Closed in March')
    expect(summary.textContent).not.toContain('Stage 5 of 5')
    expect(document.querySelector('[data-slot="stage-path"]')?.getAttribute('data-closed')).toBe('true')
  })

  it('stops the bar at the current stage for a lost outcome', () => {
    renderPath({ stages, currentStageId: 'qualified', outcome: { label: 'Lost', tone: 'error', description: 'Budget moved' } })
    expect(items().map((item) => item.getAttribute('data-state'))).toEqual(['done', 'ended', 'unreached', 'unreached', 'unreached'])
    expect(items()[1]?.textContent).toContain('ended here')
    expect(items()[2]?.textContent).toContain('not reached')
    expect(items()[1]?.getAttribute('aria-current')).toBe('step')
    const segments = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="stage-path-segment"]'))
    expect(segments[0]?.className).toContain('bg-muted')
    expect(segments[1]?.className).toContain('bg-status-error-bg')
    expect(segments[2]?.className).toContain('border-dashed')
    const summary = document.querySelector('[data-slot="stage-path-summary"]') as HTMLElement
    expect(summary.querySelector('[data-slot="stage-path-outcome"]')?.getAttribute('data-tone')).toBe('error')
    expect(summary.textContent).toContain('Lost')
    expect(summary.textContent).toContain('Budget moved')
    expect(summary.textContent).toContain('Ended at stage 2 of 5')
  })

  it('renders stages as buttons and reports the chosen stage', () => {
    const onStageSelect = jest.fn()
    renderPath({ stages, currentStageId: 'proposal', onStageSelect })
    expect(screen.getAllByRole('button')).toHaveLength(5)
    fireEvent.click(stageButton(/Negotiation/))
    expect(onStageSelect).toHaveBeenCalledWith('negotiation')
    fireEvent.click(stageButton(/Proposal/))
    expect(onStageSelect).toHaveBeenCalledTimes(1)
  })

  it('renders no buttons when readOnly', () => {
    renderPath({ stages, currentStageId: 'proposal', onStageSelect: jest.fn(), readOnly: true })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps one tab stop and moves focus with the arrow keys, Home and End', () => {
    renderPath({ stages, currentStageId: 'proposal', onStageSelect: jest.fn() })
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.tabIndex)).toEqual([-1, -1, 0, -1, -1])
    act(() => buttons[2]?.focus())
    fireEvent.keyDown(buttons[2] as HTMLElement, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(buttons[3])
    expect(screen.getAllByRole('button').map((button) => button.tabIndex)).toEqual([-1, -1, -1, 0, -1])
    fireEvent.keyDown(buttons[3] as HTMLElement, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(buttons[2])
    fireEvent.keyDown(buttons[2] as HTMLElement, { key: 'End' })
    expect(document.activeElement).toBe(buttons[4])
    fireEvent.keyDown(buttons[4] as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(buttons[4])
    fireEvent.keyDown(buttons[4] as HTMLElement, { key: 'Home' })
    expect(document.activeElement).toBe(buttons[0])
  })

  it('owns the pending state while a returned promise is unresolved', async () => {
    const pending = deferred()
    const onStageSelect = jest.fn(() => pending.promise)
    renderPath({ stages, currentStageId: 'proposal', onStageSelect })
    fireEvent.click(stageButton(/Negotiation/))
    expect(stageButton(/Negotiation/).getAttribute('aria-busy')).toBe('true')
    expect(items()[3]?.getAttribute('data-pending')).toBe('true')
    fireEvent.click(stageButton(/Contract/))
    expect(onStageSelect).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve()
      await pending.promise
      await Promise.resolve()
    })
    expect(stageButton(/Negotiation/).getAttribute('aria-busy')).toBeNull()
    fireEvent.click(stageButton(/Contract/))
    expect(onStageSelect).toHaveBeenCalledTimes(2)
  })

  it('shows the pending stage the host passes', () => {
    renderPath({ stages, currentStageId: 'proposal', onStageSelect: jest.fn(), pendingStageId: 'contract' })
    expect(stageButton(/Contract/).getAttribute('aria-busy')).toBe('true')
    expect(stageButton(/Lead/).getAttribute('aria-disabled')).toBe('true')
  })

  it('blocks a disabled stage and describes it with the reason', () => {
    const onStageSelect = jest.fn()
    renderPath({
      stages: [...stages.slice(0, 4), { id: 'contract', label: 'Contract', disabled: true, disabledReason: 'Add a signed proposal first' }],
      currentStageId: 'proposal',
      onStageSelect,
    })
    const button = stageButton(/Contract/)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    const reasonId = button.getAttribute('aria-describedby') as string
    expect(document.getElementById(reasonId)?.textContent).toBe('Add a signed proposal first')
    fireEvent.click(button)
    expect(onStageSelect).not.toHaveBeenCalled()
  })

  it('keeps the details of other stages for screen readers and out of the summary', () => {
    renderPath(stagePathFixtures.detailed as StagePathProps)
    expect(items()[1]?.textContent).toContain('Warranty terms checked')
    expect(items()[1]?.textContent).toContain('4 Mar')
    expect(items()[2]?.textContent).not.toContain('Waiting for the parcel')
  })

  it('describes the current stage button with the summary text', () => {
    renderPath({ ...(stagePathFixtures.detailed as StagePathProps), onStageSelect: jest.fn() })
    const describedBy = stageButton(/Goods received/).getAttribute('aria-describedby') as string
    expect(document.getElementById(describedBy)?.textContent).toContain('Waiting for the parcel from the customer')
  })

  it('leaves the summary out in the compact size until there is an outcome', () => {
    const detailed = stagePathFixtures.detailed as StagePathProps
    const view = renderPath({ ...detailed, size: 'compact' })
    expect(document.querySelector('[data-slot="stage-path-summary"]')).toBeNull()
    expect(items()[2]?.textContent).toContain('3 days in this stage')
    view.unmount()
    renderPath({ ...detailed, size: 'compact', outcome: { label: 'Withdrawn', tone: 'neutral', description: 'Cancelled' } })
    const summary = document.querySelector('[data-slot="stage-path-summary"]') as HTMLElement
    expect(summary.textContent).toContain('Withdrawn')
    expect(summary.textContent).not.toContain('Cancelled')
  })

  it('lists every stage with its description and meta in the vertical orientation', () => {
    renderPath({ ...(stagePathFixtures.detailed as StagePathProps), orientation: 'vertical' })
    const root = document.querySelector('[data-slot="stage-path"]') as HTMLElement
    expect(root.getAttribute('data-orientation')).toBe('vertical')
    expect(root.getAttribute('data-appearance')).toBe('markers')
    expect(document.querySelectorAll('[data-slot="stage-path-marker"]')).toHaveLength(4)
    expect(document.querySelectorAll('[data-slot="stage-path-description"]')).toHaveLength(4)
    expect(document.querySelector('[data-slot="stage-path-summary"]')).toBeNull()
    const connectors = Array.from(document.querySelectorAll('[data-slot="stage-path-connector"]'))
    expect(connectors.map((connector) => connector.getAttribute('data-reached'))).toEqual(['true', 'true', 'false'])
  })

  it('ends a vertical path with the outcome', () => {
    renderPath(stagePathFixtures.verticalLost as StagePathProps)
    const outcome = document.querySelector('li[data-slot="stage-path-outcome"]') as HTMLElement
    expect(outcome.getAttribute('data-tone')).toBe('error')
    expect(outcome.textContent).toContain('Outcome')
    expect(outcome.textContent).toContain('Rejected')
    expect(outcome.textContent).toContain('Damage is not covered by the warranty')
  })

  it('draws markers with connectors in the horizontal markers appearance', () => {
    renderPath({ stages, currentStageId: 'proposal', appearance: 'markers' })
    expect(document.querySelector('[data-slot="stage-path-segment"]')).toBeNull()
    const connectors = Array.from(document.querySelectorAll('[data-slot="stage-path-connector"]'))
    expect(connectors.map((connector) => connector.getAttribute('data-reached'))).toEqual(['true', 'true', 'false', 'false'])
    expect(document.querySelector('[data-slot="stage-path-summary"]')?.textContent).toContain('Stage 3 of 5')
  })

  it('collapses to slivers with only the current label when the labels do not fit', () => {
    const restore = mockWidths(80, 358)
    try {
      renderPath({ stages, currentStageId: 'proposal', overflow: 'collapse' })
      expect(document.querySelector('[data-slot="stage-path-list"]')?.getAttribute('data-collapsed')).toBe('true')
      const labels = Array.from(document.querySelectorAll('[data-slot="stage-path-label"]'))
      expect(labels.map((label) => label.textContent)).toEqual(['Proposal'])
      expect(document.querySelector('[data-slot="stage-path-summary"]')?.textContent).toContain('Stage 3 of 5')
      expect(items()).toHaveLength(5)
      expect(items()[2]?.getAttribute('aria-current')).toBe('step')
      expect(items()[0]?.textContent).toContain('Lead')
    } finally {
      restore()
    }
  })

  it('shows the collapsed summary in the compact size too', () => {
    const restore = mockWidths(80, 358)
    try {
      renderPath({ stages, currentStageId: 'proposal', size: 'compact' })
      expect(document.querySelector('[data-slot="stage-path-summary"]')?.textContent).toContain('Stage 3 of 5')
    } finally {
      restore()
    }
  })

  it('stays expanded when the labels fit', () => {
    const restore = mockWidths(80, 900)
    try {
      renderPath({ stages, currentStageId: 'proposal' })
      expect(document.querySelector('[data-slot="stage-path-list"]')?.getAttribute('data-collapsed')).toBeNull()
      expect(document.querySelectorAll('[data-slot="stage-path-label"]')).toHaveLength(5)
    } finally {
      restore()
    }
  })

  it('keeps full labels in a sideways scroller in the scroll mode', () => {
    const restore = mockWidths(80, 358)
    try {
      renderPath({ stages, currentStageId: 'proposal', overflow: 'scroll' })
      expect(document.querySelector('[data-slot="stage-path-scroller"]')).not.toBeNull()
      expect(document.querySelector('[data-slot="stage-path-list"]')?.getAttribute('data-collapsed')).toBeNull()
      expect(document.querySelectorAll('[data-slot="stage-path-label"]')).toHaveLength(5)
    } finally {
      restore()
    }
  })

  it('draws the frame only in the card variant', () => {
    const view = renderPath({ stages, currentStageId: 'proposal' })
    expect(document.querySelector('[data-slot="stage-path"]')?.className).not.toContain('border')
    view.unmount()
    renderPath({ stages, currentStageId: 'proposal', variant: 'card' })
    expect(document.querySelector('[data-slot="stage-path"]')?.className).toContain('border-border')
  })

  it('renders a skeleton while loading', () => {
    renderPath({ stages, currentStageId: 'proposal', status: 'loading' })
    expect(document.querySelector('[data-slot="stage-path-skeleton"]')?.getAttribute('aria-busy')).toBe('true')
    expect(document.querySelector('[data-slot="stage-path-skeleton"] .h-8')).not.toBeNull()
    expect(screen.getByText('Loading stages')).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('renders the error with a retry action', () => {
    const onRetry = jest.fn()
    renderPath({ stages, currentStageId: 'proposal', status: 'error', errorMessage: 'Stages are unavailable', onRetry, variant: 'card' })
    expect(screen.getByRole('alert').textContent).toContain('Stages are unavailable')
    expect(document.querySelector('[data-slot="stage-path"]')?.className ?? '').not.toContain('border-border')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders the empty state or the emptyState slot', () => {
    const view = renderPath({ stages, currentStageId: 'proposal', status: 'empty' })
    expect(screen.getByText('No stages yet')).toBeTruthy()
    view.unmount()
    renderPath({ stages, currentStageId: 'proposal', status: 'empty', emptyState: <p>Pick a pipeline</p> })
    expect(screen.getByText('Pick a pipeline')).toBeTruthy()
  })
})
