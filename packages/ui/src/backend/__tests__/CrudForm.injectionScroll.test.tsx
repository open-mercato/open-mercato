/** @jest-environment jsdom */
jest.setTimeout(15000)

const pushMock = jest.fn()
const confirmDialogMock = jest.fn()
const triggerEventMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: confirmDialogMock,
    ConfirmDialogElement: null,
  }),
}))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: triggerEventMock }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

const originalResponse = Object.getOwnPropertyDescriptor(globalThis, 'Response')
beforeAll(() => {
  if (!originalResponse) Object.defineProperty(globalThis, 'Response', { value: class Response {}, configurable: true })
})
afterAll(() => {
  if (!originalResponse) Reflect.deleteProperty(globalThis, 'Response')
})

describe('CrudForm injection-block scroll behavior', () => {
  const fields: CrudField[] = [
    { id: 'name', label: 'Name', type: 'text' },
    { id: 'description', label: 'Description', type: 'text' },
  ]

  let scrollSpy: jest.Mock

  beforeEach(() => {
    pushMock.mockReset()
    confirmDialogMock.mockReset()
    confirmDialogMock.mockResolvedValue(true)
    triggerEventMock.mockReset()
    scrollSpy = jest.fn()
    // jsdom does not implement scrollIntoView
    ;(Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollSpy
  })

  it('reveals the actual blocking message when an injection widget supplies field errors', async () => {
    triggerEventMock.mockImplementation(async (event: string, data: Record<string, unknown>) => {
      if (event === 'onBeforeSave') {
        return {
          ok: false,
          message: 'SEO helper: Description is missing.',
          fieldErrors: { description: 'Description is required.' },
        }
      }
      if (event === 'transformValidation') return data
      return { ok: true, data }
    })

    const { container } = renderWithProviders(
      <CrudForm
        title="Form"
        fields={fields}
        initialValues={{ name: 'A valid product name', description: '' }}
        injectionSpotId="crud-form:catalog.product"
        onSubmit={() => {}}
      />,
      { dict: { 'ui.forms.actions.save': 'Save' } },
    )

    const form = container.querySelector('form') as HTMLFormElement
    const descriptionContainer = container.querySelector(
      '[data-crud-field-id="description"]',
    ) as HTMLElement

    await act(async () => {
      fireEvent.submit(form)
      await new Promise((resolve) => setTimeout(resolve, 0))
      await Promise.resolve()
    })

    await waitFor(() => expect(container.querySelector('[data-crud-form-error]')).toHaveFocus())
    const rejection = container.querySelector('[data-crud-form-error]')
    expect(rejection).toHaveTextContent('SEO helper: Description is missing.')
    expect(descriptionContainer).toHaveTextContent('Description is required.')
    expect(scrollSpy.mock.instances[0]).toBe(rejection)
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'instant', block: 'start', inline: 'nearest' })
  })

  it.each([false, true])('reveals the translated transformed field-only injection error in embedded=%s', async (embedded) => {
    triggerEventMock.mockImplementation(async (event: string, data: Record<string, unknown>) => {
      if (event === 'onBeforeSave') {
        return { ok: false, fieldErrors: { description: 'example.calendar.visitAvailability.unavailable' } }
      }
      if (event === 'transformValidation') {
        return { ok: true, data: { description: 'example.calendar.visitAvailability.retry' } }
      }
      return { ok: true, data }
    })
    const onSubmit = jest.fn()
    const { container, getByRole } = renderWithProviders(
      <CrudForm
        fields={fields}
        embedded={embedded}
        injectionSpotId="crud-form:example.todo"
        onSubmit={onSubmit}
      />,
      { dict: { 'example.calendar.visitAvailability.retry': 'Availability could not be checked. Try again.' } },
    )

    const input = container.querySelector('input') as HTMLInputElement
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      input.focus()
      await act(async () => { fireEvent.submit(container.querySelector('form') as HTMLFormElement) })
      await waitFor(() => expect(container.querySelector('[data-crud-form-error]')).toHaveFocus())
      const rejection = container.querySelector('[data-crud-form-error]')
      expect(getByRole('alert')).toHaveTextContent('Availability could not be checked. Try again.')
      expect(container.querySelector('[data-crud-field-id="description"]')).toHaveTextContent('Availability could not be checked. Try again.')
      expect(scrollSpy).toHaveBeenCalledTimes(attempt)
      expect(scrollSpy.mock.instances[attempt - 1]).toBe(rejection)
    }
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('retains the generic injection fallback when transformed field errors are empty', async () => {
    triggerEventMock.mockImplementation(async (event: string, data: Record<string, unknown>) => {
      if (event === 'onBeforeSave') return { ok: false, fieldErrors: { description: 'Unavailable.' } }
      if (event === 'transformValidation') return { ok: true, data: {} }
      return { ok: true, data }
    })
    const onSubmit = jest.fn()
    const { container, getByRole } = renderWithProviders(
      <CrudForm fields={fields} injectionSpotId="crud-form:example.todo" onSubmit={onSubmit} />,
      { dict: { 'ui.forms.flash.saveBlocked': 'Save blocked by validation.' } },
    )
    await act(async () => { fireEvent.submit(container.querySelector('form') as HTMLFormElement) })
    await waitFor(() => expect(container.querySelector('[data-crud-form-error]')).toHaveFocus())
    expect(getByRole('alert')).toHaveTextContent('Save blocked by validation.')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not scroll when the injection widget allows save', async () => {
    triggerEventMock.mockImplementation(async (event: string, data: Record<string, unknown>) => {
      if (event === 'onBeforeSave') return { ok: true }
      if (event === 'transformValidation') return data
      return { ok: true, data }
    })

    const { container } = renderWithProviders(
      <CrudForm
        title="Form"
        fields={fields}
        initialValues={{ name: 'A valid product name', description: 'Long enough description text here.' }}
        injectionSpotId="crud-form:catalog.product"
        onSubmit={() => {}}
      />,
      { dict: { 'ui.forms.actions.save': 'Save' } },
    )

    const form = container.querySelector('form') as HTMLFormElement

    await act(async () => {
      fireEvent.submit(form)
      await new Promise((resolve) => setTimeout(resolve, 0))
      await Promise.resolve()
    })

    expect(scrollSpy).not.toHaveBeenCalled()
  })
  it.each([false, true])('reveals repeated server refusals in embedded=%s without moving focus during edits', async (embedded) => {
    triggerEventMock.mockImplementation(async (_event: string, data: Record<string, unknown>) => ({ ok: true, data }))
    const onSubmit = jest.fn().mockRejectedValue(new Error('Permission refused.'))
    const { container, getByRole } = renderWithProviders(
      <CrudForm fields={fields} embedded={embedded} initialValues={{ name: 'Test' }} onSubmit={onSubmit} />,
      { dict: { 'ui.forms.actions.save': 'Save' } },
    )
    const form = container.querySelector('form') as HTMLFormElement
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await act(async () => { fireEvent.submit(form) })
      await waitFor(() => expect(container.querySelector('[data-crud-form-error]')).toHaveFocus())
      expect(getByRole('alert')).toHaveTextContent('Permission refused.')
      expect(scrollSpy).toHaveBeenCalledTimes(attempt)
      const input = container.querySelector('input') as HTMLInputElement
      input.focus()
      fireEvent.change(input, { target: { value: `Changed ${attempt}` } })
      expect(input).toHaveFocus()
      expect(scrollSpy).toHaveBeenCalledTimes(attempt)
    }
  })

  it('keeps a message-only injection rejection visible without an injection region', async () => {
    triggerEventMock.mockImplementation(async (event: string, data: Record<string, unknown>) =>
      event === 'onBeforeSave' ? { ok: false, message: 'Approval is required.' } : { ok: true, data },
    )
    const onSubmit = jest.fn()
    const { container, getByRole } = renderWithProviders(
      <CrudForm fields={fields} injectionSpotId="crud-form:example.todo" onSubmit={onSubmit} />,
    )
    await act(async () => { fireEvent.submit(container.querySelector('form') as HTMLFormElement) })
    await waitFor(() => expect(container.querySelector('[data-crud-form-error]')).toHaveFocus())
    expect(getByRole('alert')).toHaveTextContent('Approval is required.')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('reveals required validation and leaves corrected fields editable', async () => {
    const onSubmit = jest.fn()
    const { container } = renderWithProviders(
      <CrudForm fields={[{ id: 'name', label: 'Name', type: 'text', required: true }]} onSubmit={onSubmit} />,
      { dict: { 'ui.forms.errors.required': 'Name is required.' } },
    )
    await act(async () => { fireEvent.submit(container.querySelector('form') as HTMLFormElement) })
    await waitFor(() => expect(container.querySelector('[data-crud-form-error]')).toHaveFocus())
    const rejection = container.querySelector('[data-crud-form-error]')
    expect(rejection).toHaveTextContent('Name is required.')
    expect(onSubmit).not.toHaveBeenCalled()
    const input = container.querySelector('input') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: 'Corrected' } })
    expect(input).toHaveFocus()
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })

  it('retains an accessible fallback when validation transforms remove every field message', async () => {
    triggerEventMock.mockImplementation(async (event: string, data: Record<string, unknown>) =>
      event === 'transformValidation' ? { ok: true, data: {} } : { ok: true, data },
    )
    const { container, getByRole } = renderWithProviders(
      <CrudForm fields={[{ id: 'name', label: 'Name', type: 'text', required: true }]} injectionSpotId="crud-form:example.todo" />,
      { dict: { 'ui.forms.errors.highlighted': 'Please fix the highlighted errors.' } },
    )
    await act(async () => { fireEvent.submit(container.querySelector('form') as HTMLFormElement) })
    await waitFor(() => expect(container.querySelector('[data-crud-form-error]')).toHaveFocus())
    expect(getByRole('alert')).toHaveTextContent('Please fix the highlighted errors.')
  })

})
