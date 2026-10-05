/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../primitives/dialog'
import { TagsInput } from '../TagsInput'

const escapeSuggestions = [{ value: 'user-admin', label: 'admin@acme.com' }]

describe('TagsInput', () => {
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

  describe('Escape on the suggestions list', () => {
    it('closes only the suggestions and keeps Escape away from the host', () => {
      const onHostKeyDown = jest.fn()

      renderWithProviders(
        <div onKeyDown={onHostKeyDown}>
          <TagsInput value={[]} onChange={jest.fn()} suggestions={escapeSuggestions} />
        </div>,
      )

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'adm' } })
      expect(screen.getByRole('button', { name: /admin@acme\.com/ })).toBeInTheDocument()

      fireEvent.keyDown(input, { key: 'Escape' })

      expect(screen.queryByRole('button', { name: /admin@acme\.com/ })).not.toBeInTheDocument()
      expect(onHostKeyDown).not.toHaveBeenCalled()
      expect(input).toHaveValue('adm')
    })

    it('lets Escape reach the host once the suggestions are closed', () => {
      const onHostKeyDown = jest.fn()

      renderWithProviders(
        <div onKeyDown={(event) => onHostKeyDown(event.key)}>
          <TagsInput value={[]} onChange={jest.fn()} suggestions={escapeSuggestions} />
        </div>,
      )

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'adm' } })
      fireEvent.keyDown(input, { key: 'Escape' })
      fireEvent.keyDown(input, { key: 'Escape' })

      expect(onHostKeyDown).toHaveBeenCalledTimes(1)
      expect(onHostKeyDown).toHaveBeenCalledWith('Escape')
    })

    it('reopens the suggestions when the user keeps typing', () => {
      renderWithProviders(
        <TagsInput value={[]} onChange={jest.fn()} suggestions={escapeSuggestions} />,
      )

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'adm' } })
      fireEvent.keyDown(input, { key: 'Escape' })
      fireEvent.change(input, { target: { value: 'admi' } })

      expect(screen.getByRole('button', { name: /admin@acme\.com/ })).toBeInTheDocument()
    })

    it('keeps an enclosing dialog open', () => {
      const onOpenChange = jest.fn()

      renderWithProviders(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>Compose</DialogTitle>
            <DialogDescription>Compose a message.</DialogDescription>
            <TagsInput value={[]} onChange={jest.fn()} suggestions={escapeSuggestions} />
          </DialogContent>
        </Dialog>,
      )

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'adm' } })
      fireEvent.keyDown(input, { key: 'Escape' })

      expect(screen.queryByRole('button', { name: /admin@acme\.com/ })).not.toBeInTheDocument()
      expect(onOpenChange).not.toHaveBeenCalled()

      fireEvent.keyDown(input, { key: 'Escape' })

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })
})
