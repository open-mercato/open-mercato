/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { Wizard } from '../Wizard'
import { wizardFixtures } from '../fixtures'
import { wizardPropsSchema, type WizardProps } from '../../contracts/wizard'

const dict = {
  'ui.blocks.wizard.back': 'Back',
  'ui.blocks.wizard.next': 'Next',
  'ui.blocks.wizard.finish': 'Finish',
  'ui.blocks.wizard.loading': 'Loading wizard',
  'ui.blocks.wizard.error': 'Wizard failed',
  'ui.blocks.wizard.empty': 'Wizard empty',
  'ui.blocks.wizard.stepSummary': 'Step {current} of {total}: {title}',
  'ui.blocks.wizard.stepPosition': 'Step {current} of {total}',
  'ui.blocks.wizard.stepError': '{title} needs attention',
  'ui.blocks.wizard.stepErrorWithMessage': '{title}: {message}',
  'ui.blocks.wizard.emptyDescription': 'No steps yet',
  'ui.blocks.wizard.retry': 'Try again',
}

function renderWizard(props: WizardProps) {
  return renderWithProviders(<Wizard {...props} />, { dict })
}

type Deferred<TValue> = { promise: Promise<TValue>; resolve: (value: TValue) => void; reject: (reason: Error) => void }

function createDeferred<TValue>(): Deferred<TValue> {
  let resolve!: (value: TValue) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<TValue>((resolveFn, rejectFn) => {
    resolve = resolveFn
    reject = rejectFn
  })
  return { promise, resolve, reject }
}

function statusOf(title: string): string | null {
  const item = screen.getAllByText(title).map((node) => node.closest('[data-slot="step-indicator-item"]')).find(Boolean)
  return item ? item.getAttribute('data-status') : null
}

describe('Wizard', () => {
  it('shows every step title with the mapped status', () => {
    renderWizard(wizardFixtures.withError)
    expect(statusOf('Details')).toBe('complete')
    expect(statusOf('Pricing')).toBe('error')
    expect(statusOf('Review')).toBe('current')
  })

  it('maps upcoming steps to pending', () => {
    renderWizard(wizardFixtures.firstStep)
    expect(statusOf('Details')).toBe('current')
    expect(statusOf('Pricing')).toBe('pending')
  })

  it('marks the active step with aria-current', () => {
    const { container } = renderWizard(wizardFixtures.middleStep)
    const current = container.querySelectorAll('[data-slot="step-indicator-item"] [aria-current="step"], [data-slot="step-indicator-item"][aria-current="step"]')
    expect(current).toHaveLength(1)
    expect(current[0].closest('[data-slot="step-indicator-item"]')?.textContent).toContain('Pricing')
  })

  it('renders the narrow summary and dots', () => {
    const { container } = renderWizard(wizardFixtures.middleStep)
    expect(screen.getByText('Step 2 of 3')).toBeTruthy()
    expect(screen.queryByText('Step 2 of 3: Pricing')).toBeNull()
    expect(container.querySelector('[data-slot="stepper-dots"]')).toBeTruthy()
    expect(container.querySelector('[data-slot="wizard-step-summary"]')?.tagName).toBe('P')
  })

  it('hides Back on the first step and Finish except on the last', () => {
    renderWizard(wizardFixtures.firstStep)
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Finish' })).toBeNull()
  })

  it('shows Back and Finish on the last step without Next', () => {
    renderWizard(wizardFixtures.lastStep)
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })

  it('calls onBack', () => {
    const onBack = jest.fn()
    renderWizard({ ...wizardFixtures.middleStep, onBack })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('disables the footer while Next is pending and re-enables after resolving false', async () => {
    const deferred = createDeferred<boolean>()
    const onNext = jest.fn(() => deferred.promise)
    renderWizard({ ...wizardFixtures.middleStep, onNext })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onNext).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status')).toBeTruthy()
    await act(async () => {
      deferred.resolve(false)
    })
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(false)
    expect(statusOf('Pricing')).toBe('current')
  })

  it('clears pending when onNext rejects', async () => {
    const deferred = createDeferred<boolean>()
    renderWizard({ ...wizardFixtures.middleStep, onNext: () => deferred.promise })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await act(async () => {
      deferred.reject(new Error('failed'))
    })
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false)
    })
  })

  it('calls onFinish with pending behaviour', async () => {
    const deferred = createDeferred<void>()
    const onFinish = jest.fn(() => deferred.promise)
    renderWizard({ ...wizardFixtures.lastStep, onFinish })
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: /Finish/ }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      deferred.resolve()
    })
    expect((screen.getByRole('button', { name: 'Finish' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('calls onStepSelect for completed steps only', () => {
    const onStepSelect = jest.fn()
    renderWizard({
      ...wizardFixtures.selectable,
      steps: [
        { id: 'details', title: 'Details', state: 'complete' },
        { id: 'pricing', title: 'Pricing' },
        { id: 'review', title: 'Review' },
      ],
      onStepSelect,
    })
    expect(screen.getAllByRole('button', { name: /Go to step/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /Go to step/ }))
    expect(onStepSelect).toHaveBeenCalledWith('details')
  })

  it('suspends completed-step navigation while a finish request is pending', async () => {
    const deferred = createDeferred<void>()
    const onStepSelect = jest.fn()
    renderWizard({ ...wizardFixtures.lastStep, onFinish: () => deferred.promise, onStepSelect })
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    expect(screen.queryAllByRole('button', { name: /Go to step/ })).toHaveLength(0)
    await act(async () => {
      deferred.resolve()
    })
    fireEvent.click(screen.getAllByRole('button', { name: /Go to step/ })[0])
    expect(onStepSelect).toHaveBeenCalledWith('details')
  })

  it('has no step buttons without onStepSelect', () => {
    renderWizard(wizardFixtures.lastStep)
    expect(screen.queryByRole('button', { name: /Go to step/ })).toBeNull()
  })

  it('renders children and footer slot', () => {
    renderWizard({
      ...wizardFixtures.middleStep,
      children: <div>step body</div>,
      footer: <span>draft saved</span>,
    })
    expect(screen.getByText('step body')).toBeTruthy()
    expect(screen.getByText('draft saved')).toBeTruthy()
  })

  it('renders loading status', () => {
    renderWizard(wizardFixtures.loading)
    expect(screen.getByText('Loading wizard')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })

  it('renders error status with the error message', () => {
    renderWizard(wizardFixtures.error)
    expect(screen.getByRole('alert').textContent).toContain('The wizard could not be loaded.')
  })

  it('shows an error on the active step and keeps it marked as the current step', () => {
    renderWizard({
      ...wizardFixtures.withError,
      activeStepId: 'pricing',
    })
    expect(statusOf('Pricing')).toBe('error')
    expect(document.querySelector('[data-slot="wizard-current-step-marker"]')?.getAttribute('aria-current')).toBe('step')
  })

  it('announces the current step on the narrow summary', () => {
    const { container } = renderWizard(wizardFixtures.middleStep)
    expect(container.querySelector('[data-slot="wizard-step-summary"]')?.getAttribute('aria-current')).toBe('step')
  })

  it('moves focus to the labelled content region when the step changes, not on first render', () => {
    const { rerender } = renderWizard(wizardFixtures.firstStep)
    const region = screen.getByRole('region', { name: 'Details' })
    expect(region.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).not.toBe(region)
    rerender(<Wizard {...wizardFixtures.middleStep} />)
    const next = screen.getByRole('region', { name: 'Pricing' })
    expect(document.activeElement).toBe(next)
  })

  it('triggers Next on Ctrl+Enter and Finish on the last step', async () => {
    const onNext = jest.fn(async () => true)
    const { unmount } = renderWizard({ ...wizardFixtures.middleStep, onNext, children: <input aria-label="field" /> })
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('field'), { key: 'Enter', ctrlKey: true })
    })
    expect(onNext).toHaveBeenCalledTimes(1)
    unmount()
    const onFinish = jest.fn(async () => undefined)
    renderWizard({ ...wizardFixtures.lastStep, onFinish, children: <input aria-label="field" /> })
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('field'), { key: 'Enter', metaKey: true })
    })
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('ignores Ctrl+Enter when handled, pending, or without the modifier, and ignores Escape', async () => {
    const deferred = createDeferred<boolean>()
    const onNext = jest.fn(() => deferred.promise)
    renderWizard({
      ...wizardFixtures.middleStep,
      onNext,
      children: (
        <input
          aria-label="field"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.shiftKey) event.preventDefault()
          }}
        />
      ),
    })
    const field = screen.getByLabelText('field')
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.keyDown(field, { key: 'Escape' })
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true, shiftKey: true })
    expect(onNext).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    expect(onNext).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    expect(onNext).toHaveBeenCalledTimes(1)
    await act(async () => {
      deferred.resolve(true)
    })
  })

  it('renders the default empty state replacing the whole block', () => {
    renderWizard(wizardFixtures.empty)
    expect(screen.getByText('Wizard empty')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })

  it('renders the emptyState slot when provided', () => {
    renderWizard({ ...wizardFixtures.empty, emptyState: <div>custom empty</div> })
    expect(screen.getByText('custom empty')).toBeTruthy()
    expect(screen.queryByText('Wizard empty')).toBeNull()
  })

  it('shows the active step title as a visible heading with its description', () => {
    renderWizard(wizardFixtures.middleStep)
    const heading = screen.getByRole('heading', { name: 'Pricing' })
    expect(heading.className).not.toContain('sr-only')
    expect(screen.getByText('Prices and taxes')).toBeTruthy()
    expect(screen.queryByText('Basic information')).toBeNull()
  })

  it('numbers the steps in the indicator', () => {
    const { container } = renderWizard(wizardFixtures.firstStep)
    const dots = container.querySelectorAll('[data-slot="step-indicator-dot"]')
    expect(dots[0].textContent).toBe('1')
    expect(dots[2].textContent).toBe('3')
  })

  it('names the errored step with its message and marks its dot', () => {
    const { container } = renderWizard(wizardFixtures.withError)
    const errors = container.querySelector('[data-slot="wizard-step-errors"]') as HTMLElement
    expect(errors.textContent).toBe('Pricing: Net price is required')
    expect(errors.querySelector('button')).toBeNull()
    const dots = container.querySelectorAll('[data-slot="stepper-dot"]')
    expect(dots[1].getAttribute('data-state')).toBe('error')
    expect(dots[1].className).toContain('bg-status-error-icon')
    expect(dots[2].getAttribute('data-state')).toBe('active')
  })

  it('falls back to a generic line when the errored step has no message', () => {
    const { container } = renderWizard({
      ...wizardFixtures.withError,
      steps: [
        { id: 'details', title: 'Details', state: 'complete' },
        { id: 'pricing', title: 'Pricing', state: 'error' },
        { id: 'review', title: 'Review' },
      ],
    })
    expect(container.querySelector('[data-slot="wizard-step-errors"]')?.textContent).toBe('Pricing needs attention')
  })

  it('shows no error line when no step is in error', () => {
    const { container } = renderWizard(wizardFixtures.lastStep)
    expect(container.querySelector('[data-slot="wizard-step-errors"]')).toBeNull()
  })

  it('lets people jump to an errored step from the indicator and from the error line', () => {
    const onStepSelect = jest.fn()
    renderWizard({ ...wizardFixtures.withError, onStepSelect })
    expect(screen.getAllByRole('button', { name: /Go to step/ })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Go to step: Pricing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pricing: Net price is required' }))
    expect(onStepSelect).toHaveBeenCalledTimes(2)
    expect(onStepSelect).toHaveBeenLastCalledWith('pricing')
  })

  it('does not select the active step when it is the errored one', () => {
    const onStepSelect = jest.fn()
    renderWizard({ ...wizardFixtures.withError, activeStepId: 'pricing', onStepSelect })
    fireEvent.click(screen.getByRole('button', { name: 'Go to step: Pricing' }))
    expect(onStepSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Pricing: Net price is required' })).toBeNull()
  })

  it('opens a step list from the narrow summary and selects completed or errored steps only', async () => {
    const onStepSelect = jest.fn()
    const { container } = renderWizard({ ...wizardFixtures.withError, onStepSelect })
    const trigger = container.querySelector('[data-slot="wizard-step-summary"]') as HTMLButtonElement
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger.getAttribute('aria-label')).toBe('Step 3 of 3: Review')
    expect(trigger.className).toContain('h-10')
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const items = await screen.findAllByRole('menuitem')
    expect(items).toHaveLength(3)
    expect(items[0].getAttribute('aria-disabled')).toBeNull()
    expect(items[1].getAttribute('aria-label')).toBe('Pricing: Net price is required')
    expect(items[2].getAttribute('aria-disabled')).toBe('true')
    expect(items[2].getAttribute('aria-current')).toBe('step')
    fireEvent.click(items[0])
    expect(onStepSelect).toHaveBeenCalledWith('details')
  })

  it('renders a retry action on the error state only when onRetry is provided', () => {
    const onRetry = jest.fn()
    const { unmount } = renderWizard({ ...wizardFixtures.error, onRetry })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    unmount()
    renderWizard({ ...wizardFixtures.error, onRetry: undefined })
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('renders a busy skeleton in the wizard slot while loading', () => {
    const { container } = renderWizard(wizardFixtures.loading)
    const root = container.querySelector('[data-slot="wizard"]') as HTMLElement
    expect(root.getAttribute('aria-busy')).toBe('true')
    expect(root.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(4)
  })

  it('describes the default empty state', () => {
    renderWizard(wizardFixtures.empty)
    expect(screen.getByText('No steps yet')).toBeTruthy()
  })

  it('caps the width and lets className override it', () => {
    const { container, unmount } = renderWizard(wizardFixtures.firstStep)
    expect((container.querySelector('[data-slot="wizard"]') as HTMLElement).className).toContain('max-w-3xl')
    unmount()
    const second = renderWizard({ ...wizardFixtures.firstStep, className: 'max-w-none' })
    const className = (second.container.querySelector('[data-slot="wizard"]') as HTMLElement).className
    expect(className).toContain('max-w-none')
    expect(className).not.toContain('max-w-3xl')
  })

  it('omits the footer text container when no footer slot is passed', () => {
    const { container } = renderWizard(wizardFixtures.middleStep)
    expect(container.querySelector('[data-slot="wizard-footer"]')?.children).toHaveLength(1)
  })

  it.each(Object.entries(wizardFixtures))('fixture %s parses against the schema', (_name, fixture) => {
    expect(wizardPropsSchema.safeParse(fixture).success).toBe(true)
  })
})
