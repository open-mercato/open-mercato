/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'

const apiCallMock = jest.fn()
const flashMock = jest.fn()
const surfaceRecordConflictMock = jest.fn(() => false)
const translate = (key: string) => key

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))
jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({ buildOptimisticLockHeader: () => ({}) }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => false),
  }),
}))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => surfaceRecordConflictMock(...args),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))
jest.mock('@tiptap/react/menus', () => ({
  BubbleMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('../backend/documents/[id]/EditorToolbar', () => ({ EditorToolbar: () => null }))
jest.mock('../backend/documents/[id]/RecordFieldsDialog', () => ({ RecordFieldsDialog: () => null }))
jest.mock('../backend/documents/components/EntityPicker', () => ({ EntityPicker: () => null }))
jest.mock('../backend/documents/[id]/EditorStatusPresence', () => ({
  EditorStatusPresence: ({ mode, onModeChange }: {
    mode: 'edit' | 'preview'
    onModeChange: (mode: 'edit' | 'preview') => void
  }) => (
    <div>
      <span data-testid="editor-mode">{mode}</span>
      <button type="button" onClick={() => onModeChange(mode === 'edit' ? 'preview' : 'edit')}>
        toggle-mode
      </button>
    </div>
  ),
}))

import { DocumentEditorSurface } from '../backend/documents/[id]/DocumentEditorSurface'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const INITIAL_UPDATED_AT = '2026-07-15T08:00:00.000Z'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function EditorHarness({ onEditorReady }: { onEditorReady: (editor: Editor | null) => void }) {
  const [mode, setMode] = React.useState<'edit' | 'preview'>('edit')
  return (
    <DocumentEditorSurface
      documentId={DOCUMENT_ID}
      title="Fallback document"
      initialContentHtml="<p>Saved body</p>"
      contentUpdatedAt={INITIAL_UPDATED_AT}
      documentUpdatedAt={INITIAL_UPDATED_AT}
      readOnly={false}
      transport="fallback"
      connectionStatus="offline"
      presenceUsers={[]}
      mode={mode}
      onModeChange={setMode}
      onEditorReady={onEditorReady}
    />
  )
}

describe('fallback editor mode transition', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    surfaceRecordConflictMock.mockReturnValue(false)
  })

  it('waits for persistence, keeps the editor instance, and saves the latest body after returning to edit', async () => {
    const firstSave = deferred<{ ok: boolean; status: number; result: { updatedAt: string } }>()
    apiCallMock
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValueOnce({ ok: true, status: 200, result: { updatedAt: '2026-07-15T08:00:02.000Z' } })
    let editor: Editor | null = null
    const onEditorReady = jest.fn((next: Editor | null) => { if (next) editor = next })
    const { container } = render(<EditorHarness onEditorReady={onEditorReady} />)

    await waitFor(() => expect(editor).not.toBeNull())
    const originalEditor = editor
    act(() => { originalEditor!.commands.setContent('<p>Latest fallback body</p>') })
    expect(container.querySelector('.ProseMirror')?.innerHTML).toContain('Latest fallback body')

    fireEvent.click(screen.getByRole('button', { name: 'toggle-mode' }))
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('editor-mode').textContent).toBe('edit')
    expect(container.querySelector('.ProseMirror')?.innerHTML).toContain('Latest fallback body')

    await act(async () => {
      firstSave.resolve({ ok: true, status: 200, result: { updatedAt: '2026-07-15T08:00:01.000Z' } })
      await firstSave.promise
    })

    await waitFor(() => expect(screen.getByTestId('editor-mode').textContent).toBe('preview'))
    expect(editor).toBe(originalEditor)
    expect(container.querySelector('.ProseMirror')?.innerHTML).toContain('Latest fallback body')

    fireEvent.click(screen.getByRole('button', { name: 'toggle-mode' }))
    await waitFor(() => expect(screen.getByTestId('editor-mode').textContent).toBe('edit'))
    expect(editor).toBe(originalEditor)
    act(() => { originalEditor!.commands.setContent('<p>Newest fallback body</p>') })
    fireEvent.click(screen.getByRole('button', { name: 'toggle-mode' }))

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(2))
    expect(apiCallMock).toHaveBeenLastCalledWith(
      `/api/documents/${DOCUMENT_ID}/content`,
      expect.objectContaining({
        body: JSON.stringify({ contentHtml: '<p>Newest fallback body</p>', contentText: 'Newest fallback body' }),
      }),
    )
    await waitFor(() => expect(screen.getByTestId('editor-mode').textContent).toBe('preview'))
    expect(editor).toBe(originalEditor)
    expect(container.querySelector('.ProseMirror')?.innerHTML).toContain('Newest fallback body')
  })

  it('stays in edit mode when the required fallback save fails', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: false, status: 503, result: { error: 'unavailable' } })
    let editor: Editor | null = null
    render(<EditorHarness onEditorReady={(next) => { if (next) editor = next }} />)

    await waitFor(() => expect(editor).not.toBeNull())
    act(() => { editor!.commands.setContent('<p>Unsaved body</p>') })
    fireEvent.click(screen.getByRole('button', { name: 'toggle-mode' }))

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('editor-mode').textContent).toBe('edit')
    expect(editor!.getHTML()).toBe('<p>Unsaved body</p>')
  })
})
