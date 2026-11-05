/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { AssignPutawayTaskDialog } from '../AssignPutawayTaskDialog'
import type { WmsInventoryMutationAccess } from '../useWmsInventoryMutationAccess'

const mockApiCall = jest.fn()
const mockRunMutation = jest.fn()
const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
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

jest.mock('@open-mercato/ui/backend/inputs/ComboboxInput', () => ({
  ComboboxInput: () => null,
}))

jest.mock('../inventoryMutationLoaders', () => ({
  loadAssigneeOptions: jest.fn(async () => ({ canListUsers: true, options: [] })),
  resolveAssigneeLabel: jest.fn(async (value: string) => value),
}))

const USER_ID = '99999999-9999-4999-8999-999999999999'
const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const UPDATED_AT = '2026-08-22T10:00:00.000Z'

const access = {
  loading: false,
  organizationId: '22222222-2222-4222-8222-222222222222',
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: USER_ID,
  scopeReady: true,
} as unknown as WmsInventoryMutationAccess

describe('AssignPutawayTaskDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) =>
      operation(),
    )
  })

  it('keeps the dialog open on a 409 and retries with the refreshed token', async () => {
    const freshUpdatedAt = '2026-08-22T10:05:00.000Z'
    const onOpenChange = jest.fn()
    const onSuccess = jest.fn()
    mockApiCall
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        result: {
          error: 'record_modified',
          code: 'optimistic_lock_conflict',
          expectedUpdatedAt: UPDATED_AT,
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
      <AssignPutawayTaskDialog
        open
        onOpenChange={onOpenChange}
        access={access}
        task={{ id: TASK_ID, assignedTo: USER_ID, updatedAt: UPDATED_AT }}
        onSuccess={onSuccess}
      />,
    )

    const submit = await screen.findByRole('button', { name: 'Assign' })
    await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false))
    fireEvent.click(submit)

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))
    expect(mockApiCall.mock.calls[0][1].headers[OPTIMISTIC_LOCK_HEADER_NAME]).toBe(UPDATED_AT)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(flash).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByRole('button', { name: 'Assign' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2))
    expect(mockApiCall.mock.calls[1][1].headers[OPTIMISTIC_LOCK_HEADER_NAME]).toBe(freshUpdatedAt)
  })
})
