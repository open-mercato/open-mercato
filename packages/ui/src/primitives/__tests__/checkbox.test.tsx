/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Checkbox } from '../checkbox'

describe('Checkbox', () => {
  it('does not submit a parent form by default', () => {
    const onSubmit = jest.fn((event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
    })
    const onCheckedChange = jest.fn()

    render(
      <form onSubmit={onSubmit}>
        <Checkbox aria-label="Assignee alice" onCheckedChange={onCheckedChange} />
      </form>,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Assignee alice' })
    expect(checkbox).toHaveAttribute('type', 'button')

    fireEvent.click(checkbox)

    expect(onCheckedChange).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
