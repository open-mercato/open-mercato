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
import { act, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

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

  it('scrolls to the first errored field when an injection widget blocks save', async () => {
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

    expect(scrollSpy).toHaveBeenCalled()
    expect(scrollSpy.mock.instances[0]).toBe(descriptionContainer)
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }))
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
})
