/** @jest-environment jsdom */
jest.setTimeout(15000)

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: jest.fn() }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

// A custom field renders its own control, so the wrapper <label> cannot point
// at it with `for`. Components that forward `labelId` name themselves; most do
// not, and a route sweep found their controls without any accessible name on
// seventeen pages. When a custom field holds exactly one control that has no
// name of its own, the form names it by the field label.
describe('CrudForm names the unnamed control of a custom field', () => {
  function renderForm(field: Partial<CrudField> & { component: NonNullable<CrudField['component']> }) {
    const result = renderWithProviders(
      <CrudForm title="Form" fields={[{ id: 'parentId', label: 'Parent', type: 'custom', ...field } as CrudField]} onSubmit={() => {}} />,
      { dict: {} },
    )
    const label = result.container.querySelector('[data-crud-field-id="parentId"] label') as HTMLLabelElement
    return { ...result, label }
  }

  it('names a native select by the field label', async () => {
    const { label } = renderForm({ component: () => <select><option value="">None</option></select> })

    const select = await screen.findByRole('combobox', { name: 'Parent' })
    expect(select).toHaveAttribute('aria-labelledby', label.id)
  })

  it('names a text input, and does not treat its placeholder as a name', async () => {
    renderForm({ component: () => <input type="text" placeholder="Search customers…" /> })

    expect(await screen.findByRole('textbox', { name: 'Parent' })).toBeInTheDocument()
  })

  it('names a select trigger and ignores the hidden native select next to it', async () => {
    renderForm({
      component: () => (
        <div>
          <button type="button" role="combobox" aria-expanded={false} aria-controls="parent-options"><span>Select…</span></button>
          <select aria-hidden="true" tabIndex={-1}><option value="">None</option></select>
        </div>
      ),
    })

    expect(await screen.findByRole('combobox', { name: 'Parent' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('names a switch that has no text of its own', async () => {
    renderForm({ component: () => <button type="button" role="switch" aria-checked={false} /> })

    expect(await screen.findByRole('switch', { name: 'Parent' })).toBeInTheDocument()
  })

  it('names the one unnamed control when the others already have a name', async () => {
    renderForm({
      component: () => (
        <div>
          <button type="button" role="combobox" aria-expanded={false} aria-controls="codes" aria-label="Country code" />
          <input type="tel" placeholder="+00 000 000 000" />
        </div>
      ),
    })

    expect(await screen.findByRole('textbox', { name: 'Parent' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Country code' })).not.toHaveAttribute('aria-labelledby')
  })

  it('leaves a control alone when it already has a name', async () => {
    renderForm({ component: () => <input type="text" aria-label="Parent category" /> })

    await act(async () => { await Promise.resolve() })
    const input = screen.getByRole('textbox', { name: 'Parent category' })
    expect(input).not.toHaveAttribute('aria-labelledby')
  })

  it('does not guess when several controls are unnamed', async () => {
    const { container } = renderForm({
      component: () => (
        <div>
          <input type="text" data-testid="first" />
          <input type="text" data-testid="second" />
        </div>
      ),
    })

    await act(async () => { await Promise.resolve() })
    expect(container.querySelectorAll('[data-crud-field-id="parentId"] [aria-labelledby]')).toHaveLength(0)
  })

  it('names a control the field mounts later', async () => {
    function Deferred() {
      const [ready, setReady] = React.useState(false)
      React.useEffect(() => { setReady(true) }, [])
      return ready ? <select><option value="">None</option></select> : <span>Loading</span>
    }
    renderForm({ component: () => <Deferred /> })

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Parent' })).toBeInTheDocument())
  })

  it('does nothing for a field without a visible label', async () => {
    const { container } = renderForm({ label: '', component: () => <select><option value="">None</option></select> })

    await act(async () => { await Promise.resolve() })
    expect(container.querySelector('[data-crud-field-id="parentId"] select')).not.toHaveAttribute('aria-labelledby')
  })
})
