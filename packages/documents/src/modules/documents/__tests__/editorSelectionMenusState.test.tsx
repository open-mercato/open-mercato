/** @jest-environment jsdom */

import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { getDocumentEditorExtensions } from '../lib/editorConfig'

let mockTemplateEditor: Editor | null = null

jest.mock('@tiptap/react', () => {
  const actual = jest.requireActual<typeof import('@tiptap/react')>('@tiptap/react')
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args)
      mockTemplateEditor = editor
      return editor
    },
  }
})

jest.mock('@tiptap/react/menus', () => ({
  BubbleMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

jest.mock('../backend/documents/[id]/OutlinePane', () => ({
  OutlinePane: () => null,
}))

import { DocumentCanvas } from '../backend/documents/[id]/DocumentCanvas'
import { TemplateBodyEditor } from '../backend/documents/components/TemplateBodyEditor'

const title = {
  value: 'Formatting state',
  setValue: jest.fn(),
  saving: false,
  commit: jest.fn(async () => undefined),
  onKeyDown: jest.fn(),
}

describe('selection menu formatting state', () => {
  beforeEach(() => { mockTemplateEditor = null })

  it('updates DocumentCanvas bubble controls after a selection-only transaction', () => {
    const editor = new Editor({
      extensions: getDocumentEditorExtensions(),
      content: '<p><strong>bold</strong> plain</p>',
    })
    editor.commands.setTextSelection(2)

    const { unmount } = render(
      <DocumentCanvas
        editor={editor}
        title={title}
        readOnly={false}
        outlineOpen={false}
        notice={null}
        onOpenLink={jest.fn()}
      />,
    )

    const bold = screen.getByRole('button', { name: 'documents.editor.toolbar.bold' })
    expect(bold.getAttribute('aria-pressed')).toBe('true')

    act(() => { editor.commands.setTextSelection(8) })

    expect(bold.getAttribute('aria-pressed')).toBe('false')
    unmount()
    editor.destroy()
  })

  it('updates template formatting controls after a selection-only transaction', async () => {
    render(
      <TemplateBodyEditor
        bodyHtml="<p><strong>bold</strong> plain</p>"
        tokenOptions={[]}
        onChange={jest.fn()}
      />,
    )

    await waitFor(() => { expect(mockTemplateEditor).not.toBeNull() })
    act(() => { mockTemplateEditor?.commands.setTextSelection(2) })

    const bold = screen.getByRole('button', { name: 'documents.editor.toolbar.bold' })
    expect(bold.getAttribute('aria-pressed')).toBe('true')

    act(() => { mockTemplateEditor?.commands.setTextSelection(8) })

    expect(bold.getAttribute('aria-pressed')).toBe('false')
  })
})
