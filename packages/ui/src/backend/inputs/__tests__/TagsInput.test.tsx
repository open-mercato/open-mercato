import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
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
})
