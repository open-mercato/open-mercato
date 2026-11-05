import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { Button } from '../../../primitives/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../../primitives/dialog'
import MdxEditorImpl from '../MdxEditorImpl'

jest.mock('@mdxeditor/editor/style.css', () => ({}), { virtual: true })
jest.mock('../../../theme', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }))
jest.mock('@mdxeditor/editor', () => {
  const ReactModule = require('react') as typeof import('react')
  const { createPortal } = require('react-dom') as typeof import('react-dom')
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
      const [popup, setPopup] = ReactModule.useState<HTMLElement | null>(null)
      ReactModule.useImperativeHandle(ref, () => ({ setMarkdown: noop }))
      ReactModule.useEffect(() => {
        const element = document.createElement('div')
        element.className = 'mdxeditor-popup-container'
        const target = overlayContainer ?? document.body
        target.appendChild(element)
        setPopup(element)
        return () => element.remove()
      }, [overlayContainer])
      return popup ? createPortal(
        <div role="listbox" aria-label="Block type"><div role="option">Heading 2</div></div>,
        popup,
      ) : null
    }),
  }
})

function EditorDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild><Button type="button">Open editor</Button></DialogTrigger>
      <DialogContent>
        <DialogTitle>Edit notes</DialogTitle>
        <DialogDescription>Change the Markdown notes.</DialogDescription>
        <MdxEditorImpl onChange={jest.fn()} />
        <DialogClose asChild><Button type="button">Close editor</Button></DialogClose>
      </DialogContent>
    </Dialog>
  )
}

describe('Markdown popup accessibility', () => {
  it('keeps popup options accessible inside the active dialog across reopen cycles', async () => {
    renderWithProviders(<><div data-testid="background-content">Background content</div><EditorDialog /></>)

    for (let cycle = 0; cycle < 3; cycle += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Open editor' }))
      const dialog = await screen.findByRole('dialog', { name: 'Edit notes' })
      const heading = await screen.findByRole('option', { name: 'Heading 2' })
      expect(dialog).toContainElement(heading)
      expect(heading.closest('[aria-hidden="true"]')).toBeNull()
      expect(screen.getByTestId('background-content').closest('[aria-hidden="true"]')).not.toBeNull()
      expect(document.querySelectorAll('.mdxeditor-popup-container')).toHaveLength(1)

      fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await waitFor(() => expect(document.querySelector('.mdxeditor-popup-container')).toBeNull())
    }
  })

  it('preserves body-level popup hosting outside a dialog', async () => {
    const { unmount } = renderWithProviders(<MdxEditorImpl onChange={jest.fn()} />)
    const heading = await screen.findByRole('option', { name: 'Heading 2' })
    expect(heading.closest('.mdxeditor-popup-container')?.parentElement).toBe(document.body)
    unmount()
    expect(document.querySelector('.mdxeditor-popup-container')).toBeNull()
  })
})
