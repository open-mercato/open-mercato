import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Combobox, type ComboboxItem, type ComboboxProps } from '../primitives/combobox'

const items: ComboboxItem[] = [{ id: 'coffee', label: 'Coffee' }, { id: 'tea', label: 'Tea' }]

function Search({ onSelect, tone }: { onSelect?: (item: ComboboxItem) => void; tone?: ComboboxProps['tone'] }) {
  const [value, setValue] = React.useState('')
  return <Combobox label="Search" tone={tone} value={value} onValueChange={setValue} items={value ? items : []} onSelect={onSelect ?? (() => {})} />
}

describe('Combobox', () => {
  it('opens the list while typing and selects the active option with Enter', async () => {
    const onSelect = jest.fn()
    render(<Search onSelect={onSelect} />)
    const input = screen.getByRole('combobox', { name: 'Search' })
    await userEvent.type(input, 'c')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('option')).toHaveLength(2)
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith(items[0])
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps the bordered field by default', () => {
    render(<Search />)
    const input = screen.getByRole('combobox', { name: 'Search' })
    expect(input).toHaveClass('border-input', 'bg-background')
  })

  it('renders a filled field without a border for the quiet and inverse tones', () => {
    const quiet = render(<Search tone="quiet" />)
    expect(screen.getByRole('combobox', { name: 'Search' })).toHaveClass('border-transparent', 'bg-sf-surface')
    expect(screen.getByRole('combobox', { name: 'Search' })).not.toHaveClass('border-input')
    quiet.unmount()
    render(<Search tone="inverse" />)
    const input = screen.getByRole('combobox', { name: 'Search' })
    expect(input).toHaveClass('border-transparent', 'bg-sf-primary-soft', 'text-primary-foreground')
    expect(input).not.toHaveClass('bg-background', 'text-foreground')
  })
})
