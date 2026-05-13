import * as React from 'react'
import { act, render, fireEvent, waitFor } from '@testing-library/react'
import { ComboboxInput } from '../ComboboxInput'

function getInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input')
  if (!el) throw new Error('input not found')
  return el as HTMLInputElement
}

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
    // before the promise resolves, falls back to the raw value
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
    // user clears the field before resolution lands, then blurs
    act(() => {
      fireEvent.change(input, { target: { value: '' } })
      fireEvent.blur(input)
    })
    await act(async () => {
      await new Promise((res) => setTimeout(res, 250))
    })
    // the raw uuid must not have been written into the visible input
    expect(getInput(container).value).not.toBe('uuid-123')
    // once resolution arrives, the label shows up
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
