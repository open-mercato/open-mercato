/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'


type PluginMarker = { plugin: string; params?: Record<string, unknown> }

let capturedOnChange: ((markdown: string, initialMarkdownNormalize?: boolean) => void) | null = null

jest.mock('@mdxeditor/editor/style.css', () => ({}), { virtual: true })

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

jest.mock('../../../theme', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}))

jest.mock('@mdxeditor/editor', () => {
  const marker = (plugin: string) => (params?: Record<string, unknown>) => ({ plugin, params })
  const Noop = () => null
  return {
    MDXEditor: React.forwardRef((props: { onChange: (markdown: string, initialMarkdownNormalize?: boolean) => void }, _ref: unknown) => {
      capturedOnChange = props.onChange
      return React.createElement('button', { type: 'button', 'data-testid': 'mdx-fake-editable' })
    }),
    headingsPlugin: marker('headings'),
    listsPlugin: marker('lists'),
    quotePlugin: marker('quote'),
    thematicBreakPlugin: marker('thematicBreak'),
    linkPlugin: marker('link'),
    linkDialogPlugin: marker('linkDialog'),
    imagePlugin: marker('image'),
    tablePlugin: marker('table'),
    codeBlockPlugin: marker('codeBlock'),
    codeMirrorPlugin: marker('codeMirror'),
    markdownShortcutPlugin: marker('markdownShortcut'),
    diffSourcePlugin: marker('diffSource'),
    toolbarPlugin: marker('toolbar'),
    UndoRedo: Noop,
    BoldItalicUnderlineToggles: Noop,
    CodeToggle: Noop,
    StrikeThroughSupSubToggles: Noop,
    ListsToggle: Noop,
    BlockTypeSelect: Noop,
    CreateLink: Noop,
    InsertImage: Noop,
    InsertTable: Noop,
    InsertThematicBreak: Noop,
    Separator: Noop,
    DiffSourceToggleWrapper: Noop,
  }
})

import MdxEditorImpl from '../MdxEditorImpl'

describe('MdxEditorImpl code block save', () => {
  beforeEach(() => {
    capturedOnChange = null
  })

  it('commits an edit that resolves after focus has already left the editor (code block language change / delete)', () => {
    const onChange = jest.fn()
    render(<MdxEditorImpl value="original" onChange={onChange} />)
    expect(capturedOnChange).not.toBeNull()

    const outsideButton = document.createElement('button')
    document.body.appendChild(outsideButton)
    outsideButton.focus()
    expect(document.activeElement).toBe(outsideButton)

    act(() => {
      capturedOnChange!('code block language changed')
    })

    expect(onChange).toHaveBeenCalledWith('code block language changed')
    document.body.removeChild(outsideButton)
  })

  it('does not flush MDXEditor initial-markdown normalization even when focus is outside the editor', () => {
    const onChange = jest.fn()
    render(<MdxEditorImpl value="original" onChange={onChange} />)
    expect(capturedOnChange).not.toBeNull()
    expect(document.activeElement).toBe(document.body)

    act(() => {
      capturedOnChange!('normalized', true)
    })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('publishes normal typing immediately and does not repeat it on blur', () => {
    const onChange = jest.fn()
    render(<MdxEditorImpl value="original" onChange={onChange} />)
    expect(capturedOnChange).not.toBeNull()

    const editable = screen.getByTestId('mdx-fake-editable')
    editable.focus()
    expect(document.activeElement).toBe(editable)

    act(() => {
      capturedOnChange!('typed text')
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('typed text')

    fireEvent.blur(screen.getByTestId('mdx-editor-container'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
