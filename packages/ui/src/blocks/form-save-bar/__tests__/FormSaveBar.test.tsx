import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { FormSaveBar, FORM_SAVE_BAR_FLOATING_SPACER_CLASS } from '../FormSaveBar'
import { formSaveBarFixtures } from '../fixtures'
import { formSaveBarPropsSchema, type FormSaveBarProps } from '../../contracts/form-save-bar'

const dict = {
  ui: {
    blocks: {
      formSaveBar: {
        label: 'Form changes',
        idle: 'No unsaved changes',
        dirty: 'Unsaved changes',
        saving: 'Saving',
        saved: 'Saved',
        failed: 'Could not save',
        save: 'Save',
        reset: 'Reset',
        moreActions: 'More actions',
        loading: 'Loading',
      },
    },
  },
}

const noop = () => undefined

function renderBar(props: FormSaveBarProps) {
  return renderWithProviders(<FormSaveBar {...props} />, { dict })
}

function bar() {
  return document.querySelector('[data-slot="form-save-bar"]') as HTMLElement | null
}

function visibleMessage() {
  return document.querySelector('[data-slot="form-save-bar-message"]') as HTMLElement
}

function liveRegion() {
  return document.querySelector('[data-slot="form-save-bar-status"]') as HTMLElement
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

describe('FormSaveBar', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  it('keeps every fixture valid against the contract', () => {
    for (const fixture of Object.values(formSaveBarFixtures)) {
      expect(formSaveBarPropsSchema.safeParse(fixture).success).toBe(true)
    }
  })

  it('renders no bar while idle but keeps an empty live region mounted', () => {
    renderBar({ saveState: 'idle', onSave: noop, onReset: noop })
    expect(bar()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(liveRegion()).toHaveAttribute('aria-live', 'polite')
    expect(liveRegion()).toBeEmptyDOMElement()
  })

  it.each([
    ['dirty', 'Unsaved changes'],
    ['saving', 'Saving'],
    ['saved', 'Saved'],
    ['failed', 'Could not save'],
  ] as const)('shows the bar with the default message in the %s state', (saveState, text) => {
    renderBar({ saveState, onSave: noop })
    expect(bar()).toHaveAttribute('data-state', saveState)
    expect(visibleMessage()).toHaveTextContent(text)
  })

  it('shows a custom message in place of the default', () => {
    renderBar({ saveState: 'dirty', message: 'Three fields changed', onSave: noop })
    expect(visibleMessage()).toHaveTextContent('Three fields changed')
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
  })

  it('falls back to errorMessage for a failed save without a message', () => {
    renderBar({ saveState: 'failed', errorMessage: 'The server is not responding', onSave: noop })
    expect(screen.getByRole('alert')).toHaveTextContent('The server is not responding')
  })

  it('shows savedAt as a locale time next to the saved message', () => {
    const savedAt = '2026-03-12T10:15:00Z'
    renderBar({ saveState: 'saved', savedAt, onSave: noop })
    const expected = new Date(savedAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
    const time = bar()?.querySelector('time') as HTMLElement
    expect(time).toHaveAttribute('datetime', savedAt)
    expect(time).toHaveTextContent(expected)
    expect(liveRegion()).toHaveTextContent(`Saved ${expected}`)
  })

  it('shows no time outside the saved state', () => {
    renderBar({ saveState: 'dirty', savedAt: '2026-03-12T10:15:00Z', onSave: noop })
    expect(bar()?.querySelector('time')).toBeNull()
  })

  it('wires Save to the form by id and submits it natively', () => {
    const onSubmit = jest.fn((event: React.FormEvent) => event.preventDefault())
    const onSave = jest.fn()
    renderWithProviders(
      <>
        <form id="customer-form" onSubmit={onSubmit} />
        <FormSaveBar saveState="dirty" formId="customer-form" onSave={onSave} />
      </>,
      { dict },
    )
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toHaveAttribute('type', 'submit')
    expect(save).toHaveAttribute('form', 'customer-form')
    fireEvent.click(save)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls onSave from a plain button when there is no formId', () => {
    const onSave = jest.fn()
    renderBar({ saveState: 'dirty', onSave })
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toHaveAttribute('type', 'button')
    expect(save).not.toHaveAttribute('form')
    fireEvent.click(save)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('owns the saving state while an onSave promise is pending', async () => {
    const pending = deferred()
    const onSave = jest.fn(() => pending.promise)
    renderBar({ saveState: 'dirty', message: 'Three fields changed', onSave, onReset: noop })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(bar()).toHaveAttribute('data-state', 'saving')
    expect(visibleMessage()).toHaveTextContent('Saving')
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Save/ })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    await waitFor(() => expect(bar()).toHaveAttribute('data-state', 'dirty'))
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('releases the saving state when the onSave promise rejects', async () => {
    const pending = deferred()
    renderBar({ saveState: 'dirty', onSave: () => pending.promise })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await act(async () => {
      pending.reject(new Error('failed'))
      await pending.promise.catch(() => undefined)
    })
    await waitFor(() => expect(bar()).toHaveAttribute('data-state', 'dirty'))
  })

  it('disables Save and Reset while the host reports saving', () => {
    const onSave = jest.fn()
    const onReset = jest.fn()
    renderBar({ saveState: 'saving', onSave, onReset })
    const save = screen.getByRole('button', { name: /Save/ })
    expect(save).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
    fireEvent.click(save)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps Save enabled as a retry after a failure', () => {
    const onSave = jest.fn()
    renderBar({ saveState: 'failed', onSave })
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('shows Reset only when onReset is provided', () => {
    const onReset = jest.fn()
    const view = renderBar({ saveState: 'dirty', onSave: noop })
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
    view.unmount()
    renderBar({ saveState: 'dirty', onSave: noop, onReset, resetLabel: 'Discard' })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('uses custom labels', () => {
    renderBar({ saveState: 'dirty', onSave: noop, saveLabel: 'Save customer' })
    expect(screen.getByRole('button', { name: 'Save customer' })).toBeInTheDocument()
  })

  it('blocks Save and explains why when a disabled reason is given', () => {
    const onSave = jest.fn()
    renderBar({ saveState: 'dirty', onSave, saveDisabledReason: 'Fill in the company name before saving' })
    const save = screen.getByRole('button', { name: 'Save' })
    const reason = document.querySelector('[data-slot="form-save-bar-reason"]') as HTMLElement
    expect(save).toHaveAttribute('aria-disabled', 'true')
    expect(save).toHaveAttribute('aria-describedby', reason.id)
    expect(reason).toHaveTextContent('Fill in the company name before saving')
    fireEvent.click(save)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('does not submit the linked form when Save carries a disabled reason', () => {
    const onSubmit = jest.fn((event: React.FormEvent) => event.preventDefault())
    renderWithProviders(
      <>
        <form id="customer-form" onSubmit={onSubmit} />
        <FormSaveBar saveState="dirty" formId="customer-form" saveDisabledReason="Fill in the company name" />
      </>,
      { dict },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('puts every extra action, destructive included, into the more menu', async () => {
    const onAction = jest.fn()
    renderBar({ ...formSaveBarFixtures.withActions, onAction })
    expect(screen.queryByRole('button', { name: 'Save as copy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete record' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByText('Save as draft')).toBeInTheDocument()
    expect(screen.getByText('Delete record')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Save as copy'))
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('save-copy'))
  })

  it('renders no more menu without actions', () => {
    renderBar({ saveState: 'dirty', onSave: noop })
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument()
  })

  it('announces state changes through one polite live region mounted before the bar appears', () => {
    const view = renderBar({ saveState: 'idle', onSave: noop })
    const region = liveRegion()
    view.rerender(<FormSaveBar saveState="dirty" onSave={noop} />)
    expect(liveRegion()).toBe(region)
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveTextContent('Unsaved changes')
    expect(visibleMessage()).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports a failure as an alert and keeps it out of the polite region', () => {
    renderBar({ saveState: 'failed', message: 'Could not save. The connection was lost.', onSave: noop })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save. The connection was lost.')
    expect(screen.getByRole('alert')).not.toHaveAttribute('aria-hidden')
    expect(liveRegion()).toBeEmptyDOMElement()
  })

  it('stays visible while idle when alwaysVisible is set, with nothing to save or reset', () => {
    renderBar({ saveState: 'idle', alwaysVisible: true, onSave: noop, onReset: noop })
    expect(bar()).toHaveAttribute('data-state', 'idle')
    expect(visibleMessage()).toHaveTextContent('No unsaved changes')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  })

  it('applies the placement and defaults to floating', () => {
    const view = renderBar({ saveState: 'dirty', onSave: noop })
    expect(bar()).toHaveAttribute('data-placement', 'floating')
    expect(bar()?.className).toContain('fixed')
    view.unmount()
    renderBar({ saveState: 'dirty', onSave: noop, placement: 'container', className: 'custom-class' })
    expect(bar()).toHaveAttribute('data-placement', 'container')
    expect(bar()?.className).toContain('sticky')
    expect(bar()?.className).toContain('custom-class')
  })

  it('renders leading and trailing slots', () => {
    renderBar({ saveState: 'dirty', onSave: noop, leading: <span>Draft 3</span>, trailing: <span>2 errors</span> })
    expect(document.querySelector('[data-slot="form-save-bar-leading"]')).toHaveTextContent('Draft 3')
    expect(document.querySelector('[data-slot="form-save-bar-trailing"]')).toHaveTextContent('2 errors')
  })

  it('does not move focus when the bar appears', () => {
    const view = renderWithProviders(
      <>
        <input aria-label="Company name" />
        <FormSaveBar saveState="idle" onSave={noop} />
      </>,
      { dict },
    )
    const input = screen.getByLabelText('Company name')
    input.focus()
    view.rerender(
      <>
        <input aria-label="Company name" />
        <FormSaveBar saveState="dirty" onSave={noop} />
      </>,
    )
    expect(bar()).not.toBeNull()
    expect(document.activeElement).toBe(input)
  })

  it('renders a skeleton for the loading status only when always visible', () => {
    const view = renderBar({ saveState: 'idle', status: 'loading', onSave: noop })
    expect(bar()).toBeNull()
    view.unmount()
    renderBar(formSaveBarFixtures.loading)
    expect(bar()).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('exports a spacer class for hosts of the floating placement', () => {
    expect(FORM_SAVE_BAR_FLOATING_SPACER_CLASS).toBe('pb-24')
  })
})
