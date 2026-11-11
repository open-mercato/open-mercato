/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Switch } from '../switch'

describe('Switch keyboard toggling', () => {
  it.each([' ', 'Enter'])('toggles on a plain %p key press', (key) => {
    const onCheckedChange = jest.fn()
    render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Recurring" />)

    fireEvent.keyDown(screen.getByRole('switch'), { key })

    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it.each([
    ['metaKey', 'Enter'],
    ['ctrlKey', 'Enter'],
    ['altKey', 'Enter'],
    ['ctrlKey', ' '],
  ])('leaves %s+%p to the surrounding shortcut handler', (modifier, key) => {
    const onCheckedChange = jest.fn()
    const onShortcut = jest.fn()
    render(
      <div onKeyDown={(event) => onShortcut(event.defaultPrevented)}>
        <Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Recurring" />
      </div>,
    )

    fireEvent.keyDown(screen.getByRole('switch'), { key, [modifier]: true })

    expect(onCheckedChange).not.toHaveBeenCalled()
    expect(onShortcut).toHaveBeenCalledWith(false)
  })
})
