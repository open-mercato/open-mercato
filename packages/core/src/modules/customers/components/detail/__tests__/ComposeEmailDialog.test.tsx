/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ComposeEmailDialog } from '../ComposeEmailDialog'
import { useComposeScheduling } from '@open-mercato/ui/backend/messages'

const SCHEDULED_AT = '2099-01-01T10:00:00.000Z'

jest.mock('@open-mercato/ui/backend/messages', () => ({
  useComposeScheduling: jest.fn(() => null),
  ScheduleSendDialog: ({ open, onConfirm }: { open: boolean; onConfirm: (value: string) => void }) =>
    open ? <button type="button" onClick={() => onConfirm('2099-01-01T10:00:00.000Z')}>Confirm schedule</button> : null,
}))

const mockUseComposeScheduling = useComposeScheduling as jest.MockedFunction<typeof useComposeScheduling>

// Stub out Radix dialog portals so they render inline in jsdom
jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, onKeyDown }: { children: React.ReactNode; onKeyDown?: React.KeyboardEventHandler }) => (
    <div data-testid="dialog-content" onKeyDown={onKeyDown}>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogClose: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Stub Select so it renders as a simple native select in jsdom
jest.mock('@open-mercato/ui/primitives/select', () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value?: string; onValueChange?: (v: string) => void }) => (
    <div data-testid="select-root" data-value={value}>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child
        return React.cloneElement(child as React.ReactElement<{ onValueChange?: (v: string) => void }>, { onValueChange })
      })}
    </div>
  ),
  SelectTrigger: ({ children, id }: { children: React.ReactNode; id?: string }) => <div id={id}>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children, onValueChange }: { children: React.ReactNode; onValueChange?: (v: string) => void }) => (
    <div>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child
        return React.cloneElement(child as React.ReactElement<{ _onValueChange?: (v: string) => void }>, { _onValueChange: onValueChange })
      })}
    </div>
  ),
  SelectItem: ({ children, value, _onValueChange }: { children: React.ReactNode; value?: string; _onValueChange?: (v: string) => void }) => (
    <button type="button" data-value={value} onClick={() => _onValueChange?.(value ?? '')}>
      {children}
    </button>
  ),
}))

const baseProps = {
  open: true,
  onOpenChange: jest.fn(),
  defaultRecipient: 'bob@example.com',
  channels: [
    { id: 'ch-1', displayName: 'Alice (Gmail)', externalIdentifier: 'alice@example.com', providerKey: 'gmail' as const, isPrimary: true },
  ],
  onSend: jest.fn().mockResolvedValue({ messageId: 'm-1' }),
}

describe('ComposeEmailDialog', () => {
  beforeEach(() => {
    baseProps.onOpenChange.mockClear()
    baseProps.onSend.mockClear()
    mockUseComposeScheduling.mockReturnValue(null)
  })

  it('renders with default recipient pre-filled', () => {
    renderWithProviders(<ComposeEmailDialog {...baseProps} />)
    expect(screen.getByDisplayValue('bob@example.com')).toBeInTheDocument()
  })

  it('disables Send until subject + body are present', () => {
    renderWithProviders(<ComposeEmailDialog {...baseProps} />)
    const send = screen.getByRole('button', { name: /send/i })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Hi' } })
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: 'hello' } })
    expect(send).not.toBeDisabled()
  })

  it('calls onSend with the form data on submit', async () => {
    renderWithProviders(<ComposeEmailDialog {...baseProps} />)
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Hi' } })
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(baseProps.onSend).toHaveBeenCalled())
    expect(baseProps.onSend).toHaveBeenCalledWith(expect.objectContaining({
      userChannelId: 'ch-1',
      to: ['bob@example.com'],
      subject: 'Hi',
      body: 'hello',
      visibility: 'private',
    }))
  })

  it('closes the dialog on successful send', async () => {
    renderWithProviders(<ComposeEmailDialog {...baseProps} />)
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Hi' } })
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(baseProps.onOpenChange).toHaveBeenCalledWith(false))
  })

  it('shows error inline when onSend rejects', async () => {
    const props = { ...baseProps, onSend: jest.fn().mockRejectedValue(new Error('Channel offline')) }
    renderWithProviders(<ComposeEmailDialog {...props} />)
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Hi' } })
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(screen.getByText(/channel offline/i)).toBeInTheDocument())
    // Dialog stays open on failure
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('prefills To/Cc/Subject when replyTo is provided', () => {
    const replyProps = {
      ...baseProps,
      defaultRecipient: null,
      replyTo: {
        inReplyTo: '<previous@example.com>',
        references: ['<root@example.com>', '<previous@example.com>'],
        to: ['alice@example.com'],
        cc: ['cc@example.com'],
        subject: 'Re: original',
      },
    }
    renderWithProviders(<ComposeEmailDialog {...replyProps} />)
    expect(screen.getByDisplayValue('alice@example.com')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Re: original')).toBeInTheDocument()
  })

  it('reveals Bcc and sends the hidden recipients', async () => {
    renderWithProviders(<ComposeEmailDialog {...baseProps} />)
    expect(screen.queryByLabelText('Bcc')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add Bcc recipients' }))
    fireEvent.change(screen.getByLabelText('Bcc'), { target: { value: 'hidden@example.com, other@example.com' } })
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Hi' } })
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }))
    await waitFor(() => expect(baseProps.onSend).toHaveBeenCalled())
    expect(baseProps.onSend).toHaveBeenCalledWith(expect.objectContaining({
      bcc: ['hidden@example.com', 'other@example.com'],
    }))
    expect(baseProps.onSend.mock.calls[0][0]).not.toHaveProperty('scheduledAt')
  })

  it('hides Send later when scheduling is unavailable', () => {
    mockUseComposeScheduling.mockReturnValue({ available: false, maxDays: 0 })
    renderWithProviders(<ComposeEmailDialog {...baseProps} />)
    expect(screen.queryByRole('button', { name: /send later/i })).not.toBeInTheDocument()
  })

  it('keeps Send later disabled until the email is complete, then submits scheduledAt', async () => {
    mockUseComposeScheduling.mockReturnValue({ available: true, maxDays: 30 })
    renderWithProviders(<ComposeEmailDialog {...baseProps} />)
    const sendLater = screen.getByRole('button', { name: /send later/i })
    expect(sendLater).toBeDisabled()
    fireEvent.click(sendLater)
    expect(screen.queryByRole('button', { name: 'Confirm schedule' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Hi' } })
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: 'hello' } })
    fireEvent.click(sendLater)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm schedule' }))

    await waitFor(() => expect(baseProps.onSend).toHaveBeenCalled())
    expect(baseProps.onSend).toHaveBeenCalledWith(expect.objectContaining({
      to: ['bob@example.com'],
      subject: 'Hi',
      scheduledAt: SCHEDULED_AT,
    }))
    await waitFor(() => expect(baseProps.onOpenChange).toHaveBeenCalledWith(false))
  })
})
