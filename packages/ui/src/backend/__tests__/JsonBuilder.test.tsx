/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { JsonBuilder } from '../JsonBuilder'

// Radix Select uses pointer capture / scrollIntoView APIs that jsdom doesn't implement.
// The confirm dialog uses the native <dialog> showModal/close APIs. Polyfill both so the
// component can be exercised end to end (issue #2817).
if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => undefined
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined
  }
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open')
    },
  })
}

function ControlledHarness({ initial = {} as any }: { initial?: any }) {
  const [value, setValue] = React.useState<any>(initial)
  // Inline onChange recreated each render — mirrors how WebhookCustomHeadersField
  // wires the builder. A stale effect dependency on this identity is what made
  // Raw JSON uneditable before the fix.
  return (
    <>
      <JsonBuilder value={value} onChange={(next) => setValue(next)} />
      <div data-testid="value">{JSON.stringify(value)}</div>
    </>
  )
}

describe('JsonBuilder', () => {
  it('lets the user type JSON in Raw mode without clobbering the text', () => {
    renderWithProviders(<ControlledHarness />)

    const textarea = screen.getByPlaceholderText('{"key": "value"}') as HTMLTextAreaElement

    act(() => {
      fireEvent.change(textarea, { target: { value: '{"a":"1"}' } })
    })

    // The exact typed text is preserved (not reformatted/reset by a value echo).
    expect(textarea.value).toBe('{"a":"1"}')
    // ...and the parsed object propagated to the parent.
    expect(screen.getByTestId('value').textContent).toBe('{"a":"1"}')
  })

  it('mirrors an external value into the Raw textarea until the user edits it', () => {
    function ExternalHarness() {
      const [value, setValue] = React.useState<any>({})
      return (
        <>
          <button type="button" onClick={() => setValue({ injected: 'hello' })}>
            load
          </button>
          <JsonBuilder value={value} onChange={setValue} />
        </>
      )
    }

    renderWithProviders(<ExternalHarness />)
    const textarea = screen.getByPlaceholderText('{"key": "value"}') as HTMLTextAreaElement

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'load' }))
    })

    expect(textarea.value).toContain('injected')
    expect(textarea.value).toContain('hello')
  })

  async function openBuilderAndChangeRootType() {
    renderWithProviders(<ControlledHarness initial={{ foo: 'bar' }} />)

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Builder' }))
    })

    const rootTrigger = screen
      .getAllByRole('combobox')
      .find((element) => element.textContent?.trim() === 'Object')
    expect(rootTrigger).toBeDefined()

    fireEvent.pointerDown(rootTrigger!, { button: 0, ctrlKey: false })
    fireEvent.click(rootTrigger!)

    const stringOption = screen.getByRole('option', { name: 'String' })
    await act(async () => {
      fireEvent.pointerDown(stringOption)
      fireEvent.click(stringOption)
    })
  }

  it('asks for confirmation before a destructive root type change and preserves data on cancel', async () => {
    await openBuilderAndChangeRootType()

    const cancelButton = await screen.findByRole('button', { name: 'Cancel' })
    await act(async () => {
      fireEvent.click(cancelButton)
    })

    // Cancelling leaves the configured properties intact.
    expect(screen.getByTestId('value').textContent).toBe('{"foo":"bar"}')
  })

  it('discards data only after the destructive root type change is confirmed', async () => {
    await openBuilderAndChangeRootType()

    const confirmButton = await screen.findByRole('button', { name: 'Discard and change' })
    await act(async () => {
      fireEvent.click(confirmButton)
    })

    await waitFor(() => {
      expect(screen.getByTestId('value').textContent).toBe('""')
    })
  })
})
