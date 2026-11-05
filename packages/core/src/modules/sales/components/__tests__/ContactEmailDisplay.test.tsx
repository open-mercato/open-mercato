/**
 * @jest-environment jsdom
 *
 * Regression coverage for #4148: on tablet widths the sales document detail view
 * renders its summary cards in a 4-column grid, so the "Primary email" card is
 * narrow. A long address used to overflow and get clipped mid-string because the
 * link was a shrink-to-fit `inline-flex` with no width cap and the label was a
 * flex item at the default `min-width: auto` — so `truncate` never engaged.
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { ContactEmailDisplay } from '../ContactEmailDisplay'

const LONG_EMAIL = 'info@harborviewanalytics.com'

describe('ContactEmailDisplay', () => {
  it('constrains the link so a long address can ellipsize instead of overflowing the card', () => {
    render(<ContactEmailDisplay value={LONG_EMAIL} emptyLabel="Not set" />)

    const link = screen.getByRole('link')
    // Cap the shrink-to-fit link at the card width, otherwise it grows to the
    // full nowrap width of the address and spills out of the card.
    expect(link).toHaveClass('max-w-full')

    const label = screen.getByText(LONG_EMAIL)
    // `truncate` only ellipsizes once the flex item may shrink below its
    // min-content (nowrap) width.
    expect(label).toHaveClass('truncate')
    expect(label).toHaveClass('min-w-0')
  })

  it('keeps the icon from being squeezed once the row is width-capped', () => {
    const { container } = render(<ContactEmailDisplay value={LONG_EMAIL} emptyLabel="Not set" />)

    const icon = container.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveClass('shrink-0')
  })

  it('exposes the full address via mailto and title while truncated', () => {
    render(<ContactEmailDisplay value={LONG_EMAIL} emptyLabel="Not set" />)

    expect(screen.getByRole('link')).toHaveAttribute('href', `mailto:${LONG_EMAIL}`)
    expect(screen.getByText(LONG_EMAIL)).toHaveAttribute('title', LONG_EMAIL)
  })

  it('trims surrounding whitespace before building the mailto link', () => {
    render(<ContactEmailDisplay value={`  ${LONG_EMAIL}  `} emptyLabel="Not set" />)

    expect(screen.getByRole('link')).toHaveAttribute('href', `mailto:${LONG_EMAIL}`)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['blank', '   '],
  ])('renders the empty label and no link when the value is %s', (_label, value) => {
    render(<ContactEmailDisplay value={value} emptyLabel="Not set" />)

    expect(screen.getByText('Not set')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
