/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { CompletePutawayTaskDialog } from '../CompletePutawayTaskDialog'

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
  loadBinLocationOptions: jest.fn(async () => [{ value: 'loc-1', label: 'BIN-1' }]),
  resolveLocationLabel: jest.fn(async () => 'BIN-1'),
}))

const access = {
  loading: false,
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  scopeReady: true,
  canManagePutaway: true,
} as any

const task = {
  id: '11111111-1111-4111-8111-111111111111',
  warehouseId: '22222222-2222-4222-8222-222222222222',
  quantity: 5,
  targetLocationId: '33333333-3333-4333-8333-333333333333',
  updatedAt: '2026-08-22T10:00:00.000Z',
}

describe('CompletePutawayTaskDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) =>
      operation(),
    )
  })

  it('renders the complete putaway dialog', () => {
    render(
      <CompletePutawayTaskDialog
        open
        onOpenChange={jest.fn()}
        access={access}
        task={task}
      />,
    )

    expect(screen.getByTestId('complete-putaway-submit')).toBeTruthy()
    expect(screen.getByTestId('complete-putaway-qty')).toBeTruthy()
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
          expectedUpdatedAt: task.updatedAt,
          currentUpdatedAt: freshUpdatedAt,
        },
        response: new Response(null, { status: 409 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: { ok: true },
        response: new Response(null, { status: 200 }),
      })

    render(
      <CompletePutawayTaskDialog
        open
        onOpenChange={jest.fn()}
        access={access}
        task={task}
      />,
    )

    fireEvent.click(screen.getByTestId('complete-putaway-submit'))

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))
    expect(mockApiCall.mock.calls[0][1].headers[OPTIMISTIC_LOCK_HEADER_NAME]).toBe(task.updatedAt)

    fireEvent.click(screen.getByTestId('complete-putaway-submit'))

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
          expectedUpdatedAt: task.updatedAt,
          currentUpdatedAt: freshUpdatedAt,
        },
        response: new Response(null, { status: 409 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        result: { ok: true },
        response: new Response(null, { status: 200 }),
      })

    render(
      <CompletePutawayTaskDialog
        open
        onOpenChange={jest.fn()}
        access={access}
        task={task}
      />,
    )

    fireEvent.click(screen.getByTestId('complete-putaway-submit'))
    await waitFor(() => expect(capturedOperation).toBeTruthy())
    expect(mockApiCall.mock.calls[0][1].headers[OPTIMISTIC_LOCK_HEADER_NAME]).toBe(task.updatedAt)

    await capturedOperation!()
    expect(mockApiCall).toHaveBeenCalledTimes(2)
    expect(mockApiCall.mock.calls[1][1].headers[OPTIMISTIC_LOCK_HEADER_NAME]).toBe(freshUpdatedAt)
  })
})
