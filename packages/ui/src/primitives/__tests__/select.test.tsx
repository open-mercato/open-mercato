import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectTriggerLeading, SelectValue } from '../select'

describe('Select leading visual', () => {
  it('copies only the option text into the trigger instead of duplicating its explicit visual', async () => {
    render(<Select defaultValue="alpha">
      <SelectTrigger aria-label="Company"><SelectTriggerLeading><img alt="" src="company.png" /></SelectTriggerLeading><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="alpha" leading={<img alt="" src="company.png" />}>Alpha</SelectItem></SelectContent>
    </Select>)
    const trigger = screen.getByRole('combobox', { name: 'Company' })
    await waitFor(() => expect(trigger).toHaveTextContent('Alpha'))
    expect(trigger.querySelectorAll('img')).toHaveLength(1)
    expect(trigger.querySelector('[data-slot="select-item-leading"]')).toBeNull()
  })

  it('preserves controlled values when a parent changes the selection', async () => {
    const content = (value: string) => <Select value={value} onValueChange={() => {}}>
      <SelectTrigger aria-label="Company"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="alpha">Alpha</SelectItem><SelectItem value="beta" leading={<img alt="" src="beta.png" />}>Beta</SelectItem></SelectContent>
    </Select>
    const { rerender } = render(content('alpha'))
    rerender(content('beta'))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Company' })).toHaveTextContent('Beta'))
    expect(screen.getByRole('combobox', { name: 'Company' }).querySelector('img')).toBeNull()
  })
})
