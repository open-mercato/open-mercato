/** @jest-environment jsdom */

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

    const input = screen.getByRole('combobox') as HTMLInputElement
    expect(input.value).toBe('Red')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')

    blurAndFlush(input)

    expect(input.value).toBe('Red')
    expect(screen.getByTestId('value')).toHaveTextContent('red')
    expect(onChange).not.toHaveBeenCalled()
  })

  // Display text that matches what the user typed is not proof the value was committed: an
  // unselected query renders identically to a picked option's label until blur resolves it.
  // Playwright helpers that assert only `toHaveValue(typedText)` before blur therefore report
  // success on a field the form never received, so the blur-clear below is the observable
  // signal they must key on.
  it('leaves the value uncommitted and clears the input on blur when the typed text matches no option', () => {
    const onChange = jest.fn()
    render(<Harness allowCustomValues={false} onChange={onChange} />)

    const input = screen.getByRole('combobox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Blue' } })
    expect(input.value).toBe('Blue')

    blurAndFlush(input)

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('value')).toHaveTextContent('')
    expect(input.value).toBe('')
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

    const input = screen.getByRole('combobox') as HTMLInputElement
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

    const input = screen.getByRole('combobox') as HTMLInputElement
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

  it('shows a default value that arrives after autoFocus already took the field', async () => {
    const options = [{ value: 'wh-1', label: 'Central warehouse' }]
    const { container, rerender } = render(
      <ComboboxInput value="" onChange={() => {}} autoFocus seedOptions={options} />,
    )
    expect(document.activeElement).toBe(getInput(container))
    rerender(<ComboboxInput value="wh-1" onChange={() => {}} autoFocus seedOptions={options} />)
    await waitFor(() => expect(getInput(container).value).toBe('Central warehouse'))
  })

  // Guards the opposite direction of the case above: it passes on both the old
  // focus-based guard and the current typing-based one, so it is a behavior pin
  // rather than a regression test for any specific bug.
  it('does not overwrite the query while the user is typing into a focused field', async () => {
    const options = [
      { value: 'red', label: 'Red' },
      { value: 'green', label: 'Green' },
    ]
    const { container, rerender } = render(
      <ComboboxInput value="red" onChange={() => {}} seedOptions={options} />,
    )
    await waitFor(() => expect(getInput(container).value).toBe('Red'))
    const input = getInput(container)
    act(() => {
      input.focus()
      fireEvent.change(input, { target: { value: 'gre' } })
    })
    rerender(<ComboboxInput value="green" onChange={() => {}} seedOptions={options} />)
    expect(getInput(container).value).toBe('gre')
  })

  // The regression the typing-based guard originally introduced: `selectValue` clears
  // `userTypedRef` while the field keeps focus, so a follow-up load that no longer
  // carries the picked option let the self-mapping placeholder overwrite the label with
  // the raw record id. Fails on the intermediate implementation, passes on this one.
  it('keeps a picked label when a follow-up load drops the option from the list', async () => {
    const loadSuggestions = jest.fn(async (query?: string) =>
      query === 'WH-B' ? [{ value: 'wh-b', label: 'Warehouse B (WH-B)' }] : [],
    )
    function Controlled() {
      const [value, setValue] = React.useState('')
      return (
        <ComboboxInput
          value={value}
          onChange={setValue}
          loadSuggestions={loadSuggestions}
          allowCustomValues={false}
        />
      )
    }
    const { container } = render(<Controlled />)
    const input = getInput(container)
    act(() => {
      input.focus()
      fireEvent.change(input, { target: { value: 'WH-B' } })
    })

    const option = await screen.findByRole('option', { name: /Warehouse B \(WH-B\)/ })
    act(() => {
      fireEvent.click(option)
    })
    expect(getInput(container).value).toBe('Warehouse B (WH-B)')
    expect(document.activeElement).toBe(getInput(container))

    // Picking rewrote the query to the label, which re-fires the debounced loader; the
    // route cannot match a composite label, so the option list comes back empty.
    await waitFor(() => expect(loadSuggestions).toHaveBeenCalledWith('Warehouse B (WH-B)'))
    await act(async () => {
      await new Promise((res) => setTimeout(res, 250))
    })
    expect(getInput(container).value).toBe('Warehouse B (WH-B)')
  })

  it('adopts a real label that arrives while the field is focused', async () => {
    const { container, rerender } = render(
      <ComboboxInput value="wh-1" onChange={() => {}} seedOptions={[]} />,
    )
    const input = getInput(container)
    act(() => {
      input.focus()
    })
    expect(getInput(container).value).toBe('wh-1')

    rerender(
      <ComboboxInput
        value="wh-1"
        onChange={() => {}}
        seedOptions={[{ value: 'wh-1', label: 'Central warehouse' }]}
      />,
    )
    await waitFor(() => expect(getInput(container).value).toBe('Central warehouse'))
  })

  it('does not resurrect the previous label when the parent keeps the value after a clear', () => {
    const onChange = jest.fn()
    const { container } = render(
      <ComboboxInput
        value="red"
        onChange={onChange}
        clearable
        seedOptions={[{ value: 'red', label: 'Red' }]}
      />,
    )
    expect(getInput(container).value).toBe('Red')

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /clear value/i }))
    })

    expect(onChange).toHaveBeenCalledWith('')
    expect(getInput(container).value).toBe('')
  })

  it('resumes syncing after a blur, so a later external change is not mistaken for typing', async () => {
    const options = [
      { value: 'red', label: 'Red' },
      { value: 'green', label: 'Green' },
    ]
    const { container, rerender } = render(
      <ComboboxInput value="red" onChange={() => {}} seedOptions={options} allowCustomValues={false} />,
    )
    const input = getInput(container)
    act(() => {
      input.focus()
      fireEvent.change(input, { target: { value: 'gre' } })
    })
    expect(getInput(container).value).toBe('gre')

    act(() => {
      fireEvent.blur(input)
    })
    await waitFor(() => expect(getInput(container).value).toBe('Red'))

    act(() => {
      getInput(container).focus()
    })
    rerender(
      <ComboboxInput value="green" onChange={() => {}} seedOptions={options} allowCustomValues={false} />,
    )
    await waitFor(() => expect(getInput(container).value).toBe('Green'))
  })
})

describe('ComboboxInput accessibility', () => {
  it('exposes status text separately and reserves listbox for options', () => {
    render(<Harness />)
    const input = screen.getByRole('combobox')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'missing' } })

    expect(screen.getByText(/no matches/i)).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input).not.toHaveAttribute('aria-controls')

    fireEvent.change(input, { target: { value: 're' } })

    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getAllByRole('option')).toHaveLength(2)
    expect(input).toHaveAttribute('aria-controls', listbox.id)
    // The listbox is portaled out of the input's subtree, so aria-activedescendant
    // is only valid while aria-owns makes it a logical descendant.
    expect(input).toHaveAttribute('aria-owns', listbox.id)
    expect(listbox.contains(input)).toBe(false)
  })
})

describe('ComboboxInput suggestion popup placement', () => {
  it('renders the suggestion list outside the field wrapper so an overflow ancestor cannot clip it', () => {
    const { container } = render(<Harness />)
    const input = getInput(container)

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 're' } })

    const listbox = screen.getByRole('listbox')
    expect(container.contains(listbox)).toBe(false)
    expect(document.body.contains(listbox)).toBe(true)
  })

  it('keeps focus on the input while the popup is open', () => {
    const { container } = render(<Harness />)
    const input = getInput(container)

    act(() => {
      input.focus()
      fireEvent.focus(input)
    })
    fireEvent.change(input, { target: { value: 're' } })

    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(document.activeElement).toBe(input)
  })

  it('selects a portaled option by click', () => {
    render(<Harness />)
    const input = screen.getByRole('combobox')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'gre' } })
    fireEvent.click(screen.getByRole('option', { name: /green/i }))

    expect(screen.getByTestId('value')).toHaveTextContent('green')
  })

  it('selects a portaled option by keyboard', () => {
    render(<Harness />)
    const input = screen.getByRole('combobox')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'gre' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByTestId('value')).toHaveTextContent('green')
  })

  it('closes the popup on Escape without letting the key reach an enclosing surface', () => {
    const onSurfaceKeyDown = jest.fn()
    render(
      <div onKeyDown={onSurfaceKeyDown}>
        <Harness />
      </div>,
    )
    const input = screen.getByRole('combobox')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 're' } })
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onSurfaceKeyDown).not.toHaveBeenCalled()
  })

  it('removes the popup from the document once it closes', () => {
    jest.useFakeTimers()
    try {
      render(<Harness />)
      const input = screen.getByRole('combobox')

      fireEvent.focus(input)
      fireEvent.change(input, { target: { value: 're' } })
      expect(document.body.querySelector('[role="listbox"]')).not.toBeNull()

      blurAndFlush(input)

      expect(document.body.querySelector('[role="listbox"]')).toBeNull()
    } finally {
      act(() => {
        jest.runOnlyPendingTimers()
      })
      jest.useRealTimers()
    }
  })
})
