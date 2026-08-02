/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfirmDealLostDialog } from '../ConfirmDealLostDialog'
import { loadDictionaryEntriesByKey } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'

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
    disabled,
    onClick,
    type,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} disabled={disabled} onClick={onClick}>
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
const mockLoadDictionaryEntriesByKey = loadDictionaryEntriesByKey as jest.MockedFunction<typeof loadDictionaryEntriesByKey>

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
    mockLoadDictionaryEntriesByKey.mockResolvedValue([
      { id: 'reason-price', value: 'price', label: 'Price', description: 'Too expensive' },
    ])
  })

  it('disables confirmation until a loss reason is selected', async () => {
    const onConfirm = jest.fn()
    render(<ConfirmDealLostDialog {...defaultProps} onConfirm={onConfirm} />)

    await act(async () => {})

    const confirmButton = screen.getByText('Mark as Lost').closest('button')
    expect(confirmButton).toBeDisabled()

    cmdEnter(screen.getByTestId('dialog-content'))

    expect(onConfirm).not.toHaveBeenCalled()

    await selectLossReason()
    expect(confirmButton).not.toBeDisabled()
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

  it('shows an empty state and disables confirmation when no loss reasons are configured', async () => {
    mockLoadDictionaryEntriesByKey.mockResolvedValueOnce([])
    const onConfirm = jest.fn()
    render(<ConfirmDealLostDialog {...defaultProps} onConfirm={onConfirm} />)

    await waitFor(() => {
      expect(screen.getAllByText('No loss reasons are configured.')).toHaveLength(2)
    })

    const confirmButton = screen.getByText('Mark as Lost').closest('button')
    expect(confirmButton).toBeDisabled()
    cmdEnter(screen.getByTestId('dialog-content'))
    expect(onConfirm).not.toHaveBeenCalled()
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
