/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { InvoiceDetailPage } from '../documents/InvoiceDetailPage'

const mockApiCall = jest.fn()
const mockReadApiResultOrThrow = jest.fn()
const mockWithScopedApiRequestHeaders = jest.fn(async (_headers: Record<string, string>, run: () => Promise<unknown>) => run())
const mockBuildOptimisticLockHeader = jest.fn((updatedAt: string | null) => (updatedAt ? { 'x-test-updated-at': updatedAt } : {}))
const mockUpdateCrud = jest.fn()
const mockDeleteCrud = jest.fn()
const mockFlash = jest.fn()
const mockRunMutation = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const mockRetryLastMutation = jest.fn()
const mockConfirm = jest.fn()
const mockPush = jest.fn()
const mockTranslate = (
  _key: string,
  fallback?: string,
  params?: Record<string, unknown>,
) => {
  const template = fallback ?? _key
  return params
    ? template.replace(/\{(\w+)\}/g, (match, key) => String(params[key] ?? match))
    : template
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label, action }: any) => (
    <div>
      <div>{label}</div>
      {action}
    </div>
  ),
  RecordNotFoundState: ({ label }: { label: string }) => <div>{label}</div>,
  TabEmptyState: ({ title, description }: any) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
  withScopedApiRequestHeaders: (...args: [Record<string, string>, () => Promise<unknown>]) =>
    mockWithScopedApiRequestHeaders(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: (...args: [string | null]) => mockBuildOptimisticLockHeader(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: (...args: unknown[]) => mockUpdateCrud(...args),
  deleteCrud: (...args: unknown[]) => mockDeleteCrud(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: mockConfirm,
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: mockRunMutation,
    retryLastMutation: mockRetryLastMutation,
  }),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ asChild, children, ...props }: any) => (
    asChild ? <>{children}</> : <button {...props}>{children}</button>
  ),
}))

jest.mock('@open-mercato/ui/primitives/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

jest.mock('@open-mercato/ui/primitives/select', () => ({
  Select: ({ value, onValueChange, children, disabled }: any) => (
    <select
      aria-label="Invoice status"
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

function invoicePayload(overrides: Record<string, unknown> = {}) {
  return {
    invoice: {
      id: '11111111-1111-4111-8111-111111111111',
      orderId: '22222222-2222-4222-8222-222222222222',
      invoiceNumber: 'INV-THOM-51',
      statusEntryId: 'status-draft',
      status: 'draft',
      issueDate: '2026-06-23T00:00:00.000Z',
      dueDate: '2026-06-30T00:00:00.000Z',
      currencyCode: 'EUR',
      subtotalNetAmount: '100',
      subtotalGrossAmount: '123',
      discountTotalAmount: '0',
      taxTotalAmount: '23',
      grandTotalNetAmount: '100',
      grandTotalGrossAmount: '123',
      paidTotalAmount: '0',
      outstandingAmount: '123',
      updatedAt: '2026-06-23T10:00:00.000Z',
      ...overrides,
    },
    lines: [],
  }
}

describe('InvoiceDetailPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockApiCall.mockResolvedValue({
      ok: true,
      result: {
        items: [
          { id: 'status-draft', value: 'draft', label: 'Draft' },
          { id: 'status-sent', value: 'sent', label: 'Sent' },
        ],
      },
    })
    mockReadApiResultOrThrow
      .mockResolvedValueOnce(invoicePayload())
      .mockResolvedValueOnce(invoicePayload({
        statusEntryId: 'status-sent',
        status: 'sent',
        updatedAt: '2026-06-23T10:05:00.000Z',
      }))
    mockUpdateCrud.mockResolvedValue({ ok: true, result: { invoiceId: '11111111-1111-4111-8111-111111111111' } })
    mockDeleteCrud.mockResolvedValue({ ok: true })
  })

  it('lets users update an invoice status and reloads the invoice readback', async () => {
    render(<InvoiceDetailPage id="11111111-1111-4111-8111-111111111111" />)

    await screen.findByText('INV-THOM-51')
    const statusSelect = screen.getByLabelText('Invoice status') as HTMLSelectElement
    await waitFor(() => expect(statusSelect.value).toBe('status-draft'))
    expect(screen.getByRole('button', { name: /update status/i })).toBeDisabled()

    fireEvent.change(statusSelect, { target: { value: 'status-sent' } })
    const saveButton = screen.getByRole('button', { name: /update status/i })
    expect(saveButton).not.toBeDisabled()
    fireEvent.click(saveButton)

    await waitFor(() => expect(mockUpdateCrud).toHaveBeenCalledTimes(1))
    expect(mockBuildOptimisticLockHeader).toHaveBeenCalledWith('2026-06-23T10:00:00.000Z')
    expect(mockWithScopedApiRequestHeaders).toHaveBeenCalledWith(
      { 'x-test-updated-at': '2026-06-23T10:00:00.000Z' },
      expect.any(Function),
    )
    expect(mockUpdateCrud).toHaveBeenCalledWith(
      'sales/invoices',
      {
        id: '11111111-1111-4111-8111-111111111111',
        statusEntryId: 'status-sent',
        currencyCode: 'EUR',
      },
      expect.objectContaining({
        errorMessage: 'Failed to update invoice status.',
      }),
    )
    expect(mockFlash).toHaveBeenCalledWith('Invoice status updated.', 'success')
    await waitFor(() => expect(mockReadApiResultOrThrow).toHaveBeenCalledTimes(2))
  })
})
