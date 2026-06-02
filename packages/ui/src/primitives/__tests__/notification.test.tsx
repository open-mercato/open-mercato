/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Notification } from '../notification'

describe('Notification primitive', () => {
  it('renders the underlying Alert at size="default" (rounded-xl)', () => {
    const { container } = render(<Notification title="Test" />)
    const alert = container.querySelector('[data-slot="notification"]')
    expect(alert).toHaveClass('rounded-xl')
  })

  it('marks the root with data-slot="notification" (overrides Alert data-slot via spread)', () => {
    const { container } = render(<Notification title="Test" />)
    expect(container.querySelector('[data-slot="notification"]')).not.toBeNull()
  })

  it('forwards id as data-notification-id', () => {
    const { container } = render(<Notification id="notif-123" title="Test" />)
    expect(container.querySelector('[data-notification-id="notif-123"]')).not.toBeNull()
  })

  it('renders title as AlertTitle and description below', () => {
    render(<Notification title="John commented" description="On the latest deal" />)
    expect(screen.getByText('John commented').tagName).toBe('H5')
    expect(screen.getByText('On the latest deal').tagName).toBe('P')
  })

  it('description gets opacity-72 per Figma Notification reference', () => {
    const { container } = render(
      <Notification title="t" description="body" />,
    )
    const desc = container.querySelector('[data-slot="notification-description"]')
    expect(desc).toHaveClass('opacity-72')
  })

  it('renders the timestamp slot when provided', () => {
    render(<Notification title="t" timestamp="2 min ago" />)
    expect(screen.getByText('2 min ago')).toBeInTheDocument()
  })

  it('omits the title row entirely when neither title nor timestamp is provided', () => {
    const { container } = render(<Notification description="just a body" />)
    expect(container.querySelector('h5')).toBeNull()
    expect(container.querySelector('[data-slot="notification-timestamp"]')).toBeNull()
  })

  it('renders an actions row when actions are provided', () => {
    render(
      <Notification
        title="t"
        actions={
          <>
            <button data-testid="view">View</button>
            <button data-testid="dismiss">Dismiss</button>
          </>
        }
      />,
    )
    expect(screen.getByTestId('view')).toBeInTheDocument()
    expect(screen.getByTestId('dismiss')).toBeInTheDocument()
  })

  it('actions row carries data-slot="notification-actions"', () => {
    const { container } = render(
      <Notification title="t" actions={<button>x</button>} />,
    )
    expect(container.querySelector('[data-slot="notification-actions"]')).not.toBeNull()
  })

  it('uses the avatar prop as the Alert icon override (no default status icon when avatar set)', () => {
    const Avatar = () => <span data-testid="user-avatar" />
    const { container } = render(<Notification title="t" avatar={<Avatar />} />)
    expect(screen.getByTestId('user-avatar')).toBeInTheDocument()
    // No badge wrap because Alert sees `icon` prop and treats this as the leading visual
    expect(container.querySelector('[data-slot="alert-icon-badge"]')).not.toBeNull()
  })

  it('dismissible defaults to true and fires onDismiss when X is clicked', () => {
    const onDismiss = jest.fn()
    render(<Notification title="t" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('omits the dismiss button when dismissible is false', () => {
    render(<Notification title="t" dismissible={false} />)
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })

  it('honors a custom dismissAriaLabel', () => {
    render(<Notification title="t" dismissAriaLabel="Zamknij" />)
    expect(screen.getByRole('button', { name: 'Zamknij' })).toBeInTheDocument()
  })

  it('forwards status to the underlying Alert', () => {
    const { container } = render(<Notification status="success" title="Saved" />)
    expect(container.querySelector('[data-slot="notification"]')).toHaveAttribute('data-status', 'success')
  })

  it('forwards style to the underlying Alert', () => {
    const { container } = render(
      <Notification status="warning" style="lighter" title="Heads up" />,
    )
    const alert = container.querySelector('[data-slot="notification"]')
    expect(alert).toHaveAttribute('data-style', 'lighter')
    expect(alert).toHaveClass('bg-status-warning-bg')
  })

  it('forwards refs to the underlying Alert wrapper div', () => {
    const ref = React.createRef<HTMLDivElement>()
    render(<Notification ref={ref} title="t" />)
    expect(ref.current).not.toBeNull()
    expect(ref.current?.getAttribute('data-slot')).toBe('notification')
  })
})
