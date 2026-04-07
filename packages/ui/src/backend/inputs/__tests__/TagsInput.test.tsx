import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { TagsInput } from '../TagsInput'

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
})
