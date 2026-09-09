/** @jest-environment jsdom */

import * as React from 'react'
import { act, render, renderHook } from '@testing-library/react'
import type { Editor } from '@tiptap/core'

const apiCallMock = jest.fn()
const routerPushMock = jest.fn()
const buildOptimisticLockHeaderMock = jest.fn((updatedAt: string | null) => ({ 'x-lock': updatedAt ?? '' }))
const runMutationMock = jest.fn()
const surfaceRecordConflictMock = jest.fn()
const flashMock = jest.fn()
const surfacePropsMock = jest.fn()
const collaborationMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock, replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: (...args: [string | null]) => buildOptimisticLockHeaderMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: runMutationMock, retryLastMutation: jest.fn(async () => false) }),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => surfaceRecordConflictMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('../backend/documents/[id]/useDocumentCollaboration', () => ({
  useDocumentCollaboration: (...args: unknown[]) => collaborationMock(...args),
}))

jest.mock('../backend/documents/[id]/DocumentEditorSurface', () => ({
  DocumentEditorSurface: (props: unknown) => {
    surfacePropsMock(props)
    return null
  },
}))

import DocumentEditorIsland from '../backend/documents/[id]/DocumentEditorIsland'
import {
  FALLBACK_AUTOSAVE_DELAY_MS,
  useFallbackContentPersistence,
} from '../backend/documents/[id]/useFallbackContentPersistence'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const INITIAL_UPDATED_AT = '2026-07-14T08:00:00.000Z'
const NEXT_UPDATED_AT = '2026-07-14T08:00:01.000Z'

describe('single-user fallback editing', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    collaborationMock.mockReturnValue({ mode: 'fallback', readOnly: false })
    surfaceRecordConflictMock.mockReturnValue(false)
    runMutationMock.mockImplementation(({ operation }: { operation: () => unknown }) => operation())
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { updatedAt: NEXT_UPDATED_AT } })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('keeps an editable document in edit mode when realtime is unavailable', () => {
    render(
      <DocumentEditorIsland
        documentId={DOCUMENT_ID}
        title="Fallback document"
        initialContentHtml="<p>Saved body</p>"
        contentUpdatedAt={INITIAL_UPDATED_AT}
        documentUpdatedAt={INITIAL_UPDATED_AT}
        readOnly={false}
      />,
    )

    expect(surfacePropsMock).toHaveBeenCalledWith(expect.objectContaining({
      transport: 'fallback',
      mode: 'edit',
      readOnly: false,
      contentUpdatedAt: INITIAL_UPDATED_AT,
    }))
  })

  it('keeps a definitive collaboration authorization failure read-only', () => {
    collaborationMock.mockReturnValue({ mode: 'fallback', readOnly: true })
    render(
      <DocumentEditorIsland
        documentId={DOCUMENT_ID}
        title="Revoked document"
        initialContentHtml="<p>Saved body</p>"
        contentUpdatedAt={INITIAL_UPDATED_AT}
        documentUpdatedAt={INITIAL_UPDATED_AT}
        readOnly={false}
      />,
    )

    expect(surfacePropsMock).toHaveBeenCalledWith(expect.objectContaining({
      transport: 'fallback',
      mode: 'preview',
      readOnly: true,
    }))
  })

  it('serializes an edit received during an in-flight save with the returned optimistic-lock token', async () => {
    let resolveFirstSave!: (value: unknown) => void
    const firstSave = new Promise((resolve) => { resolveFirstSave = resolve })
    const finalUpdatedAt = '2026-07-14T08:00:02.000Z'
    apiCallMock
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValueOnce({ ok: true, status: 200, result: { updatedAt: finalUpdatedAt } })
    const { result } = renderHook(() => useFallbackContentPersistence({
      documentId: DOCUMENT_ID,
      initialUpdatedAt: INITIAL_UPDATED_AT,
      enabled: true,
    }))
    const editor = {
      getHTML: jest.fn(() => '<p>First edit</p>'),
      getText: jest.fn(() => 'First edit'),
    } as unknown as Editor

    act(() => result.current.onEditorUpdate(editor))
    expect(result.current.status).toBe('unsaved')
    act(() => {
      jest.advanceTimersByTime(FALLBACK_AUTOSAVE_DELAY_MS)
    })

    expect(buildOptimisticLockHeaderMock).toHaveBeenNthCalledWith(1, INITIAL_UPDATED_AT)
    expect(apiCallMock).toHaveBeenNthCalledWith(1,
      `/api/documents/${DOCUMENT_ID}/content`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ contentHtml: '<p>First edit</p>', contentText: 'First edit' }),
      }),
    )
    expect(result.current.status).toBe('saving')

    ;(editor.getHTML as jest.Mock).mockReturnValue('<p>Second edit</p>')
    ;(editor.getText as jest.Mock).mockReturnValue('Second edit')
    act(() => result.current.onEditorUpdate(editor))
    expect(result.current.status).toBe('unsaved')
    expect(apiCallMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirstSave({ ok: true, status: 200, result: { updatedAt: NEXT_UPDATED_AT } })
      await firstSave
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    })

    expect(buildOptimisticLockHeaderMock).toHaveBeenNthCalledWith(2, NEXT_UPDATED_AT)
    expect(apiCallMock).toHaveBeenNthCalledWith(2,
      `/api/documents/${DOCUMENT_ID}/content`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ contentHtml: '<p>Second edit</p>', contentText: 'Second edit' }),
      }),
    )
    expect(runMutationMock).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('saved')
  })

  it('flushes pending content before allowing internal link navigation', async () => {
    let resolveSave!: (value: unknown) => void
    const save = new Promise((resolve) => { resolveSave = resolve })
    apiCallMock.mockImplementationOnce(() => save)
    const { result } = renderHook(() => useFallbackContentPersistence({
      documentId: DOCUMENT_ID,
      initialUpdatedAt: INITIAL_UPDATED_AT,
      enabled: true,
    }))
    const editor = {
      getHTML: () => '<p>Navigate safely</p>',
      getText: () => 'Navigate safely',
    } as unknown as Editor
    const link = document.createElement('a')
    link.href = '/backend/documents'
    link.textContent = 'Back'
    document.body.appendChild(link)

    act(() => result.current.onEditorUpdate(editor))
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => { link.dispatchEvent(click) })

    expect(click.defaultPrevented).toBe(true)
    expect(apiCallMock).toHaveBeenCalledWith(
      `/api/documents/${DOCUMENT_ID}/content`,
      expect.objectContaining({ body: JSON.stringify({ contentHtml: '<p>Navigate safely</p>', contentText: 'Navigate safely' }) }),
    )
    expect(routerPushMock).not.toHaveBeenCalled()
    const beforeUnload = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    Object.defineProperty(beforeUnload, 'returnValue', { writable: true, value: undefined })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)
    expect(beforeUnload.returnValue).toBe('')

    await act(async () => {
      resolveSave({ ok: true, status: 200, result: { updatedAt: NEXT_UPDATED_AT } })
      await save
      for (let index = 0; index < 6; index += 1) await Promise.resolve()
    })

    expect(routerPushMock).toHaveBeenCalledWith('/backend/documents')
    link.remove()
  })

  it('registers a beforeunload prompt while fallback content is unsaved', () => {
    const { result } = renderHook(() => useFallbackContentPersistence({
      documentId: DOCUMENT_ID,
      initialUpdatedAt: INITIAL_UPDATED_AT,
      enabled: true,
    }))
    const editor = {
      getHTML: () => '<p>Still dirty</p>',
      getText: () => 'Still dirty',
    } as unknown as Editor

    act(() => result.current.onEditorUpdate(editor))
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    Object.defineProperty(event, 'returnValue', { writable: true, value: undefined })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(event.returnValue).toBe('')
  })

  it('flushes pending content when unmounted before the autosave delay', async () => {
    const { result, unmount } = renderHook(() => useFallbackContentPersistence({
      documentId: DOCUMENT_ID,
      initialUpdatedAt: INITIAL_UPDATED_AT,
      enabled: true,
    }))
    const editor = {
      getHTML: () => '<p>Unmount safely</p>',
      getText: () => 'Unmount safely',
    } as unknown as Editor

    act(() => result.current.onEditorUpdate(editor))
    act(() => jest.advanceTimersByTime(FALLBACK_AUTOSAVE_DELAY_MS - 1))
    unmount()
    await act(async () => {
      for (let index = 0; index < 4; index += 1) await Promise.resolve()
    })

    expect(apiCallMock).toHaveBeenCalledTimes(1)
    expect(apiCallMock).toHaveBeenCalledWith(
      `/api/documents/${DOCUMENT_ID}/content`,
      expect.objectContaining({ body: JSON.stringify({ contentHtml: '<p>Unmount safely</p>', contentText: 'Unmount safely' }) }),
    )
  })

  it('pauses autosave and exposes refresh when the content version conflicts', async () => {
    const onConflictRefresh = jest.fn()
    surfaceRecordConflictMock.mockReturnValue(true)
    apiCallMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      result: { code: 'optimistic_lock_conflict', currentUpdatedAt: NEXT_UPDATED_AT },
    })
    const { result } = renderHook(() => useFallbackContentPersistence({
      documentId: DOCUMENT_ID,
      initialUpdatedAt: INITIAL_UPDATED_AT,
      enabled: true,
      onConflictRefresh,
    }))
    const editor = {
      getHTML: () => '<p>Contended edit</p>',
      getText: () => 'Contended edit',
    } as unknown as Editor

    act(() => result.current.onEditorUpdate(editor))
    await act(async () => {
      jest.advanceTimersByTime(FALLBACK_AUTOSAVE_DELAY_MS)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(surfaceRecordConflictMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 409 }),
      expect.any(Function),
      { onRefresh: onConflictRefresh },
    )
    expect(result.current.status).toBe('error')
    expect(flashMock).not.toHaveBeenCalled()

    act(() => result.current.onEditorUpdate(editor))
    jest.advanceTimersByTime(FALLBACK_AUTOSAVE_DELAY_MS)
    expect(apiCallMock).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed snapshot available for manual retry without a retry loop', async () => {
    apiCallMock
      .mockResolvedValueOnce({ ok: false, status: 503, result: { error: 'unavailable' } })
      .mockResolvedValueOnce({ ok: true, status: 200, result: { updatedAt: NEXT_UPDATED_AT } })
    const { result } = renderHook(() => useFallbackContentPersistence({
      documentId: DOCUMENT_ID,
      initialUpdatedAt: INITIAL_UPDATED_AT,
      enabled: true,
    }))
    const editor = {
      getHTML: () => '<p>Retry me</p>',
      getText: () => 'Retry me',
    } as unknown as Editor

    act(() => result.current.onEditorUpdate(editor))
    await act(async () => {
      jest.advanceTimersByTime(FALLBACK_AUTOSAVE_DELAY_MS)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.status).toBe('error')
    expect(apiCallMock).toHaveBeenCalledTimes(1)

    act(() => jest.advanceTimersByTime(10_000))
    expect(apiCallMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      result.current.saveNow()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(apiCallMock).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('saved')
  })
})
