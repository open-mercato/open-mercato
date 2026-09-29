/** @jest-environment jsdom */

import * as React from 'react'
import { act, renderHook } from '@testing-library/react'

const runMutationMock = jest.fn()
const translateMock = (key: string) => key

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: runMutationMock, retryLastMutation: jest.fn(async () => false) }),
}))
jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({ buildOptimisticLockHeader: jest.fn(() => ({})) }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translateMock }))

import { useDocumentTitle } from '../backend/documents/[id]/useDocumentTitle'

const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222'

function renderTitle() {
  return renderHook(() => useDocumentTitle({
    documentId: DOCUMENT_ID,
    title: 'Original title',
    updatedAt: '2026-07-01T10:00:00.000Z',
    readOnly: false,
  }))
}

/**
 * The DOM fires `blur` synchronously inside the keydown handler, so the blur
 * commit runs against the handlers captured at keydown time — before React has
 * re-rendered with the restored value.
 */
function pressKey(
  handlers: ReturnType<typeof useDocumentTitle>,
  key: string,
): Promise<void> {
  return act(async () => {
    handlers.onKeyDown({
      key,
      preventDefault: jest.fn(),
      currentTarget: { blur: () => { void handlers.commit() } },
    } as unknown as React.KeyboardEvent<HTMLInputElement>)
  })
}

describe('useDocumentTitle keyboard commit', () => {
  beforeEach(() => {
    runMutationMock.mockReset()
    runMutationMock.mockResolvedValue({ result: { updatedAt: '2026-07-01T11:00:00.000Z' } })
  })

  it('discards the edited title on Escape instead of persisting it', async () => {
    const { result } = renderTitle()
    await act(async () => { result.current.setValue('Edited title') })

    await pressKey(result.current, 'Escape')

    expect(runMutationMock).not.toHaveBeenCalled()
    expect(result.current.value).toBe('Original title')
  })

  it('persists the edited title on Enter', async () => {
    const { result } = renderTitle()
    await act(async () => { result.current.setValue('Edited title') })

    await pressKey(result.current, 'Enter')

    expect(runMutationMock).toHaveBeenCalledTimes(1)
    expect(runMutationMock.mock.calls[0]?.[0]?.mutationPayload).toEqual({
      id: DOCUMENT_ID,
      title: 'Edited title',
    })
    expect(result.current.value).toBe('Edited title')
  })

  it('does not persist an unchanged title on blur', async () => {
    const { result } = renderTitle()

    await act(async () => { await result.current.commit() })

    expect(runMutationMock).not.toHaveBeenCalled()
  })
})
