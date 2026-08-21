/** @jest-environment jsdom */

import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { getDocumentEditorExtensions } from '../lib/editorConfig'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

import { EditorToolbar } from '../backend/documents/[id]/EditorToolbar'

describe('EditorToolbar selection state', () => {
  let editor: Editor

  beforeEach(() => {
    editor = new Editor({
      extensions: getDocumentEditorExtensions(),
      content: '<p>bold plain</p>',
    })
    editor
      .chain()
      .setTextSelection({ from: 1, to: 5 })
      .setBold()
      .setColor('#dc2626')
      .setHighlight({ color: '#fef08a' })
      .setTextSelection(2)
      .run()
  })

  afterEach(() => editor.destroy())

  it('updates formatting controls when the caret moves between formatted and plain text', () => {
    render(
      <EditorToolbar
        editor={editor}
        disabled={false}
        outlineOpen={false}
        uploading={false}
        onToggleOutline={jest.fn()}
        onOpenEntityPicker={jest.fn()}
        onOpenLink={jest.fn()}
        onImage={jest.fn()}
      />,
    )

    const bold = screen.getByRole('button', { name: 'documents.editor.toolbar.bold' })
    const highlight = screen.getByRole('button', { name: 'documents.editor.toolbar.highlight' })
    const textColor = screen.getByRole('button', { name: 'documents.editor.toolbar.textColor' })
    expect(bold.getAttribute('aria-pressed')).toBe('true')
    expect(highlight.getAttribute('aria-pressed')).toBe('true')
    expect(textColor.getAttribute('aria-pressed')).toBe('true')

    act(() => { editor.commands.setTextSelection(8) })

    expect(bold.getAttribute('aria-pressed')).toBe('false')
    expect(highlight.getAttribute('aria-pressed')).toBe('false')
    expect(textColor.getAttribute('aria-pressed')).toBe('false')
  })
})
