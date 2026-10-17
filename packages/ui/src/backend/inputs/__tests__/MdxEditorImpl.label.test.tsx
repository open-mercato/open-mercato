/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'

// MarkdownField swaps in a plain <textarea> under jest, so the live editor's
// label wiring never runs in the rest of the suite. This file mounts
// MdxEditorImpl against a stand-in for the third-party editor that reproduces
// the one thing the wiring depends on: a `[contenteditable="true"]` node the
// editor owns, which can appear after mount and be replaced later.
const editorControls: { remountContentEditable: () => void; unmountContentEditable: () => void } = {
  remountContentEditable: () => {},
  unmountContentEditable: () => {},
}

jest.mock('@mdxeditor/editor', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react')
  const plugin = () => ({})
  const Empty = () => null
  const MDXEditor = ReactModule.forwardRef(function MDXEditorStub(
    props: { contentEditableClassName?: string },
    ref: React.Ref<{ setMarkdown: (markdown: string) => void }>,
  ) {
    const [generation, setGeneration] = ReactModule.useState(0)
    ReactModule.useImperativeHandle(ref, () => ({ setMarkdown: () => {} }), [])
    ReactModule.useEffect(() => {
      setGeneration(1)
    }, [])
    editorControls.remountContentEditable = () => setGeneration((current) => current + 1)
    editorControls.unmountContentEditable = () => setGeneration(0)
    return (
      <div className="mdxeditor">
        {generation > 0 ? (
          <div key={generation} contentEditable="true" suppressContentEditableWarning className={props.contentEditableClassName} />
        ) : null}
      </div>
    )
  })
  return {
    MDXEditor,
    headingsPlugin: plugin,
    listsPlugin: plugin,
    quotePlugin: plugin,
    thematicBreakPlugin: plugin,
    linkPlugin: plugin,
    linkDialogPlugin: plugin,
    imagePlugin: plugin,
    tablePlugin: plugin,
    markdownShortcutPlugin: plugin,
    diffSourcePlugin: plugin,
    toolbarPlugin: plugin,
    UndoRedo: Empty,
    BoldItalicUnderlineToggles: Empty,
    CodeToggle: Empty,
    StrikeThroughSupSubToggles: Empty,
    ListsToggle: Empty,
    BlockTypeSelect: Empty,
    CreateLink: Empty,
    InsertImage: Empty,
    InsertTable: Empty,
    InsertThematicBreak: Empty,
    Separator: Empty,
    DiffSourceToggleWrapper: Empty,
  }
})

jest.mock('@mdxeditor/editor/style.css', () => ({}), { virtual: true })

jest.mock('../../../theme', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: jest.fn() }),
}))

import MdxEditorImpl from '../MdxEditorImpl'

function contentEditableOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[contenteditable="true"]')
}

describe('MdxEditorImpl label association', () => {
  it('labels the editable region once the editor mounts it', async () => {
    const { container } = render(
      <MdxEditorImpl id="form-notes" ariaLabelledBy="form-notes-label" value="" onChange={jest.fn()} />,
    )

    await waitFor(() => expect(contentEditableOf(container)).toHaveAttribute('aria-labelledby', 'form-notes-label'))
    expect(contentEditableOf(container)).toHaveAttribute('id', 'form-notes')
  })

  it('labels the replacement when the editor swaps its editable region', async () => {
    const { container } = render(
      <MdxEditorImpl id="form-notes" ariaLabelledBy="form-notes-label" value="" onChange={jest.fn()} />,
    )
    await waitFor(() => expect(contentEditableOf(container)).toHaveAttribute('id', 'form-notes'))
    const first = contentEditableOf(container)

    act(() => editorControls.remountContentEditable())

    await waitFor(() => expect(contentEditableOf(container)).not.toBe(first))
    await waitFor(() => expect(contentEditableOf(container)).toHaveAttribute('aria-labelledby', 'form-notes-label'))
    expect(contentEditableOf(container)).toHaveAttribute('id', 'form-notes')
    expect(container.querySelectorAll('#form-notes')).toHaveLength(1)
  })

  it('follows a changed label and id instead of keeping the old ones', async () => {
    const { container, rerender } = render(
      <MdxEditorImpl id="form-notes" ariaLabelledBy="form-notes-label" value="" onChange={jest.fn()} />,
    )
    await waitFor(() => expect(contentEditableOf(container)).toHaveAttribute('id', 'form-notes'))

    rerender(<MdxEditorImpl id="other-notes" ariaLabelledBy="other-notes-label" value="" onChange={jest.fn()} />)

    await waitFor(() => expect(contentEditableOf(container)).toHaveAttribute('aria-labelledby', 'other-notes-label'))
    expect(contentEditableOf(container)).toHaveAttribute('id', 'other-notes')
  })

  it('removes the association when the label is withdrawn', async () => {
    const { container, rerender } = render(
      <MdxEditorImpl id="form-notes" ariaLabelledBy="form-notes-label" value="" onChange={jest.fn()} />,
    )
    await waitFor(() => expect(contentEditableOf(container)).toHaveAttribute('id', 'form-notes'))

    rerender(<MdxEditorImpl value="" onChange={jest.fn()} />)

    await waitFor(() => expect(contentEditableOf(container)).not.toHaveAttribute('aria-labelledby'))
    expect(contentEditableOf(container)).not.toHaveAttribute('id')
  })

  it('leaves the editable region untouched when no label is supplied', async () => {
    const { container } = render(<MdxEditorImpl id="form-notes" value="" onChange={jest.fn()} />)

    await waitFor(() => expect(contentEditableOf(container)).not.toBeNull())
    expect(contentEditableOf(container)).not.toHaveAttribute('aria-labelledby')
    expect(contentEditableOf(container)).not.toHaveAttribute('id')
  })

  it('survives the editor removing its editable region', async () => {
    const { container, unmount } = render(
      <MdxEditorImpl id="form-notes" ariaLabelledBy="form-notes-label" value="" onChange={jest.fn()} />,
    )
    await waitFor(() => expect(contentEditableOf(container)).toHaveAttribute('id', 'form-notes'))

    act(() => editorControls.unmountContentEditable())
    await waitFor(() => expect(contentEditableOf(container)).toBeNull())

    expect(() => unmount()).not.toThrow()
  })
})
