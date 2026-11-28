import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../../../primitives/dialog'

import MdxEditorImpl from '../MdxEditorImpl'

jest.mock('@mdxeditor/editor/style.css', () => ({}), { virtual: true })
jest.mock('../../../theme', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }))
jest.mock('@mdxeditor/editor', () => {
  const ReactModule = require('react') as typeof import('react')
  const { createRequire } = require('node:module') as typeof import('node:module')
  const editorRequire = createRequire(require.resolve('@mdxeditor/editor'))
  const EditorSelect = jest.requireActual<typeof import('@radix-ui/react-select')>(
    editorRequire.resolve('@radix-ui/react-select'),
  )
  const noop = () => null
  return {
    ...Object.fromEntries([
      'headingsPlugin', 'listsPlugin', 'quotePlugin', 'thematicBreakPlugin',
      'linkPlugin', 'linkDialogPlugin', 'imagePlugin', 'tablePlugin', 'codeBlockPlugin', 'codeMirrorPlugin',
      'markdownShortcutPlugin', 'diffSourcePlugin', 'toolbarPlugin',
      'UndoRedo', 'BoldItalicUnderlineToggles', 'CodeToggle', 'StrikeThroughSupSubToggles',
      'ListsToggle', 'BlockTypeSelect', 'CreateLink', 'InsertImage', 'InsertTable',
      'InsertThematicBreak', 'Separator', 'DiffSourceToggleWrapper',
    ].map((name) => [name, noop])),
    MDXEditor: ReactModule.forwardRef(function MockEditor(
      { overlayContainer }: { overlayContainer?: HTMLElement },
      ref,
    ) {
      const [blockType, setBlockType] = ReactModule.useState('paragraph')
      ReactModule.useImperativeHandle(ref, () => ({ setMarkdown: noop }))
      return (
        <EditorSelect.Root value={blockType} onValueChange={setBlockType}>
          <EditorSelect.Trigger aria-label="Block type">
            <EditorSelect.Value />
          </EditorSelect.Trigger>
          <EditorSelect.Portal container={overlayContainer}>
            <EditorSelect.Content position="popper">
              <EditorSelect.Viewport>
                <EditorSelect.Item value="paragraph">
                  <EditorSelect.ItemText>Paragraph</EditorSelect.ItemText>
                </EditorSelect.Item>
                <EditorSelect.Item value="heading">
                  <EditorSelect.ItemText>Heading 1</EditorSelect.ItemText>
                </EditorSelect.Item>
              </EditorSelect.Viewport>
            </EditorSelect.Content>
          </EditorSelect.Portal>
        </EditorSelect.Root>
      )
    }),
  }
})

function EditorDialog() {
  const [open, setOpen] = React.useState(true)

  return (
    <I18nProvider locale="en" dict={{}}>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger>Open editor</DialogTrigger>
        <DialogContent>
          <DialogTitle>Edit activity</DialogTitle>
          <DialogDescription>Change the activity notes.</DialogDescription>
          <MdxEditorImpl onChange={jest.fn()} />
        </DialogContent>
      </Dialog>
    </I18nProvider>
  )
}

async function openBlockTypes() {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Block type' }), { key: 'ArrowDown' })
  const listbox = await screen.findByRole('listbox')
  await waitFor(() => expect(listbox).toContainElement(document.activeElement as HTMLElement))
  return listbox
}

describe('MDXEditor toolbar select inside a Dialog', () => {
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')

  beforeAll(() => {
    Element.prototype.scrollIntoView ??= () => undefined
  })

  afterAll(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView)
    } else {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('closes the dropdown before the dialog and releases pointer locking after Escape', async () => {
    const initialPointerEvents = document.body.style.pointerEvents
    render(<EditorDialog />)
    const dialog = screen.getByRole('dialog', { name: 'Edit activity' })
    const listbox = await openBlockTypes()

    expect(dialog).toContainElement(listbox)
    expect(listbox.closest('[aria-hidden="true"]')).toBeNull()
    fireEvent.keyDown(listbox, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: 'Edit activity' })).toBeInTheDocument()
    expect(document.body.style.pointerEvents).toBe('none')

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(document.body.style.pointerEvents).toBe(initialPointerEvents))
    fireEvent.click(screen.getByRole('button', { name: 'Open editor' }))
    expect(await screen.findByRole('dialog', { name: 'Edit activity' })).toBeInTheDocument()
  })

  it('selects a block type through the editor overlay without dismissing the dialog', async () => {
    render(<EditorDialog />)
    await openBlockTypes()
    const heading = screen.getByRole('option', { name: 'Heading 1' })
    fireEvent.focus(heading)
    fireEvent.keyDown(heading, { key: 'Enter' })

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: 'Block type' })).toHaveTextContent('Heading 1')
    expect(screen.getByRole('dialog', { name: 'Edit activity' })).toBeInTheDocument()
  })
})
