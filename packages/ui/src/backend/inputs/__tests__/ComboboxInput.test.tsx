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

  it('does not reload suggestions after a self-labeled value is covered', async () => {
    const loadSuggestions = jest.fn(async () => [{ value: 'UTC', label: 'UTC' }])
    const { container } = render(
      <ComboboxInput value="UTC" onChange={() => {}} loadSuggestions={loadSuggestions} />,
    )

    await waitFor(() => expect(loadSuggestions).toHaveBeenCalledTimes(1))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

    expect(loadSuggestions).toHaveBeenCalledTimes(1)
    expect(getInput(container).value).toBe('UTC')
  })

  it('does not loop when the first suggestions page cannot resolve the value', async () => {
    const loadSuggestions = jest.fn(async () => [{ value: 'Europe/Warsaw', label: 'Europe/Warsaw' }])
    const { container } = render(
      <ComboboxInput value="UTC" onChange={() => {}} loadSuggestions={loadSuggestions} />,
    )

    await waitFor(() => expect(loadSuggestions).toHaveBeenCalledTimes(1))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

    expect(loadSuggestions).toHaveBeenCalledTimes(1)
    expect(getInput(container).value).toBe('UTC')
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
})
