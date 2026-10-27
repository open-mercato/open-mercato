/** @jest-environment jsdom */

import * as React from 'react'
import { act, renderHook } from '@testing-library/react'
import type { Editor } from '@tiptap/core'

const flashMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: jest.fn(),
    retryLastMutation: jest.fn(async () => false),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

jest.mock('../lib/entitySuggestion', () => ({ insertEntityRef: jest.fn() }))

import { useEditorInsertions } from '../backend/documents/[id]/useEditorInsertions'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'

function editorDouble(runResult: boolean) {
  const run = jest.fn(() => runResult)
  const chain = {
    focus: () => chain,
    extendMarkRange: () => chain,
    setLink: jest.fn(() => chain),
    unsetLink: () => chain,
    run,
  }
  return {
    editor: { chain: () => chain, getAttributes: () => ({}) } as unknown as Editor,
    chain,
    run,
  }
}

function mountHook(editor: Editor) {
  return renderHook(() => useEditorInsertions({
    documentId: DOCUMENT_ID,
    editorRef: { current: editor } as React.RefObject<Editor | null>,
    disabled: false,
    suggestionRange: null,
    setSuggestionRange: jest.fn(),
  }))
}

describe('editor link dialog rejection feedback', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('keeps the dialog open and reports the rejection when TipTap refuses the URL', () => {
    const { editor } = editorDouble(false)
    const { result } = mountHook(editor)

    act(() => { result.current.openLink() })
    act(() => { result.current.setLinkHref('javascript:alert(1)') })
    act(() => { result.current.applyLink() })

    expect(result.current.linkOpen).toBe(true)
    expect(flashMock).toHaveBeenCalledWith('documents.editor.link.rejected', 'error')
  })

  it('closes the dialog silently when TipTap accepts the URL', () => {
    const { editor } = editorDouble(true)
    const { result } = mountHook(editor)

    act(() => { result.current.openLink() })
    act(() => { result.current.setLinkHref('https://example.test/doc') })
    act(() => { result.current.applyLink() })

    expect(result.current.linkOpen).toBe(false)
    expect(flashMock).not.toHaveBeenCalled()
  })

  it('still clears an existing link when the field is emptied', () => {
    const { editor, run } = editorDouble(true)
    const { result } = mountHook(editor)

    act(() => { result.current.openLink() })
    act(() => { result.current.applyLink() })

    expect(run).toHaveBeenCalled()
    expect(result.current.linkOpen).toBe(false)
    expect(flashMock).not.toHaveBeenCalled()
  })
})
