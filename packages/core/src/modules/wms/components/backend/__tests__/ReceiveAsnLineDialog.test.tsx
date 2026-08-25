/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { ReceiveAsnLineDialog } from '../ReceiveAsnLineDialog'

const mockApiCall = jest.fn()
const mockRunMutation = jest.fn()
const mockInvalidateQueries = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (...args: unknown[]) => mockRunMutation(...args),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  raiseCrudError: jest.fn(),
}))

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

jest.mock('@open-mercato/ui/backend/inputs/ComboboxInput', () => ({
  ComboboxInput: ({
    placeholder,
    value,
    onChange,
  }: {
    placeholder: string
    value: string
    onChange: (v: string) => void
  }) => (
    <input
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={`combobox-${placeholder}`}
    />
  ),
}))

jest.mock('../inventoryMutationLoaders', () => ({
  loadStagingLocationOptions: jest.fn(async () => [{ value: 'loc-1', label: 'STG-1' }]),
  resolveLocationLabel: jest.fn(async () => 'STG-1'),
}))

const access = {
  loading: false,
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  scopeReady: true,
  canReceive: true,
} as any

const line = {
  lineId: 'line-1',
  catalogVariantId: 'var-1',
  expectedQty: 10,
  receivedQty: 2,
  variantLabel: 'SKU-1',
  targetStagingLocationId: '33333333-3333-4333-8333-333333333333',
  asnUpdatedAt: '2026-08-22T10:00:00.000Z',
}

describe('ReceiveAsnLineDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) =>
      operation(),
    )
  })

  it('renders the ASN receive dialog distinctly from ad-hoc receive', () => {
    render(
      <ReceiveAsnLineDialog
        open
        onOpenChange={jest.fn()}
        access={access}
        asnId="11111111-1111-1111-1111-111111111111"
        warehouseId="22222222-2222-2222-2222-222222222222"
        line={line}
      />,
    )

    expect(screen.getByText('Receive ASN line')).toBeTruthy()
    expect(screen.getByText('SKU-1')).toBeTruthy()
    expect(screen.getByTestId('receive-asn-submit')).toBeTruthy()
    expect(screen.queryByText('Receive inventory (no ASN)')).toBeNull()
  })

  it('refreshes the optimistic-lock token from a 409 so retry sends a fresh If-Match', async () => {
    const freshUpdatedAt = '2026-08-22T10:05:00.000Z'
    mockApiCall
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        result: {
          error: 'record_modified',
          code: 'optimistic_lock_conflict',
          expectedUpdatedAt: line.asnUpdatedAt,
          currentUpdatedAt: freshUpdatedAt,
        },
        response: new Response(null, { status: 409 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: { ok: true, receivedQty: 10, asnUpdatedAt: freshUpdatedAt },
        response: new Response(null, { status: 200 }),
      })

    render(
      <ReceiveAsnLineDialog
        open
        onOpenChange={jest.fn()}
        access={access}
        asnId="11111111-1111-1111-1111-111111111111"
        warehouseId="22222222-2222-2222-2222-222222222222"
        line={line}
      />,
    )

    fireEvent.click(screen.getByTestId('receive-asn-submit'))

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))
    expect(mockApiCall.mock.calls[0][1].headers[OPTIMISTIC_LOCK_HEADER_NAME]).toBe(line.asnUpdatedAt)

    fireEvent.click(screen.getByTestId('receive-asn-submit'))

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2))
    expect(mockApiCall.mock.calls[1][1].headers[OPTIMISTIC_LOCK_HEADER_NAME]).toBe(freshUpdatedAt)
  })

  it('retryLastMutation reuses the closed operation with a fresh If-Match from the lock ref', async () => {
    const freshUpdatedAt = '2026-08-22T10:05:00.000Z'
    let capturedOperation: (() => Promise<unknown>) | null = null
    mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => {
      capturedOperation = operation
      return operation()
    })
    mockApiCall
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        result: {
          error: 'record_modified',
          code: 'optimistic_lock_conflict',
          expectedUpdatedAt: line.asnUpdatedAt,
          currentUpdatedAt: freshUpdatedAt,
        },
        response: new Response(null, { status: 409 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: { ok: true, receivedQty: 10, asnUpdatedAt: freshUpdatedAt },
        response: new Response(null, { status: 200 }),
      })

    render(
      <ReceiveAsnLineDialog
        open
        onOpenChange={jest.fn()}
        access={access}
        asnId="11111111-1111-1111-1111-111111111111"
        warehouseId="22222222-2222-2222-2222-222222222222"
        line={line}
      />,
    )

    fireEvent.click(screen.getByTestId('receive-asn-submit'))
    await waitFor(() => expect(capturedOperation).toBeTruthy())
    expect(mockApiCall.mock.calls[0][1].headers[OPTIMISTIC_LOCK_HEADER_NAME]).toBe(line.asnUpdatedAt)

    // Simulate injection retry: same closed operation, no re-render required.
    await capturedOperation!()
    expect(mockApiCall).toHaveBeenCalledTimes(2)
    expect(mockApiCall.mock.calls[1][1].headers[OPTIMISTIC_LOCK_HEADER_NAME]).toBe(freshUpdatedAt)
  })
})
