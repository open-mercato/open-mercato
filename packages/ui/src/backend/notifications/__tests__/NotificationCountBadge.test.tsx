/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { NotificationCountBadge } from '../NotificationCountBadge'

describe('NotificationCountBadge', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<NotificationCountBadge count={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when count is negative', () => {
    const { container } = render(<NotificationCountBadge count={-1} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the count when count is positive', () => {
    render(<NotificationCountBadge count={4} />)
    expect(screen.getByText('4')).toBeTruthy()
  })

  it('renders 99 as-is', () => {
    render(<NotificationCountBadge count={99} />)
    expect(screen.getByText('99')).toBeTruthy()
  })

  it('renders 99+ when count exceeds 99', () => {
    render(<NotificationCountBadge count={100} />)
    expect(screen.getByText('99+')).toBeTruthy()
  })
})
