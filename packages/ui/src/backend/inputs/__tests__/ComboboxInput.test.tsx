/** @jest-environment jsdom */

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ComboboxInput } from '../ComboboxInput'

type HarnessProps = Partial<React.ComponentProps<typeof ComboboxInput>> & {
  initialValue?: string
}

function Harness({ initialValue = '', onChange, ...rest }: HarnessProps) {
  const [value, setValue] = React.useState(initialValue)
  return (
    <div>
      <ComboboxInput
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange?.(next)
        }}
        suggestions={[
          { value: 'red', label: 'Red' },
          { value: 'green', label: 'Green' },
        ]}
        {...rest}
      />
      <output data-testid="value">{value}</output>
    </div>
  )
}

function getInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input')
  if (!el) throw new Error('input not found')
  return el as HTMLInputElement
}

function blurAndFlush(input: HTMLElement) {
  act(() => {
    fireEvent.blur(input)
  })
  act(() => {
    jest.advanceTimersByTime(250)
  })
}

describe('ComboboxInput clearable behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers()
    })
    jest.useRealTimers()
  })

  it('reverts to current value on blur with empty input when not clearable and custom values disallowed', () => {
    const onChange = jest.fn()
    render(
      <Harness
        initialValue="red"
        clearable={false}
        allowCustomValues={false}
        onChange={onChange}
      />
    )

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('Red')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')

    blurAndFlush(input)

    expect(input.value).toBe('Red')
    expect(screen.getByTestId('value')).toHaveTextContent('red')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('emits empty string on blur with empty input when clearable, regardless of allowCustomValues', () => {
    const onChange = jest.fn()
    render(
      <Harness
        initialValue="red"
        clearable
        allowCustomValues={false}
        onChange={onChange}
      />
    )

    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })

    blurAndFlush(input)

    expect(onChange).toHaveBeenCalledWith('')
    expect(screen.getByTestId('value')).toHaveTextContent('')
    expect(input.value).toBe('')
  })

  it('renders a clear button when clearable and a value is set, and clears via click', () => {
    const onChange = jest.fn()
    render(<Harness initialValue="red" clearable onChange={onChange} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('Red')

    const clearBtn = screen.getByRole('button', { name: /clear value/i })
    fireEvent.click(clearBtn)

    expect(onChange).toHaveBeenCalledWith('')
    expect(screen.getByTestId('value')).toHaveTextContent('')
    expect(input.value).toBe('')
  })

  it('does not render the clear button when clearable is false', () => {
    render(<Harness initialValue="red" clearable={false} />)
    expect(screen.queryByRole('button', { name: /clear value/i })).toBeNull()
  })

  it('does not render the clear button when clearable is true but no value is set', () => {
    render(<Harness initialValue="" clearable />)
    expect(screen.queryByRole('button', { name: /clear value/i })).toBeNull()
  })
})

describe('ComboboxInput — eager label resolution', () => {
  it('renders the raw value when nothing can resolve it', () => {
    const { container } = render(<ComboboxInput value="uuid-123" onChange={() => {}} />)
    expect(getInput(container).value).toBe('uuid-123')
  })

  it('hydrates the label from seedOptions without any interaction', () => {
    const { container } = render(
      <ComboboxInput
        value="uuid-123"
        onChange={() => {}}
        seedOptions={[{ value: 'uuid-123', label: 'Acme Corp' }]}
      />,
    )
    expect(getInput(container).value).toBe('Acme Corp')
  })

  it('resolves the label via resolveLabel (async) on mount', async () => {
    const resolveLabel = jest.fn(async (value: string) => `Resolved ${value}`)
    const { container } = render(
      <ComboboxInput value="uuid-123" onChange={() => {}} resolveLabel={resolveLabel} />,
    )
    expect(getInput(container).value).toBe('uuid-123')
    await waitFor(() => expect(getInput(container).value).toBe('Resolved uuid-123'))
    expect(resolveLabel).toHaveBeenCalledWith('uuid-123')
    expect(resolveLabel).toHaveBeenCalledTimes(1)
  })

  it('resolves the label via a synchronous resolveLabel', async () => {
    const { container } = render(
      <ComboboxInput
        value="uuid-123"
        onChange={() => {}}
        resolveLabel={(value) => (value === 'uuid-123' ? 'Sync Label' : value)}
      />,
    )
    await waitFor(() => expect(getInput(container).value).toBe('Sync Label'))
  })

  it('swallows synchronous throws from resolveLabel', async () => {
    const resolveLabel = jest.fn(() => {
      throw new Error('boom')
    })

    const { container } = render(
      <ComboboxInput value="uuid-123" onChange={() => {}} resolveLabel={resolveLabel} />,
    )

    await waitFor(() => expect(resolveLabel).toHaveBeenCalledWith('uuid-123'))
    expect(getInput(container).value).toBe('uuid-123')
  })

  it('does not call resolveLabel when the value is already covered by suggestions', () => {
    const resolveLabel = jest.fn(() => 'should-not-be-used')
    render(
      <ComboboxInput
        value="uuid-123"
        onChange={() => {}}
        suggestions={[{ value: 'uuid-123', label: 'Already Known' }]}
        resolveLabel={resolveLabel}
      />,
    )
    expect(resolveLabel).not.toHaveBeenCalled()
  })

  it('falls back to loadSuggestions() (no query) when resolveLabel is absent', async () => {
    const loadSuggestions = jest.fn(async () => [{ value: 'uuid-123', label: 'From Loader' }])
    const { container } = render(
      <ComboboxInput value="uuid-123" onChange={() => {}} loadSuggestions={loadSuggestions} />,
    )
    await waitFor(() => expect(getInput(container).value).toBe('From Loader'))
    expect(loadSuggestions).toHaveBeenCalledWith()
  })

  it('swallows synchronous throws from loadSuggestions', async () => {
    jest.useFakeTimers()
    const loadSuggestions = jest.fn(() => {
      throw new Error('boom')
    })

    try {
      const { container } = render(
        <ComboboxInput value="" onChange={() => {}} loadSuggestions={loadSuggestions} />,
      )
      const input = getInput(container)

      act(() => {
        fireEvent.focus(input)
        fireEvent.change(input, { target: { value: 'a' } })
      })

      await act(async () => {
        jest.advanceTimersByTime(200)
      })

      await waitFor(() => expect(loadSuggestions).toHaveBeenCalledWith('a'))
      expect(getInput(container).value).toBe('a')
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not reload suggestions after a self-labeled value is covered', async () => {
    const loadSuggestions = jest.fn(async () => [{ value: 'UTC', label: 'UTC' }])
    const { container } = render(
      <ComboboxInput value="UTC" onChange={() => {}} loadSuggestions={loadSuggestions} />,
    )

    await waitFor(() => expect(loadSuggestions).toHaveBeenCalledTimes(1))
    // flush microtask queue to let any pending effects settle
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect(loadSuggestions).toHaveBeenCalledTimes(1)
    expect(getInput(container).value).toBe('UTC')
  })

  it('does not loop when the first suggestions page cannot resolve the value', async () => {
    const loadSuggestions = jest.fn(async () => [{ value: 'Europe/Warsaw', label: 'Europe/Warsaw' }])
    const { container } = render(
      <ComboboxInput value="UTC" onChange={() => {}} loadSuggestions={loadSuggestions} />,
    )

    await waitFor(() => expect(loadSuggestions).toHaveBeenCalledTimes(1))
    await act(async () => { await Promise.resolve() })
    await act(async () => { await Promise.resolve() })

    expect(loadSuggestions).toHaveBeenCalledTimes(1)
    expect(getInput(container).value).toBe('UTC')
  })

  it('keeps the popup open when blur happens while async suggestions are still loading', async () => {
    let resolveSuggestions: (items: Array<string | { value: string; label: string }>) => void = () => {}
    const loadSuggestions = jest.fn(
      () =>
        new Promise<Array<string | { value: string; label: string }>>((resolve) => {
          resolveSuggestions = resolve
        }),
    )

    const { container, queryByText } = render(
      <div>
        <ComboboxInput value="" onChange={() => {}} loadSuggestions={loadSuggestions} />
      </div>,
    )
    const input = getInput(container)

    act(() => {
      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 'a' } })
      fireEvent.blur(input)
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 225))
    })

    expect(loadSuggestions).toHaveBeenCalledWith('a')
    await waitFor(() => expect(queryByText(/Loading suggestions/i)).toBeTruthy())

    await act(async () => {
      resolveSuggestions([{ value: 'acme', label: 'Acme Corp' }])
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

    await waitFor(() => expect(queryByText(/Loading suggestions/i)).toBeNull())
    await waitFor(() => expect(queryByText('Acme Corp')).toBeNull())
  })

  it('closes the popup after a bounded delay when async suggestions never finish', async () => {
    jest.useFakeTimers()
    const loadSuggestions = jest.fn(
      () => new Promise<Array<string | { value: string; label: string }>>(() => {}),
    )

    try {
      const { container, queryByText } = render(
        <ComboboxInput value="" onChange={() => {}} loadSuggestions={loadSuggestions} />,
      )
      const input = getInput(container)

      act(() => {
        fireEvent.focus(input)
        fireEvent.change(input, { target: { value: 'a' } })
        fireEvent.blur(input)
      })

      await act(async () => {
        jest.advanceTimersByTime(450)
      })

      expect(loadSuggestions).toHaveBeenCalledWith('a')
      expect(queryByText(/Loading suggestions/i)).toBeTruthy()

      await act(async () => {
        jest.advanceTimersByTime(1001)
      })

      expect(queryByText(/Loading suggestions/i)).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  it('keeps the resolved label after a blur revert when custom values are disallowed', async () => {
    const onChange = jest.fn()
    const { container } = render(
      <ComboboxInput
        value="uuid-123"
        onChange={onChange}
        allowCustomValues={false}
        resolveLabel={async () => 'Acme Corp'}
      />,
    )
    await waitFor(() => expect(getInput(container).value).toBe('Acme Corp'))
    const input = getInput(container)
    act(() => {
      fireEvent.change(input, { target: { value: 'partial typing' } })
      fireEvent.blur(input)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250))
    })
    expect(getInput(container).value).toBe('Acme Corp')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not bake a placeholder back into the input on blur while resolution is pending', async () => {
    let resolve: (label: string) => void = () => {}
    const resolveLabel = jest.fn(
      () => new Promise<string>((res) => { resolve = res }),
    )
    const { container } = render(
      <ComboboxInput
        value="uuid-123"
        onChange={() => {}}
        allowCustomValues={false}
        resolveLabel={resolveLabel}
      />,
    )
    const input = getInput(container)
    act(() => {
      fireEvent.change(input, { target: { value: '' } })
      fireEvent.blur(input)
    })
    await act(async () => {
      await new Promise((res) => setTimeout(res, 250))
    })
    expect(getInput(container).value).not.toBe('uuid-123')
    act(() => resolve('Acme Corp'))
    await waitFor(() => expect(getInput(container).value).toBe('Acme Corp'))
  })

  it('updates the displayed label when the value changes to one resolvable via resolveLabel', async () => {
    const resolveLabel = jest.fn(async (value: string) => `Label-${value}`)
    const { container, rerender } = render(
      <ComboboxInput value="a" onChange={() => {}} resolveLabel={resolveLabel} />,
    )
    await waitFor(() => expect(getInput(container).value).toBe('Label-a'))
    rerender(<ComboboxInput value="b" onChange={() => {}} resolveLabel={resolveLabel} />)
    await waitFor(() => expect(getInput(container).value).toBe('Label-b'))
  })

  // Regression: onFocus used to flip `loading` true before the debounce
  // timer armed. When `loadSuggestions` identity churned within the 200ms
  // window (common when a parent re-renders and recreates an inline
  // callback), the effect cleanup cancelled the timer without clearing
  // `loading`, so the popup stayed on "Loading suggestions…" forever with
  // no request in flight. Cleanup now clears `loading`, and onFocus no
  // longer sets it.
  it('does not stick on Loading suggestions when loadSuggestions identity churns before debounce fires', async () => {
    jest.useFakeTimers()
    const loadA = jest.fn(async () => [{ value: 'lot-a', label: 'LOT-A' }])
    const loadB = jest.fn(async () => [{ value: 'lot-b', label: 'LOT-B' }])

    try {
      const { container, rerender, queryByText } = render(
        <ComboboxInput value="" onChange={() => {}} loadSuggestions={loadA} />,
      )
      const input = getInput(container)

      act(() => {
        fireEvent.focus(input)
      })

      // Churn the callback identity inside the 200ms debounce window — the
      // classic parent-rerender footgun — before any fetch has started.
      rerender(<ComboboxInput value="" onChange={() => {}} loadSuggestions={loadB} />)
      rerender(<ComboboxInput value="" onChange={() => {}} loadSuggestions={loadA} />)
      rerender(<ComboboxInput value="" onChange={() => {}} loadSuggestions={loadB} />)

      await act(async () => {
        jest.advanceTimersByTime(200)
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(queryByText(/Loading suggestions/i)).toBeNull()
      expect(queryByText('LOT-B')).toBeTruthy()
      expect(loadA).not.toHaveBeenCalled()
      expect(loadB).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  // Regression for a "stuck on Loading suggestions…" report in the WMS cycle
  // count wizard's Lot field: `disabled` there is tied to an unrelated
  // balance lookup that re-triggers on every lot pick, so it can flip true
  // while the debounced suggestion fetch for the *same* field is still in
  // flight. Before the fix, `disabled` was a dependency of the debounce
  // effect, so this toggle tore down (and, once re-enabled, restarted from
  // scratch) any in-flight fetch — under real network latency that
  // discard-and-restart can keep out-racing the toggle indefinitely, leaving
  // the popup stuck on the loading state forever. Letting the in-flight
  // fetch run to completion regardless of `disabled` fixes it.
  it('does not cancel/restart an in-flight suggestion fetch when disabled toggles mid-flight', async () => {
    jest.useFakeTimers()
    let resolveSuggestions: (items: Array<{ value: string; label: string }>) => void = () => {}
    const loadSuggestions = jest.fn(
      () =>
        new Promise<Array<{ value: string; label: string }>>((resolve) => {
          resolveSuggestions = resolve
        }),
    )

    try {
      const { container, rerender, queryByText } = render(
        <ComboboxInput
          value=""
          onChange={() => {}}
          loadSuggestions={loadSuggestions}
          disabled={false}
        />,
      )
      const input = getInput(container)

      act(() => {
        fireEvent.focus(input)
        fireEvent.change(input, { target: { value: 'lot' } })
      })

      // Let the 200ms debounce fire so the fetch actually starts.
      await act(async () => {
        jest.advanceTimersByTime(200)
      })
      expect(loadSuggestions).toHaveBeenCalledTimes(1)

      // Simulate a sibling field's async lookup disabling this field while
      // the fetch above is still pending — e.g. `loadingBalance` flipping
      // true right after the user picks/scans a value.
      rerender(
        <ComboboxInput
          value=""
          onChange={() => {}}
          loadSuggestions={loadSuggestions}
          disabled
        />,
      )
      rerender(
        <ComboboxInput
          value=""
          onChange={() => {}}
          loadSuggestions={loadSuggestions}
          disabled={false}
        />,
      )

      // The original fetch resolves — it must not have been torn down by the
      // disabled churn above.
      await act(async () => {
        resolveSuggestions([{ value: 'lot-1', label: 'LOT-1' }])
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      // No second fetch was started by the disable/re-enable cycle.
      expect(loadSuggestions).toHaveBeenCalledTimes(1)
      expect(queryByText(/Loading suggestions/i)).toBeNull()
      expect(queryByText('LOT-1')).toBeTruthy()
    } finally {
      jest.useRealTimers()
    }
  })
})
