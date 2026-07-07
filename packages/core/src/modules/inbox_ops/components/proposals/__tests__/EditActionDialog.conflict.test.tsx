/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  dismissRecordConflict,
  getRecordConflictForTest,
} from '@open-mercato/ui/backend/conflicts'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { EditActionDialog } from '../EditActionDialog'
import type { ActionDetail } from '../types'

const globalScope = globalThis as { structuredClone?: <T>(value: T) => T }
if (typeof globalScope.structuredClone !== 'function') {
  globalScope.structuredClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
}

const apiCallOrThrowMock = apiCallOrThrow as jest.Mock
const flashMock = flash as jest.Mock

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
  withScopedApiRequestHeaders: (
    _headers: Record<string, string>,
    operation: () => Promise<unknown>,
  ) => operation(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

// Mirror the real useGuardedMutation contract: run the operation and, on a
// thrown 409 optimistic-lock error, surface the shared RecordConflictBanner
// before re-throwing (see useGuardedMutation.emitMutationSaveError). Using the
// real surfaceRecordConflict keeps the conflict-bar assertion faithful.
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => {
  const { surfaceRecordConflict } = jest.requireActual('@open-mercato/ui/backend/conflicts')
  return {
    useGuardedMutation: () => ({
      runMutation: async <T,>({ operation }: { operation: () => Promise<T> }): Promise<T> => {
        try {
          return await operation()
        } catch (error) {
          surfaceRecordConflict(error, (_key: string, fallback?: string) => fallback ?? _key)
          throw error
        }
      },
      retryLastMutation: async () => true,
    }),
  }
})

function buildOptimisticLockError(): Error & Record<string, unknown> {
  const error = new Error('record_modified') as Error & Record<string, unknown>
  error.status = 409
  error.code = OPTIMISTIC_LOCK_CONFLICT_CODE
  error.error = 'record_modified'
  error.currentUpdatedAt = '2026-06-25T22:47:51.238Z'
  error.expectedUpdatedAt = '2026-06-25T22:44:32.000Z'
  return error
}

function buildAlreadyProcessedError(): Error & Record<string, unknown> {
  const error = new Error('Action already processed') as Error & Record<string, unknown>
  error.status = 409
  return error
}

const action: ActionDetail = {
  id: 'action-1',
  proposalId: 'proposal-1',
  sortOrder: 0,
  actionType: 'create_product',
  description: 'Create a product',
  payload: { note: 'hello' },
  status: 'pending',
  confidence: 'high',
  updatedAt: '2026-06-25T22:44:32.000Z',
}

const actionTypeLabels = { create_product: 'Create product' }

function renderDialog(overrides?: { onSaved?: jest.Mock; onClose?: jest.Mock }) {
  const onSaved = overrides?.onSaved ?? jest.fn()
  const onClose = overrides?.onClose ?? jest.fn()
  renderWithProviders(
    <EditActionDialog
      action={action}
      actionTypeLabels={actionTypeLabels}
      onSaved={onSaved}
      onClose={onClose}
    />,
  )
  return { onSaved, onClose }
}

function clickSave() {
  const saveButton = Array.from(document.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('Save Changes'),
  )
  if (!saveButton) throw new Error('Save Changes button not rendered')
  fireEvent.click(saveButton)
}

beforeEach(() => {
  jest.clearAllMocks()
  dismissRecordConflict()
})

afterEach(() => {
  dismissRecordConflict()
})

describe('EditActionDialog optimistic-lock conflict handling', () => {
  it('surfaces the persistent conflict bar and does not flash the raw key on a 409 conflict', async () => {
    apiCallOrThrowMock.mockRejectedValue(buildOptimisticLockError())
    const { onSaved, onClose } = renderDialog()

    clickSave()

    await waitFor(() => expect(getRecordConflictForTest()).not.toBeNull())
    expect(getRecordConflictForTest()?.message).toBe(
      'This record was modified by someone else. Refresh and try again.',
    )
    // The dialog must not also fire a transient toast (the raw `record_modified`
    // key regression the QA reviewer reported).
    expect(flashMock).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('flashes the server message for a non-conflict error without touching the conflict bar', async () => {
    apiCallOrThrowMock.mockRejectedValue(buildAlreadyProcessedError())
    const { onSaved, onClose } = renderDialog()

    clickSave()

    await waitFor(() =>
      expect(flashMock).toHaveBeenCalledWith('Action already processed', 'error'),
    )
    expect(getRecordConflictForTest()).toBeNull()
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('saves through apiCallOrThrow on the happy path', async () => {
    apiCallOrThrowMock.mockResolvedValue({ ok: true, status: 200, result: { ok: true } })
    const { onSaved, onClose } = renderDialog()

    clickSave()

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(flashMock).toHaveBeenCalledWith('Action updated successfully', 'success')
    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/inbox_ops/proposals/proposal-1/actions/action-1',
      expect.objectContaining({ method: 'PATCH' }),
    )
    expect(getRecordConflictForTest()).toBeNull()
  })
})
