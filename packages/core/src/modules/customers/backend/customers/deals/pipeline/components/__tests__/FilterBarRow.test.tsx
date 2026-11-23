/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

import { ChipButton } from '../ChipButton'
import { FilterBarRow } from '../FilterBarRow'

describe('ChipButton', () => {
  it('shows only its name until a filter is set, and keeps the value in the accessible name', () => {
    render(<ChipButton label="Status" value="All" />)

    const chip = screen.getByRole('button', { name: 'Status: All' })
    expect(chip.textContent).toBe('Status')
  })

  it('shows the chosen value once the filter is set', () => {
    render(<ChipButton label="Status" value="Open" active />)

    const chip = screen.getByRole('button', { name: 'Status: Open' })
    expect(chip.textContent).toBe('Status:Open')
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('never shrinks, so the row scrolls instead of squeezing chips', () => {
    render(<ChipButton label="Pipeline" value="A very long pipeline name" active />)

    expect(screen.getByRole('button').className).toContain('shrink-0')
  })
})

describe('FilterBarRow', () => {
  function renderRow() {
    render(
      <FilterBarRow
        leadingChips={<ChipButton label="Status" value="All" />}
        chips={[{ id: 'owner', label: 'Owner', value: 'Any' }]}
        sortNode={<ChipButton label="Sort" value="Updated" />}
        onChipClick={jest.fn()}
      />,
    )
    return screen.getByRole('group', { name: 'Filter' })
  }

  it('names the filter group for assistive tech without printing a label', () => {
    const group = renderRow()

    expect(group.textContent).toBe('StatusOwner')
    expect(screen.queryByText(/Filter:?$/)).toBeNull()
  })

  it('keeps the filters on one line and scrolls sideways when they do not fit', () => {
    const group = renderRow()

    expect(group.className).toContain('flex-nowrap')
    expect(group.className).toContain('overflow-x-auto')
    expect(group.className).not.toContain('flex-wrap')
  })

  it('pins the sort control outside the scrolling group', () => {
    const group = renderRow()
    const sort = screen.getByRole('button', { name: 'Sort: Updated' })

    expect(group.contains(sort)).toBe(false)
    expect(sort.parentElement?.className).toContain('shrink-0')
  })

  it('offers a visible control to reach filters that are clipped', () => {
    const group = renderRow()
    expect(screen.queryByRole('button', { name: 'Scroll right' })).toBeNull()

    const scrollBy = jest.fn()
    Object.defineProperty(group, 'scrollWidth', { configurable: true, value: 600 })
    Object.defineProperty(group, 'clientWidth', { configurable: true, value: 300 })
    Object.defineProperty(group, 'scrollBy', { configurable: true, value: scrollBy })
    fireEvent.scroll(group)

    const scrollRight = screen.getByRole('button', { name: 'Scroll right' })
    expect(screen.queryByRole('button', { name: 'Scroll left' })).toBeNull()
    expect(group.contains(scrollRight)).toBe(false)

    fireEvent.click(scrollRight)
    expect(scrollBy).toHaveBeenCalledWith({ left: 180, behavior: 'smooth' })
  })
})
