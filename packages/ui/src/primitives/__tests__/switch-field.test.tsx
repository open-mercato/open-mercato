/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { SwitchField } from '../switch-field'

describe('SwitchField', () => {
  it('exposes an accessible name derived from the label', () => {
    render(<SwitchField label="Also send via email" checked={false} onCheckedChange={() => {}} />)

    expect(screen.getByRole('switch', { name: 'Also send via email' })).toBeInTheDocument()
  })

  it('associates the description text via aria-describedby', () => {
    render(
      <SwitchField
        label="Also send via email"
        description="Recipients will receive an email copy with a secure link."
        checked={false}
        onCheckedChange={() => {}}
      />,
    )

    const control = screen.getByRole('switch', { name: 'Also send via email' })
    const describedById = control.getAttribute('aria-describedby')
    expect(describedById).toBeTruthy()
    expect(screen.getByText('Recipients will receive an email copy with a secure link.')).toHaveAttribute(
      'id',
      describedById,
    )
  })

  it('does not set aria-describedby when there is no description', () => {
    render(<SwitchField label="Also send via email" checked={false} onCheckedChange={() => {}} />)

    expect(screen.getByRole('switch', { name: 'Also send via email' })).not.toHaveAttribute('aria-describedby')
  })
})
