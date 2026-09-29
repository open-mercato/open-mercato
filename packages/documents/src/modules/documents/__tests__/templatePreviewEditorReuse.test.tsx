/** @jest-environment jsdom */

import * as React from 'react'
import { render } from '@testing-library/react'

const setContentMock = jest.fn()
const observedDependencies: unknown[][] = []

jest.mock('@tiptap/react', () => ({
  EditorContent: ({ editor }: { editor: unknown }) => <div data-testid="preview-editor">{editor ? 'ready' : 'loading'}</div>,
  useEditor: (_options: unknown, dependencies: unknown[]) => {
    observedDependencies.push(dependencies)
    return { commands: { setContent: setContentMock } }
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

jest.mock('../lib/editorConfig', () => ({
  getDocumentEditorExtensions: () => [],
}))

import { TemplatePreview } from '../backend/documents/components/TemplatePreview'

function preview(contentHtml: string) {
  return { contentHtml, unresolvedTokens: [] }
}

describe('TemplatePreview editor lifecycle', () => {
  beforeEach(() => {
    setContentMock.mockClear()
    observedDependencies.length = 0
  })

  it('updates content without keying the editor instance to HTML', () => {
    const { rerender } = render(<TemplatePreview preview={preview('<p>First</p>')} isLoading={false} />)

    rerender(<TemplatePreview preview={preview('<p>Second</p>')} isLoading={false} />)

    expect(observedDependencies).toEqual([
      ['documents.editor.entityRef.fallbackLabel'],
      ['documents.editor.entityRef.fallbackLabel'],
    ])
    expect(setContentMock).toHaveBeenLastCalledWith('<p>Second</p>')
  })
})
