/** @jest-environment jsdom */

import * as React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { getSchema, type Editor } from '@tiptap/core'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror'
import { getDocumentEditorExtensions, COLLAB_FRAGMENT_FIELD } from '../lib/editorConfig'

const mockApiCall = jest.fn()
const mockTranslate = (key: string) => key
const mockProviders: Array<{
  document: Y.Doc
  emit: (event: string, payload?: unknown) => void
  destroy: jest.Mock
}> = []

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => unknown }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: () => false }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@tiptap/react/menus', () => ({ BubbleMenu: () => null }))
jest.mock('../backend/documents/[id]/EditorToolbar', () => ({ EditorToolbar: () => null }))
jest.mock('../backend/documents/[id]/RecordFieldsDialog', () => ({ RecordFieldsDialog: () => null }))
jest.mock('../backend/documents/components/EntityPicker', () => ({ EntityPicker: () => null }))
jest.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: jest.fn().mockImplementation((configuration: { document: Y.Doc }) => {
    const handlers = new Map<string, Array<(payload?: unknown) => void>>()
    const awareness = new Awareness(configuration.document)
    const provider = {
      document: configuration.document,
      awareness,
      configuration: {
        websocketProvider: {
          status: 'connected',
          webSocket: { close: jest.fn() },
          connect: jest.fn(),
          disconnect: jest.fn(),
        },
      },
      on: (event: string, handler: (payload?: unknown) => void) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler])
      },
      emit: (event: string, payload?: unknown) => {
        for (const handler of handlers.get(event) ?? []) handler(payload)
      },
      destroy: jest.fn(() => awareness.destroy()),
    }
    mockProviders.push(provider)
    return provider
  }),
}))

import DocumentEditorIsland from '../backend/documents/[id]/DocumentEditorIsland'
import {
  COLLABORATION_INITIAL_TIMEOUT_MS,
  COLLABORATION_OFFLINE_AFTER_MS,
} from '../backend/documents/[id]/useDocumentCollaboration'
import { FALLBACK_AUTOSAVE_DELAY_MS } from '../backend/documents/[id]/useFallbackContentPersistence'

const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222'
const UPDATED_AT = '2026-10-26T00:00:00.000Z'

async function openDocument(readOnly = false) {
  const onEditorReady = jest.fn<void, [Editor | null]>()
  render(<DocumentEditorIsland
    documentId={DOCUMENT_ID}
    title="Initial sync"
    initialContentHtml="<p>Saved body</p>"
    contentUpdatedAt={UPDATED_AT}
    readOnly={readOnly}
    onEditorReady={onEditorReady}
  />)
  await act(async () => { await jest.advanceTimersByTimeAsync(0) })
  return {
    provider: mockProviders[0]!,
    onEditorReady,
    editor: () => {
      const editor = onEditorReady.mock.calls.map(([value]) => value).findLast((value) => value !== null)
      if (!editor) throw new Error('Expected a mounted editor')
      return editor
    },
  }
}

function syncDocument(provider: typeof mockProviders[number]) {
  const schema = getSchema(getDocumentEditorExtensions())
  prosemirrorJSONToYXmlFragment(schema, {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synced body' }] }],
  }, provider.document.getXmlFragment(COLLAB_FRAGMENT_FIELD))
  provider.emit('synced', { state: true })
}

describe('document editor initial collaboration sync', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockProviders.length = 0
    mockApiCall.mockReset()
    mockApiCall.mockImplementation(async (path: string) => ({
      ok: true,
      status: 200,
      result: path.endsWith('/collab-token') ? {
        token: 'test-token',
        url: 'ws://localhost:4101',
        documentId: DOCUMENT_ID,
        tier: 'editor',
        expiresInSec: 60,
        canEdit: true,
        readOnly: false,
        user: { id: '11111111-1111-4111-8111-111111111111', name: 'Test editor', color: '#123456' },
      } : { updatedAt: UPDATED_AT },
    }))
  })

  afterEach(() => {
    cleanup()
    jest.useRealTimers()
  })

  it('withholds editing before initial sync and opens the saved fallback after the timeout', async () => {
    const session = await openDocument()
    act(() => session.provider.emit('status', { status: 'connected' }))
    await act(async () => { await jest.advanceTimersByTimeAsync(COLLABORATION_INITIAL_TIMEOUT_MS - 1) })

    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(session.onEditorReady).not.toHaveBeenCalled()
    expect(screen.getByText('documents.editor.loading')).toBeTruthy()

    await act(async () => { await jest.advanceTimersByTimeAsync(1) })
    await act(async () => { await jest.advanceTimersByTimeAsync(0) })
    expect(session.provider.destroy).toHaveBeenCalledTimes(1)
    expect(session.editor().getText()).toBe('Saved body')
    expect(screen.getByRole('textbox', { name: 'documents.editor.content.ariaLabel' }).getAttribute('contenteditable')).toBe('true')

    act(() => session.editor().view.dispatch(session.editor().state.tr.insertText(' after timeout', 11)))
    await act(async () => { await jest.advanceTimersByTimeAsync(FALLBACK_AUTOSAVE_DELAY_MS) })
    expect(mockApiCall).toHaveBeenCalledWith(`/api/documents/${DOCUMENT_ID}/content`, expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ contentHtml: '<p>Saved body after timeout</p>', contentText: 'Saved body after timeout' }),
    }))
    act(() => session.provider.emit('synced', { state: true }))
    expect(session.editor().getText()).toBe('Saved body after timeout')
  })

  it('opens the synced content and retains the editor and local edits during later outages', async () => {
    const session = await openDocument()
    act(() => syncDocument(session.provider))
    await act(async () => { await jest.advanceTimersByTimeAsync(0) })
    const editor = session.editor()
    expect(editor.getText()).toBe('Synced body')
    expect(editor.isEditable).toBe(true)

    act(() => editor.view.dispatch(editor.state.tr.insertText(' local edit', 12)))
    act(() => session.provider.emit('disconnect'))
    await act(async () => { await jest.advanceTimersByTimeAsync(COLLABORATION_OFFLINE_AFTER_MS) })

    expect(session.editor()).toBe(editor)
    expect(editor.getText()).toBe('Synced body local edit')
    expect(editor.isEditable).toBe(true)
    expect(session.provider.destroy).not.toHaveBeenCalled()
    expect(screen.queryByText('documents.editor.loading')).toBeNull()
    act(() => session.provider.emit('synced', { state: true }))
    expect(session.editor()).toBe(editor)
  })

  it('preserves read-only access after initial sync', async () => {
    const session = await openDocument(true)
    act(() => syncDocument(session.provider))
    await act(async () => { await jest.advanceTimersByTimeAsync(0) })
    expect(session.editor().getText()).toBe('Synced body')
    expect(session.editor().isEditable).toBe(false)
  })
})
