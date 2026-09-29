/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'

let mockBubbleShouldShow: ((selection: { from: number; to: number }) => boolean) | null = null

jest.mock('@tiptap/react', () => ({
  EditorContent: () => <div data-testid="editor-content" />,
  useEditorState: ({ editor, selector }: { editor: Editor | null; selector: (context: { editor: Editor | null }) => unknown }) => selector({ editor }),
}))

jest.mock('@tiptap/react/menus', () => ({
  BubbleMenu: ({ children, shouldShow }: {
    children: React.ReactNode
    shouldShow: (selection: { from: number; to: number }) => boolean
  }) => {
    mockBubbleShouldShow = shouldShow
    return <div data-testid="bubble-menu">{children}</div>
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

jest.mock('../backend/documents/[id]/OutlinePane', () => ({
  OutlinePane: () => null,
}))

import { DocumentCanvas } from '../backend/documents/[id]/DocumentCanvas'

function editor(): Editor {
  const chain = {
    focus: jest.fn(),
    toggleBold: jest.fn(),
    toggleItalic: jest.fn(),
    toggleMark: jest.fn(),
    run: jest.fn(),
  }
  chain.focus.mockReturnValue(chain)
  chain.toggleBold.mockReturnValue(chain)
  chain.toggleItalic.mockReturnValue(chain)
  chain.toggleMark.mockReturnValue(chain)
  return {
    state: {
      selection: { from: 2, to: 6 },
      doc: { content: { size: 12 } },
    },
    isActive: jest.fn(() => false),
    chain: jest.fn(() => chain),
  } as unknown as Editor
}

const title = {
  value: 'Comment-only document',
  setValue: jest.fn(),
  saving: false,
  commit: jest.fn(async () => undefined),
  onKeyDown: jest.fn(),
}

describe('DocumentCanvas commenter selection', () => {
  beforeEach(() => { mockBubbleShouldShow = null })

  it('keeps a comment-only selection menu while the document body is read-only', () => {
    const onComment = jest.fn()
    render(
      <DocumentCanvas
        editor={editor()}
        title={title}
        readOnly
        outlineOpen={false}
        notice={null}
        onOpenLink={jest.fn()}
        onComment={onComment}
      />,
    )

    expect(mockBubbleShouldShow?.({ from: 2, to: 6 })).toBe(true)
    expect(mockBubbleShouldShow?.({ from: 2, to: 2 })).toBe(false)
    expect(screen.queryByRole('button', { name: 'documents.editor.toolbar.bold' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'documents.editor.toolbar.italic' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'documents.editor.toolbar.underline' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'documents.editor.toolbar.link' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'documents.editor.toolbar.comment' }))
    expect(onComment).toHaveBeenCalledWith({ from: 2, to: 6 })
  })

  it('does not show a selection menu to a read-only viewer without comment capability', () => {
    render(
      <DocumentCanvas
        editor={editor()}
        title={title}
        readOnly
        outlineOpen={false}
        notice={null}
        onOpenLink={jest.fn()}
      />,
    )

    expect(mockBubbleShouldShow?.({ from: 2, to: 6 })).toBe(false)
    expect(screen.queryByRole('button', { name: 'documents.editor.toolbar.comment' })).toBeNull()
  })
})
