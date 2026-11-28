/** @jest-environment jsdom */

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: async () => ({ ok: true }) }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField, type CrudFieldOption } from '../CrudForm'

const dict = {
  'ui.forms.actions.save': 'Save',
  'ui.forms.select.emptyOption': '—',
  'ui.forms.select.loadingOptions': 'Loading options…',
  'ui.forms.select.loadOptionsError': 'Unable to load options. Check your access and try again.',
  'ui.forms.select.retryOptions': 'Retry',
  'ui.forms.select.noOptions': 'No options available.',
}

const fieldsFor = (loadOptions: () => Promise<CrudFieldOption[]>): CrudField[] => [
  { id: 'name', label: 'Name', type: 'text' },
  { id: 'target', label: 'Related record', type: 'select', loadOptions },
]

describe('relation option feedback', () => {
  it('shows loading, handles refusal and retries without clearing a draft or selected relation', async () => {
    let rejectRequest: (reason: Error) => void = () => {}
    const pending = new Promise<CrudFieldOption[]>((_resolve, reject) => { rejectRequest = reject })
    const loader = jest.fn(() => pending)
    const onSubmit = jest.fn()
    renderWithProviders(
      <CrudForm fields={fieldsFor(loader)} initialValues={{ name: 'Draft', target: 'retained-id' }} onSubmit={onSubmit} />,
      { dict },
    )
    expect(await screen.findByText('Loading options…')).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Related record' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Unsaved draft' } })
    await act(async () => { rejectRequest(new Error('[internal] HTTP 403')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load options')
    expect(screen.queryByText('No options available.')).not.toBeInTheDocument()
    loader.mockImplementation(async () => [{ value: 'retained-id', label: 'Retained relation' }])
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Related record' })).toHaveTextContent('Retained relation'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Unsaved draft')
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Unsaved draft', target: 'retained-id' }), expect.any(Object)))
  })

  it('keeps static choices available when the dynamic loader fails', async () => {
    const fields: CrudField[] = [{
      id: 'target',
      label: 'Related record',
      type: 'select',
      options: [{ value: 'static', label: 'Static choice' }],
      loadOptions: async () => { throw new Error('[internal] Options unavailable') },
    }]
    renderWithProviders(<CrudForm fields={fields} initialValues={{ target: 'static' }} onSubmit={() => {}} />, { dict })

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load options')
    const select = screen.getByRole('combobox', { name: 'Related record' })
    expect(select).toBeEnabled()
    expect(select).toHaveTextContent('Static choice')
  })

  it('distinguishes a successful empty lookup from a failure', async () => {
    renderWithProviders(
      <CrudForm fields={fieldsFor(async () => [])} onSubmit={() => {}} />,
      { dict },
    )
    expect(await screen.findByText('No options available.')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Related record' })).toBeEnabled()
  })

  it('ignores a superseded loader rejection after the new target loads', async () => {
    let rejectOld: (reason: Error) => void = () => {}
    const oldRequest = new Promise<CrudFieldOption[]>((_resolve, reject) => { rejectOld = reject })
    const { rerender } = renderWithProviders(
      <CrudForm fields={fieldsFor(() => oldRequest)} onSubmit={() => {}} />,
      { dict },
    )
    rerender(<CrudForm fields={fieldsFor(async () => [{ value: 'new', label: 'New target' }])} onSubmit={() => {}} />)
    await waitFor(() => expect(screen.queryByText('Loading options…')).not.toBeInTheDocument())
    await act(async () => { rejectOld(new Error('[internal] Previous target forbidden')) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Related record' })).toBeEnabled()
  })
})
