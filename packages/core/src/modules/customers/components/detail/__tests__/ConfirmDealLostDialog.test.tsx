/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfirmDealLostDialog } from '../ConfirmDealLostDialog'

jest.mock('@open-mercato/core/modules/dictionaries/lib/clientEntries', () => ({
  loadDictionaryEntriesByKey: jest.fn().mockResolvedValue([
    { id: 'reason-price', value: 'price', label: 'Price', description: 'Too expensive' },
  ]),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({
    children,
    onKeyDown,
  }: {
    children: React.ReactNode
    onKeyDown?: React.KeyboardEventHandler
  }) => (
    <div data-testid="dialog-content" onKeyDown={onKeyDown}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({
    children,
    onClick,
    type,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} onClick={onClick}>
      {children}
    </button>
  ),
}))

jest.mock('@open-mercato/ui/primitives/textarea', () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
}))

const defaultProps = {
  open: true,
  dealTitle: 'Acme Corp deal',
  onClose: jest.fn(),
}

function cmdEnter(element: HTMLElement) {
  fireEvent.keyDown(element, { key: 'Enter', metaKey: true })
}

async function selectLossReason() {
  // Open the dropdown — reasons are only rendered when it's open
  const toggleBtn = await screen.findByText('Select loss reason')
  fireEvent.click(toggleBtn)
  // Reasons are loaded async; wait for the option to appear then click it
  const option = await screen.findByText('Price')
  fireEvent.click(option)
}

describe('ConfirmDealLostDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows a validation error and does not call onConfirm when no reason is selected', async () => {
    const onConfirm = jest.fn()
    render(<ConfirmDealLostDialog {...defaultProps} onConfirm={onConfirm} />)

    // Wait for the async dictionary load to settle before asserting
    await act(async () => {})

    cmdEnter(screen.getByTestId('dialog-content'))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('Please select a loss reason')).toBeInTheDocument()
  })

  it('calls onConfirm once when Cmd+Enter is pressed with a reason selected', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    render(<ConfirmDealLostDialog {...defaultProps} onConfirm={onConfirm} />)

    await selectLossReason()
    await act(async () => {
      cmdEnter(screen.getByTestId('dialog-content'))
    })

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith({ lossReasonId: 'reason-price', lossNotes: undefined })
  })

  it('ignores a second Cmd+Enter while the first confirmation is still in-flight', async () => {
    let resolveFirst!: () => void
    const onConfirm = jest.fn(
      () => new Promise<void>((resolve) => { resolveFirst = resolve }),
    )

    render(<ConfirmDealLostDialog {...defaultProps} onConfirm={onConfirm} />)
    await selectLossReason()

    const content = screen.getByTestId('dialog-content')

    // First press — kicks off the async confirmation
    act(() => { cmdEnter(content) })
    expect(onConfirm).toHaveBeenCalledTimes(1)

    // Second press while the promise is still pending — must be a no-op
    act(() => { cmdEnter(content) })
    expect(onConfirm).toHaveBeenCalledTimes(1)

    // Third press for good measure
    act(() => { cmdEnter(content) })
    expect(onConfirm).toHaveBeenCalledTimes(1)

    // Resolve the first call — isConfirming resets to false
    await act(async () => { resolveFirst() })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('accepts another Cmd+Enter after the previous confirmation resolves', async () => {
    let resolveFirst!: () => void
    const onConfirm = jest.fn(
      () => new Promise<void>((resolve) => { resolveFirst = resolve }),
    )

    render(<ConfirmDealLostDialog {...defaultProps} onConfirm={onConfirm} />)
    await selectLossReason()

    const content = screen.getByTestId('dialog-content')

    act(() => { cmdEnter(content) })
    expect(onConfirm).toHaveBeenCalledTimes(1)

    // Resolve — dialog is no longer confirming
    await act(async () => { resolveFirst() })

    // New press should be accepted
    act(() => { cmdEnter(content) })
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })
})
