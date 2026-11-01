import * as React from 'react'
import { createRequire } from 'node:module'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../../../primitives/dialog'

const editorRequire = createRequire(require.resolve('@mdxeditor/editor'))
const EditorSelect = jest.requireActual<typeof import('@radix-ui/react-select')>(
  editorRequire.resolve('@radix-ui/react-select'),
)

function EditorDialog() {
  const [open, setOpen] = React.useState(true)
  const [blockType, setBlockType] = React.useState('paragraph')

  return (
    <I18nProvider locale="en" dict={{}}>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger>Open editor</DialogTrigger>
        <DialogContent>
          <DialogTitle>Edit activity</DialogTitle>
          <DialogDescription>Change the activity notes.</DialogDescription>
          <EditorSelect.Root value={blockType} onValueChange={setBlockType}>
            <EditorSelect.Trigger aria-label="Block type">
              <EditorSelect.Value />
            </EditorSelect.Trigger>
            <EditorSelect.Portal>
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
  beforeAll(() => {
    Element.prototype.scrollIntoView ??= () => undefined
  })

  it('closes the dropdown before the dialog and releases pointer locking after Escape', async () => {
    const initialPointerEvents = document.body.style.pointerEvents
    render(<EditorDialog />)
    const dialog = screen.getByRole('dialog', { name: 'Edit activity' })
    const listbox = await openBlockTypes()

    expect(dialog).not.toContainElement(listbox)
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

  it('selects a block type through the body portal without dismissing the dialog', async () => {
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
