/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { TagsInput } from '../TagsInput'

describe('TagsInput', () => {
  it('lets suggestion labels and descriptions wrap within an auto-height row', () => {
    renderWithProviders(
      <TagsInput
        value={[]}
        onChange={() => {}}
        suggestions={[{ value: 'agent_orchestrator.agents.run', label: 'Run agents directly', description: 'agent_orchestrator.agents.run' }]}
      />,
    )
    const suggestion = screen.getByRole('button', { name: /Run agents directly/ })
    expect(suggestion).toHaveClass('h-auto', 'shrink-0', 'whitespace-normal', 'gap-0.5')
    expect(screen.getByText('agent_orchestrator.agents.run')).toHaveClass('break-all')
  })

  it('can require explicit selection or Enter without committing a search on blur', () => {
    const onChange = jest.fn()
    renderWithProviders(<TagsInput value={[]} onChange={onChange} commitOnBlur={false} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'search fragment' } })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'sales.*' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(['sales.*'])
  })

  it('preserves commit-on-blur for existing callers', () => {
    const onChange = jest.fn()
    renderWithProviders(<TagsInput value={[]} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'existing behavior' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith(['existing behavior'])
  })

  it('does not add the typed query when selecting a suggestion', () => {
    function Harness() {
      const [value, setValue] = React.useState<string[]>([])

      return (
        <div>
          <TagsInput
            value={value}
            onChange={setValue}
            suggestions={[
              {
                value: 'catalog.product.deleted',
                label: 'Product Deleted',
              },
            ]}
          />
          <output data-testid="value">{JSON.stringify(value)}</output>
        </div>
      )
    }

    renderWithProviders(<Harness />)

    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'prod' } })

    const suggestion = screen.getByRole('button', { name: /Product Deleted/i })
    fireEvent.mouseDown(suggestion)
    fireEvent.blur(input)
    fireEvent.click(suggestion)

    expect(screen.getByTestId('value')).toHaveTextContent('["catalog.product.deleted"]')
    expect(screen.queryByText('prod')).not.toBeInTheDocument()
  })

  it('preserves rapid consecutive inserts before the parent rerenders', () => {
    jest.useFakeTimers()

    function Harness() {
      const [value, setValue] = React.useState<string[]>([])

      const handleChange = React.useCallback((next: string[]) => {
        window.setTimeout(() => {
          setValue(next)
        }, 10)
      }, [])

      return (
        <div>
          <TagsInput value={value} onChange={handleChange} />
          <output data-testid="value">{JSON.stringify(value)}</output>
        </div>
      )
    }

    renderWithProviders(<Harness />)

    const input = screen.getByRole('textbox')
    act(() => {
      fireEvent.change(input, { target: { value: 'first-tag' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.change(input, { target: { value: 'second-tag' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      jest.runAllTimers()
    })

    expect(screen.getByTestId('value')).toHaveTextContent('["first-tag","second-tag"]')

    jest.useRealTimers()
  })

  it('skips loading suggestions on the first programmatic focus when suppressed', async () => {
    jest.useFakeTimers()

    const loadSuggestions = jest.fn().mockResolvedValue([
      { value: 'catalog.product.deleted', label: 'Product Deleted' },
    ])

    function Harness() {
      const [value, setValue] = React.useState<string[]>([])

      return (
        <TagsInput
          value={value}
          onChange={setValue}
          autoFocus
          suppressInitialSuggestionsOnFocus
          loadSuggestions={loadSuggestions}
        />
      )
    }

    const { getByRole } = renderWithProviders(<Harness />)
    const input = getByRole('textbox')

    await act(async () => {
      jest.advanceTimersByTime(300)
      await Promise.resolve()
    })

    expect(loadSuggestions).not.toHaveBeenCalled()

    expect(loadSuggestions).not.toHaveBeenCalled()

    jest.useRealTimers()
  })
})
