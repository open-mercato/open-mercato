/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'

// Regression coverage for the #7036 QA NO-GO (@droalina, tracked as #7469):
// changing a code block's language via its dropdown, or deleting a block with
// its trash icon, is lost on save unless the user also types something
// afterward.
//
// Root cause: the code block's language-select / delete controls apply their
// change through a Lexical editor update that resolves *after* the click
// handler returns (the toolbar also moves DOM focus out of the editor as
// part of the same interaction, e.g. Radix Select's `onCloseAutoFocus`
// prevention for the language dropdown). MdxEditorImpl only flushed a
// pending edit to its `onChange` prop on `blur`, so the sequence was:
// blur fires (nothing pending yet) -> commit() no-ops -> the Lexical update
// resolves afterward and buffers the real change -> no further blur ever
// arrives to retry it, so the edit never reaches the form.
//
// This test drives MdxEditorImpl's internal MDXEditor `onChange` callback
// directly (mocked below) to control exactly when the "Lexical update"
// resolves relative to where DOM focus is, without depending on the real
// @mdxeditor/editor + Lexical + CodeMirror stack (which is ESM-only and not
// configured for Jest's transform pipeline).

type PluginMarker = { plugin: string; params?: Record<string, unknown> }

let capturedOnChange: ((markdown: string) => void) | null = null

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
    MDXEditor: React.forwardRef((props: { onChange: (markdown: string) => void }, _ref: unknown) => {
      capturedOnChange = props.onChange
      // Stands in for the contentEditable region / toolbar controls: a
      // focusable element that lives *inside* MdxEditorImpl's wrapping div.
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

    // Something outside the editor — e.g. the form's "Save changes" button —
    // currently holds focus, exactly as it does once a toolbar control (the
    // code block language select, or its own unmount after a delete) has
    // already pushed focus out of the editor and nothing refocused it yet.
    const outsideButton = document.createElement('button')
    document.body.appendChild(outsideButton)
    outsideButton.focus()
    expect(document.activeElement).toBe(outsideButton)

    // The deferred Lexical update now resolves and reports the new markdown.
    // No blur event follows — in the real bug, none ever did.
    act(() => {
      capturedOnChange!('code block language changed')
    })

    expect(onChange).toHaveBeenCalledWith('code block language changed')
    document.body.removeChild(outsideButton)
  })

  it('still buffers an edit until blur while the editor itself is focused (normal typing)', () => {
    const onChange = jest.fn()
    render(<MdxEditorImpl value="original" onChange={onChange} />)
    expect(capturedOnChange).not.toBeNull()

    const editable = screen.getByTestId('mdx-fake-editable')
    editable.focus()
    expect(document.activeElement).toBe(editable)

    act(() => {
      capturedOnChange!('typed text')
    })
    // Buffered: committing on every keystroke would re-render the whole form.
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.blur(screen.getByTestId('mdx-editor-container'))
    expect(onChange).toHaveBeenCalledWith('typed text')
  })
})
