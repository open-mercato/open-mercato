/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import {
  NotificationProvider,
  NotificationStack,
  useNotification,
} from '../notification-stack'

function Harness({
  placement,
  maxVisible,
  children,
}: {
  placement?: React.ComponentProps<typeof NotificationStack>['placement']
  maxVisible?: number
  children?: React.ReactNode
}) {
  return (
    <NotificationProvider maxVisible={maxVisible}>
      {children}
      <NotificationStack placement={placement} />
    </NotificationProvider>
  )
}

function NotifyButton({ label = 'Notify', options }: { label?: string; options: any }) {
  const { notify } = useNotification()
  return (
    <button type="button" onClick={() => notify(options)}>
      {label}
    </button>
  )
}

describe('NotificationStack + useNotification', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('renders nothing when the queue is empty', () => {
    const { container } = render(<Harness />)
    expect(container.querySelector('[data-slot="notification-stack"]')).toBeNull()
  })

  it('renders the stack wrapper once a notification is queued', () => {
    const { container } = render(
      <Harness>
        <NotifyButton options={{ title: 'Hello' }} />
      </Harness>,
    )
    fireEvent.click(screen.getByText('Notify'))
    expect(container.querySelector('[data-slot="notification-stack"]')).not.toBeNull()
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('respects the placement prop (data-placement attribute + Tailwind classes)', () => {
    const { container } = render(
      <Harness placement="bottom-left">
        <NotifyButton options={{ title: 'A' }} />
      </Harness>,
    )
    fireEvent.click(screen.getByText('Notify'))
    const stack = container.querySelector('[data-slot="notification-stack"]')
    expect(stack).toHaveAttribute('data-placement', 'bottom-left')
    expect(stack).toHaveClass('bottom-4')
    expect(stack).toHaveClass('left-4')
  })

  it('dismiss button on a notification removes it from the queue', () => {
    render(
      <Harness>
        <NotifyButton options={{ title: 'Dismissable' }} />
      </Harness>,
    )
    fireEvent.click(screen.getByText('Notify'))
    expect(screen.getByText('Dismissable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Dismissable')).toBeNull()
  })

  it('auto-dismisses after autoDismissMs and clears its timer', () => {
    render(
      <Harness>
        <NotifyButton options={{ title: 'Auto', autoDismissMs: 2000 }} />
      </Harness>,
    )
    fireEvent.click(screen.getByText('Notify'))
    expect(screen.getByText('Auto')).toBeInTheDocument()
    act(() => {
      jest.advanceTimersByTime(1999)
    })
    expect(screen.getByText('Auto')).toBeInTheDocument()
    act(() => {
      jest.advanceTimersByTime(1)
    })
    expect(screen.queryByText('Auto')).toBeNull()
  })

  it('manual dismiss before autoDismissMs cancels the timer (no late re-fire)', () => {
    render(
      <Harness>
        <NotifyButton options={{ title: 'Cancel', autoDismissMs: 3000 }} />
      </Harness>,
    )
    fireEvent.click(screen.getByText('Notify'))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Cancel')).toBeNull()
    // Advance past the auto-dismiss window — no errors, no resurrected card.
    act(() => {
      jest.advanceTimersByTime(5000)
    })
    expect(screen.queryByText('Cancel')).toBeNull()
  })

  it('respects maxVisible cap (FIFO trim of oldest entries)', () => {
    render(
      <Harness maxVisible={2}>
        <NotifyButton label="A" options={{ title: 'First' }} />
        <NotifyButton label="B" options={{ title: 'Second' }} />
        <NotifyButton label="C" options={{ title: 'Third' }} />
      </Harness>,
    )
    fireEvent.click(screen.getByText('A'))
    fireEvent.click(screen.getByText('B'))
    fireEvent.click(screen.getByText('C'))
    expect(screen.queryByText('First')).toBeNull()
    expect(screen.getByText('Second')).toBeInTheDocument()
    expect(screen.getByText('Third')).toBeInTheDocument()
  })

  it('useNotification throws outside the provider', () => {
    function Bad() {
      useNotification()
      return null
    }
    // Suppress React error logging for the expected throw.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Bad />)).toThrow(
      /useNotification must be used within a NotificationProvider/,
    )
    spy.mockRestore()
  })

  it('dismissAll clears the queue', () => {
    function DismissAllButton() {
      const { dismissAll } = useNotification()
      return (
        <button type="button" onClick={dismissAll}>
          Clear
        </button>
      )
    }
    render(
      <Harness>
        <NotifyButton label="A" options={{ title: 'First' }} />
        <NotifyButton label="B" options={{ title: 'Second' }} />
        <DismissAllButton />
      </Harness>,
    )
    fireEvent.click(screen.getByText('A'))
    fireEvent.click(screen.getByText('B'))
    expect(screen.getByText('First')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Clear'))
    expect(screen.queryByText('First')).toBeNull()
    expect(screen.queryByText('Second')).toBeNull()
  })
})
