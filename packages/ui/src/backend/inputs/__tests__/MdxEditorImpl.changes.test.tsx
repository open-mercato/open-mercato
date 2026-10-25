import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'

type EditorProps = {
  markdown: string
  onChange: (markdown: string, initialMarkdownNormalize?: boolean) => void
}

let mockEditorProps: EditorProps
const mockSetMarkdown = jest.fn()

jest.mock('@mdxeditor/editor/style.css', () => ({}), { virtual: true })
jest.mock('../../../theme', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}))
jest.mock('@mdxeditor/editor', () => {
  const ReactModule = require('react') as typeof React
  const noop = () => null
  return {
    ...Object.fromEntries([
      'headingsPlugin', 'listsPlugin', 'quotePlugin', 'thematicBreakPlugin',
      'linkPlugin', 'linkDialogPlugin', 'imagePlugin', 'tablePlugin',
      'markdownShortcutPlugin', 'diffSourcePlugin', 'toolbarPlugin',
      'UndoRedo', 'BoldItalicUnderlineToggles', 'CodeToggle',
      'StrikeThroughSupSubToggles', 'ListsToggle', 'BlockTypeSelect',
      'CreateLink', 'InsertImage', 'InsertTable', 'InsertThematicBreak',
      'Separator', 'DiffSourceToggleWrapper',
    ].map((name) => [name, noop])),
    MDXEditor: ReactModule.forwardRef(function MockEditor(props: EditorProps, ref) {
      mockEditorProps = props
      ReactModule.useImperativeHandle(ref, () => ({ setMarkdown: mockSetMarkdown }))
      return ReactModule.createElement('textarea', { 'aria-label': 'Markdown editor' })
    }),
  }
})

import MdxEditorImpl from '../MdxEditorImpl'

const originalMarkdown = 'Introduction\n\n```text\nTagged block\n```'

function SavedEditor({ onSave }: { onSave: (markdown: string) => void }) {
  const [value, setValue] = React.useState(originalMarkdown)
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSave(value) }}>
      <MdxEditorImpl value={value} onChange={setValue} />
      <button type="submit">Save</button>
    </form>
  )
}

describe('MdxEditorImpl change propagation', () => {
  beforeEach(() => {
    mockSetMarkdown.mockReset()
  })

  it('saves a language change published after the language control blurs', () => {
    const onSave = jest.fn()
    render(<SavedEditor onSave={onSave} />)
    fireEvent.blur(screen.getByRole('textbox'))
    const changedMarkdown = originalMarkdown.replace('```text', '```json')

    act(() => mockEditorProps.onChange(changedMarkdown))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith(changedMarkdown)
  })

  it('saves a block deletion without another editor blur or keystroke', () => {
    const onSave = jest.fn()
    render(<SavedEditor onSave={onSave} />)

    act(() => mockEditorProps.onChange('Introduction'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith('Introduction')
  })

  it('does not reimport controlled value echoes while editing', () => {
    render(<SavedEditor onSave={jest.fn()} />)

    act(() => mockEditorProps.onChange('Updated introduction'))

    expect(mockEditorProps.markdown).toBe('Updated introduction')
    expect(mockSetMarkdown).not.toHaveBeenCalled()
  })

  it('applies a rewritten controlled value from the form without republishing it', () => {
    const onChange = jest.fn()
    function RewritingEditor() {
      const [value, setValue] = React.useState(originalMarkdown)
      return <MdxEditorImpl value={value} onChange={(markdown) => {
        onChange(markdown)
        setValue(markdown.trim())
      }} />
    }
    render(<RewritingEditor />)

    act(() => mockEditorProps.onChange('  Updated introduction  '))

    expect(mockSetMarkdown).toHaveBeenCalledWith('Updated introduction')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('  Updated introduction  ')
  })

  it('applies an external form reset after an editor change', () => {
    const onChange = jest.fn()
    const { rerender } = render(<MdxEditorImpl value={originalMarkdown} onChange={onChange} />)
    act(() => mockEditorProps.onChange('An edit'))

    rerender(<MdxEditorImpl value="Reset value" onChange={onChange} />)

    expect(mockSetMarkdown).toHaveBeenCalledWith('Reset value')
  })

  it('does not mark initialization normalization as a user edit', () => {
    const onChange = jest.fn()
    render(<MdxEditorImpl value={originalMarkdown} onChange={onChange} />)

    act(() => mockEditorProps.onChange(`${originalMarkdown}\n`, true))
    fireEvent.blur(screen.getByRole('textbox'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not notify for unchanged Markdown or an external reset', () => {
    const onChange = jest.fn()
    const { rerender } = render(<MdxEditorImpl value={originalMarkdown} onChange={onChange} />)

    act(() => mockEditorProps.onChange(originalMarkdown))
    rerender(<MdxEditorImpl value="Reset value" onChange={onChange} />)
    fireEvent.blur(screen.getByRole('textbox'))

    expect(onChange).not.toHaveBeenCalled()
  })
})
