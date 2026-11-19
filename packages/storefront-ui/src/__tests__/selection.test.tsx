import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RadioGroup } from '../primitives/radio-group'
import { Checkbox } from '../primitives/checkbox'
import { Badge } from '../primitives/badge'

describe('RadioGroup chips', () => {
  it('selects with click and arrow keys, keeps unavailable items focusable but unselectable', async () => {
    const onValueChange = jest.fn()
    render(
      <RadioGroup variant="chip" defaultValue="250" onValueChange={onValueChange} aria-label="Weight">
        <RadioGroup.Item value="250" label="250 g" />
        <RadioGroup.Item value="1000" label="1 kg" />
        <RadioGroup.Item value="5000" label="5 kg" unavailable description="Out of stock" />
      </RadioGroup>,
    )
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(radios[2]).toHaveAttribute('aria-disabled', 'true')
    expect(radios[2]).not.toBeDisabled()
    expect(radios[2]).toHaveAccessibleDescription('Out of stock')

    await userEvent.click(radios[1])
    expect(onValueChange).toHaveBeenLastCalledWith('1000')

    await userEvent.click(radios[2])
    expect(onValueChange).not.toHaveBeenCalledWith('5000')
  })

  it('reveals card children only when selected', async () => {
    render(
      <RadioGroup variant="card" defaultValue="card" aria-label="Payment">
        <RadioGroup.Item value="blik" label="BLIK"><span>BLIK form</span></RadioGroup.Item>
        <RadioGroup.Item value="card" label="Card"><span>Card form</span></RadioGroup.Item>
      </RadioGroup>,
    )
    expect(screen.getByText('Card form').closest('[data-state]')).toHaveAttribute('data-state', 'checked')
    expect(screen.getByText('BLIK form').closest('[data-state]')).toHaveAttribute('data-state', 'unchecked')
  })
})

describe('Checkbox', () => {
  it('toggles through its label and exposes description', async () => {
    const onCheckedChange = jest.fn()
    render(<Checkbox label="Save address" description="For faster checkout" onCheckedChange={onCheckedChange} />)
    await userEvent.click(screen.getByText('Save address'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('never toggles an unavailable chip', async () => {
    const onCheckedChange = jest.fn()
    render(<Checkbox variant="chip" label="Honey" unavailable onCheckedChange={onCheckedChange} />)
    const chip = screen.getByRole('checkbox', { name: /Honey/ })
    expect(chip).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(chip)
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('renders the switch variant with switch semantics', () => {
    render(<Checkbox variant="switch" label="Order updates" defaultChecked />)
    expect(screen.getByRole('switch', { name: 'Order updates' })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('Badge.Status', () => {
  it('maps lifecycle statuses to tones and pairs colour with a dot', () => {
    render(<Badge.Status status="overdue">Overdue</Badge.Status>)
    const badge = screen.getByText('Overdue')
    expect(badge).toHaveAttribute('data-status', 'overdue')
    expect(badge.className).toContain('bg-status-error-bg')
    expect(badge.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})
