/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { EditorContent } from '@tiptap/react'

const apiCallMock = jest.fn()
const translate = (key: string) => key

const mockEditorIsland = {
  failRender: false,
  mountCount: 0,
}
const mockVersionRestore: { lastError: unknown } = { lastError: null }

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => function MockDocumentEditorIsland({ initialContentHtml }: { initialContentHtml: string }) {
    if (mockEditorIsland.failRender) throw new Error('[internal] editor island failed to mount')
    React.useEffect(() => { mockEditorIsland.mountCount += 1 }, [])
    return <div data-testid="editor-island">{initialContentHtml}</div>
  },
}))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: jest.fn(),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({ buildOptimisticLockHeader: () => ({}) }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => false), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => translate,
  useLocale: () => 'en',
}))
jest.mock('@open-mercato/ui/primitives/link-button', () => ({ LinkButton: () => null }))
jest.mock('@open-mercato/ui/primitives/tooltip', () => ({
  SimpleTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children, onKeyDown }: { children: React.ReactNode; onKeyDown?: React.KeyboardEventHandler<HTMLDivElement> }) => (
    <div role="dialog" onKeyDown={onKeyDown}>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))
jest.mock('../backend/documents/[id]/CommentsRail', () => ({ CommentsRail: () => null }))
jest.mock('../backend/documents/[id]/ExportMenu', () => ({ ExportMenu: () => null }))
jest.mock('../backend/documents/[id]/RelatedRecordsPanel', () => ({ RelatedRecordsPanel: () => null }))
jest.mock('../backend/documents/[id]/DocumentNavigator', () => ({ DocumentNavigator: () => null }))
jest.mock('../backend/documents/[id]/VersionHistoryPanel', () => ({
  VersionHistoryPanel: ({ onRestored }: { onRestored: () => Promise<void> }) => (
    <button
      type="button"
      onClick={() => {
        mockVersionRestore.lastError = null
        void onRestored().catch((error: unknown) => { mockVersionRestore.lastError = error })
      }}
    >
      restore-version
    </button>
  ),
}))
jest.mock('../backend/documents/components/ShareDialog', () => ({ ShareDialog: () => null }))
jest.mock('../backend/documents/components/TemplatePreview', () => ({ TemplatePreview: () => null }))
jest.mock('../backend/documents/components/TemplateSlotFields', () => ({ TemplateSlotFields: () => null }))

import { DocumentPageClient } from '../backend/documents/[id]/DocumentPageClient'
import { useDocumentEditor } from '../backend/documents/[id]/useDocumentEditor'
import { TemplateBodyEditor } from '../backend/documents/components/TemplateBodyEditor'
import { NewFromTemplateDialog } from '../backend/documents/components/NewFromTemplateDialog'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const UPDATED_AT = '2026-07-15T08:00:00.000Z'
const TEMPLATE_UPDATED_AT = '2026-07-10T01:00:00.000Z'

function documentResponse() {
  return {
    ok: true,
    status: 200,
    result: {
      id: DOCUMENT_ID,
      title: 'Quarterly report',
      updatedAt: UPDATED_AT,
      archivedAt: null,
      capabilities: {
        canView: true, canComment: true, canEdit: true, canShare: true, canDelete: true,
        canCreate: true, canManageTemplates: false, canArchive: true, canDuplicate: true,
      },
    },
  }
}

function contentResponse(contentHtml: string) {
  return { ok: true, status: 200, result: { contentHtml, updatedAt: UPDATED_AT } }
}

function installDocumentApi(contentQueue: Array<{ ok: boolean; status: number; result?: unknown }>) {
  apiCallMock.mockImplementation(async (path: string) => {
    if (path === `/api/documents/${DOCUMENT_ID}`) return documentResponse()
    if (path === `/api/documents/${DOCUMENT_ID}/content`) {
      return contentQueue.length > 1 ? contentQueue.shift() : contentQueue[0]
    }
    throw new Error(`Unexpected API call: ${path}`)
  })
}

describe('document editor island failures stay contained in the rendered page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEditorIsland.failRender = false
    mockEditorIsland.mountCount = 0
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => ({ matches: false, media: '', addEventListener: () => undefined, removeEventListener: () => undefined }),
    })
    Element.prototype.scrollIntoView = () => undefined
  })

  it('keeps the surrounding page mounted and recovers through the local retry action', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    installDocumentApi([contentResponse('<p>Body</p>')])
    mockEditorIsland.failRender = true

    render(<DocumentPageClient documentId={DOCUMENT_ID} />)

    const alert = await screen.findByRole('alert')
    const retry = within(alert).getByRole('button', { name: 'documents.actions.retry' })
    expect(screen.queryByTestId('editor-island')).toBeNull()
    // The failure is contained: the page chrome around the island keeps rendering.
    expect(screen.getByRole('button', { name: 'documents.actions.versions' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'documents.actions.share' })).toBeTruthy()

    mockEditorIsland.failRender = false
    await act(async () => { fireEvent.click(retry) })

    expect((await screen.findByTestId('editor-island')).textContent).toBe('<p>Body</p>')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'documents.actions.versions' })).toBeTruthy()
    errorSpy.mockRestore()
  })

  it('only remounts the editor after a successful content refresh', async () => {
    installDocumentApi([
      contentResponse('<p>Body v1</p>'),
      { ok: false, status: 500 },
      contentResponse('<p>Body v2</p>'),
    ])

    render(<DocumentPageClient documentId={DOCUMENT_ID} />)
    expect((await screen.findByTestId('editor-island')).textContent).toBe('<p>Body v1</p>')
    expect(mockEditorIsland.mountCount).toBe(1)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'documents.actions.versions' })) })
    const restore = await screen.findByRole('button', { name: 'restore-version' })
    await act(async () => { fireEvent.click(restore) })

    // A failed refresh must not remount the editor over unrefreshed content.
    expect(mockEditorIsland.mountCount).toBe(1)
    expect(screen.getByTestId('editor-island').textContent).toBe('<p>Body v1</p>')
    expect(mockVersionRestore.lastError).toBeInstanceOf(Error)

    await act(async () => { fireEvent.click(restore) })

    await waitFor(() => expect(screen.getByTestId('editor-island').textContent).toBe('<p>Body v2</p>'))
    expect(mockVersionRestore.lastError).toBeNull()
    expect(mockEditorIsland.mountCount).toBe(2)
  })
})

describe('editable ProseMirror surfaces expose textbox semantics in the DOM', () => {
  function DocumentEditorHarness() {
    const { editor } = useDocumentEditor({
      documentId: DOCUMENT_ID,
      initialContentHtml: '<p>Body</p>',
      editorMode: 'fallback',
      readOnly: false,
      onEntitySuggestion: () => undefined,
      onSuggestionClose: () => undefined,
    })
    return <EditorContent editor={editor} />
  }

  it('names the document editing surface for assistive technology', async () => {
    await act(async () => { render(<DocumentEditorHarness />) })

    const surface = await screen.findByRole('textbox', { name: 'documents.editor.content.ariaLabel' })
    expect(surface.getAttribute('aria-multiline')).toBe('true')
    expect(surface.getAttribute('contenteditable')).toBe('true')
    expect(surface.textContent).toContain('Body')
  })

  it('names the template body surface through its rendered field label', async () => {
    await act(async () => {
      render(<TemplateBodyEditor bodyHtml="<p>Template body</p>" tokenOptions={['{{customer.name}}']} onChange={() => undefined} />)
    })

    const surface = await screen.findByRole('textbox', { name: 'documents.templates.fields.body' })
    expect(surface.getAttribute('aria-multiline')).toBe('true')
    expect(surface.getAttribute('contenteditable')).toBe('true')
    expect(surface.textContent).toContain('Template body')
  })
})

describe('template selection uses a keyboard-accessible radio group', () => {
  const FIRST_TEMPLATE_ID = '22222222-2222-4222-8222-222222222222'
  const SECOND_TEMPLATE_ID = '33333333-3333-4333-8333-333333333333'

  function templateRow(id: string, name: string) {
    return {
      id,
      name,
      description: null,
      contextSlots: [],
      isActive: true,
      updatedAt: TEMPLATE_UPDATED_AT,
      createdAt: TEMPLATE_UPDATED_AT,
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/documents/templates?')) {
        return {
          ok: true,
          status: 200,
          result: {
            items: [templateRow(FIRST_TEMPLATE_ID, 'Customer brief'), templateRow(SECOND_TEMPLATE_ID, 'Service report')],
            total: 2,
            page: 1,
            pageSize: 50,
            totalPages: 1,
          },
        }
      }
      return { ok: true, status: 200, result: { contentHtml: '', unresolvedTokens: [] } }
    })
  })

  it('selects templates with arrow keys instead of an unfocusable option list', async () => {
    render(<NewFromTemplateDialog open onOpenChange={() => undefined} />)

    const group = await screen.findByRole('radiogroup', { name: 'documents.templates.instantiate.template' })
    expect(group.getAttribute('aria-orientation')).toBe('vertical')
    expect(screen.queryByRole('listbox')).toBeNull()

    const first = await screen.findByRole('radio', { name: /Customer brief/ })
    const second = screen.getByRole('radio', { name: /Service report/ })
    expect(first.getAttribute('aria-checked')).toBe('false')
    expect(second.getAttribute('aria-checked')).toBe('false')

    await act(async () => { fireEvent.click(first) })
    expect(first.getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      first.focus()
      fireEvent.keyDown(first, { key: 'ArrowDown' })
    })

    await waitFor(() => expect(second.getAttribute('aria-checked')).toBe('true'))
    expect(first.getAttribute('aria-checked')).toBe('false')
    expect(document.activeElement).toBe(second)
  })
})
