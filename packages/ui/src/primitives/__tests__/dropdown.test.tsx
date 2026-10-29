import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../button'
import { Dropdown, DropdownContent, DropdownInput, DropdownItem, DropdownList, DropdownEmpty, DropdownTrigger } from '../dropdown'

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}

function Picker({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState('')
  return <I18nProvider locale="en" dict={{}}>
    <Dropdown open={open} onOpenChange={setOpen}>
      <DropdownTrigger asChild><Button>Choose</Button></DropdownTrigger>
      <DropdownContent>
        <DropdownInput aria-label="Search" />
        <DropdownList>
          <DropdownEmpty>No results</DropdownEmpty>
          <DropdownItem value="alpha" disabled={disabled} onSelect={() => { setValue('Alpha'); setOpen(false) }}>Alpha</DropdownItem>
          <DropdownItem value="beta" onSelect={() => { setValue('Beta'); setOpen(false) }}>Beta</DropdownItem>
        </DropdownList>
      </DropdownContent>
    </Dropdown>
    <output>{value}</output>
  </I18nProvider>
}

describe('Dropdown', () => {
  it('filters options, clears to recover, then selects and returns focus to its trigger', async () => {
    render(<Picker />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }))
    const input = screen.getByRole('combobox', { name: 'Search' })
    fireEvent.change(input, { target: { value: 'zzzz' } })
    await waitFor(() => expect(screen.getByText('No results')).toBeVisible())
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    await waitFor(() => expect(screen.getByRole('option', { name: 'Beta' })).toBeVisible())
    expect(input).toHaveFocus()
    fireEvent.click(screen.getByRole('option', { name: 'Beta' }))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Beta')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose' })).toHaveFocus())
  })

  it('skips disabled choices during keyboard selection', async () => {
    render(<Picker disabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }))
    const input = screen.getByRole('combobox', { name: 'Search' })
    await waitFor(() => expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true'))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('status')).toHaveTextContent('Beta')
  })
})
