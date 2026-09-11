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
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

const dict = { 'ui.forms.actions.save': 'Save' }
const fields: CrudField[] = [{ id: 'amount', label: 'Amount', type: 'number' }]

// The locale is pinned to one that does NOT use a dot decimal separator, because an
// en-US pin passes on the buggy implementation too.
function renderNumberForm(locale: string, onSubmit: (values: Record<string, unknown>) => void) {
  return renderWithProviders(
    <CrudForm title="Form" fields={fields} onSubmit={onSubmit} />,
    { locale, dict },
  )
}

function amountInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('[data-crud-field-id="amount"] input')
  expect(input).not.toBeNull()
  return input as HTMLInputElement
}

async function submitWith(container: HTMLElement, typed: string) {
  const input = amountInput(container)
  await act(async () => {
    fireEvent.change(input, { target: { value: typed } })
  })
  await act(async () => {
    fireEvent.blur(input)
  })
  await act(async () => {
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
  })
}

describe('CrudForm number fields accept the locale decimal separator (issue #5552)', () => {
  it('does not render a type="number" input, whose value the browser sanitizes per BROWSER locale', () => {
    const { container } = renderNumberForm('pl', () => {})
    const input = amountInput(container)
    // A type="number" input discards `110,70` before React sees it when the browser
    // locale differs from the application locale — the original defect.
    expect(input.getAttribute('type')).toBe('text')
    expect(input.getAttribute('inputMode')).toBe('decimal')
  })

  it('commits a comma-typed value as the number the UI displays under a Polish locale', async () => {
    const onSubmit = jest.fn()
    const { container } = renderNumberForm('pl', onSubmit)

    await submitWith(container, '110,70')

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].amount).toBe(110.7)
  })

  it('still accepts a dot under a comma-decimal locale, so the existing input keeps working', async () => {
    const onSubmit = jest.fn()
    const { container } = renderNumberForm('pl', onSubmit)

    await submitWith(container, '110.70')

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].amount).toBe(110.7)
  })

  it('commits a dot-typed value under an English locale', async () => {
    const onSubmit = jest.fn()
    const { container } = renderNumberForm('en', onSubmit)

    await submitWith(container, '2.5')

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].amount).toBe(2.5)
  })

  it('keeps a half-typed decimal in the box on the way to a complete one', async () => {
    const { container } = renderNumberForm('pl', () => {})
    const input = amountInput(container)

    await act(async () => {
      fireEvent.focus(input)
    })
    // `110,` is not yet the final value; the local buffer has to survive the round trip
    // through the form state so the user can finish typing.
    await act(async () => {
      fireEvent.change(input, { target: { value: '110,' } })
    })
    expect(input.value).toBe('110,')

    await act(async () => {
      fireEvent.change(input, { target: { value: '110,70' } })
    })
    expect(input.value).toBe('110,70')
  })

  it('steps the value with the arrow keys, writing back the separator the locale displays', async () => {
    const onSubmit = jest.fn()
    const { container } = renderNumberForm('pl', onSubmit)
    const input = amountInput(container)

    await act(async () => {
      fireEvent.change(input, { target: { value: '4,5' } })
    })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'ArrowUp' })
    })
    // A dot here would contradict the separator the rest of the Polish UI shows, which is
    // the complaint issue #5552 opened with.
    expect(input.value).toBe('5,5')

    await act(async () => {
      fireEvent.keyDown(input, { key: 'ArrowDown' })
    })
    expect(input.value).toBe('4,5')
  })

  it('does not commit a binary floating point artifact when stepping', async () => {
    const onSubmit = jest.fn()
    const { container } = renderNumberForm('pl', onSubmit)
    const input = amountInput(container)

    await act(async () => {
      fireEvent.change(input, { target: { value: '8,2' } })
    })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'ArrowDown' })
    })
    // 8.2 - 1 is 7.199999999999999 in binary floating point, and onChange puts whatever
    // this commits straight into the submitted form value.
    expect(input.value).toBe('7,2')

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].amount).toBe(7.2)
  })
})
