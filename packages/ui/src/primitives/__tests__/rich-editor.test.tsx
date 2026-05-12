/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  RICH_EDITOR_COLOR_PALETTE,
  RichEditor,
  RichEditorColorButton,
  RichEditorColorPalette,
  RichEditorContent,
  RichEditorDivider,
  RichEditorDropdownButton,
  RichEditorIconButton,
  RichEditorTextDropdown,
  RichEditorToolbar,
} from '../rich-editor'

// jsdom does not implement execCommand / queryCommandState. Provide stub-grade
// implementations so the primitive can run its toolbar wiring under tests.
let execMock: jest.Mock
let queryStateMock: jest.Mock
let queryValueMock: jest.Mock

beforeEach(() => {
  execMock = jest.fn(() => true)
  queryStateMock = jest.fn(() => false)
  queryValueMock = jest.fn(() => '')
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execMock })
  Object.defineProperty(document, 'queryCommandState', { configurable: true, value: queryStateMock })
  Object.defineProperty(document, 'queryCommandValue', { configurable: true, value: queryValueMock })
})

describe('RichEditor — variant presets', () => {
  it('minimal renders Bold / Italic / Underline only (no list, no link)', () => {
    const onChange = jest.fn()
    render(<RichEditor value="" onChange={onChange} variant="minimal" />)
    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Italic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Underline' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bullet list' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Link' })).toBeNull()
  })

  it('basic adds list + link, omits header + strikethrough + color', () => {
    render(<RichEditor value="" onChange={jest.fn()} variant="basic" />)
    expect(screen.getByRole('button', { name: 'Bullet list' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Link' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Header' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Strikethrough' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Text color' })).toBeNull()
  })

  it('standard adds Header dropdown but skips strikethrough/color/font-size/align', () => {
    render(<RichEditor value="" onChange={jest.fn()} variant="standard" />)
    expect(screen.getByRole('button', { name: 'Header' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Strikethrough' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Text color' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Font size' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Align' })).toBeNull()
  })

  it('full renders the Figma 166331:4006 toolbar (header + font-size + color + B/I/U/S + lists + align + link)', () => {
    render(<RichEditor value="" onChange={jest.fn()} variant="full" />)
    expect(screen.getByRole('button', { name: 'Header' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Font size' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Text color' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Strikethrough' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Numbered list' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Align' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Link' })).toBeInTheDocument()
    // Comment / Mention / More are opt-in via handler/menu props — not rendered by default.
    expect(screen.queryByRole('button', { name: 'Add comment' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mention' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  })

  it('full opts in Comment / Mention / More when handlers + menu are provided', () => {
    render(
      <RichEditor
        value=""
        onChange={jest.fn()}
        variant="full"
        onComment={() => {}}
        onMention={() => {}}
        moreMenu={<div>menu</div>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Add comment' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mention' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
  })
})

describe('RichEditor — execCommand wiring', () => {
  it('clicking Bold calls document.execCommand("bold")', () => {
    render(<RichEditor value="" onChange={jest.fn()} variant="minimal" />)
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    expect(execMock).toHaveBeenCalledWith('bold', false, undefined)
  })

  it('clicking Bullet list calls execCommand("insertUnorderedList")', () => {
    render(<RichEditor value="" onChange={jest.fn()} variant="basic" />)
    fireEvent.click(screen.getByRole('button', { name: 'Bullet list' }))
    expect(execMock).toHaveBeenCalledWith('insertUnorderedList', false, undefined)
  })

  it('Cmd+B keyboard shortcut on the content area triggers exec("bold")', () => {
    const { container } = render(<RichEditor value="" onChange={jest.fn()} variant="minimal" />)
    const content = container.querySelector('[data-slot="rich-editor-content"]')!
    fireEvent.keyDown(content, { key: 'b', metaKey: true })
    expect(execMock).toHaveBeenCalledWith('bold', false, undefined)
  })

  it('reflects queryCommandState in data-active on toggle buttons', () => {
    queryStateMock.mockImplementation((cmd: string) => cmd === 'bold')
    const { container } = render(<RichEditor value="" onChange={jest.fn()} variant="minimal" />)
    // Force a selectionchange so the selection state hook latches the mocked value.
    fireEvent(document, new Event('selectionchange'))
    // Render hasn't re-derived yet because the editor's anchorNode is empty.
    // Force a click on Bold which calls refreshSelectionState() at the end.
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    const boldButton = container.querySelector('button[aria-label="Bold"]')!
    expect(boldButton.getAttribute('data-active')).toBe('true')
  })
})

describe('RichEditor — content area + onChange', () => {
  it('renders the placeholder via data-placeholder attribute', () => {
    const { container } = render(
      <RichEditor value="" onChange={jest.fn()} variant="minimal" placeholder="Write a note…" />,
    )
    const content = container.querySelector('[data-slot="rich-editor-content"]')
    expect(content?.getAttribute('data-placeholder')).toBe('Write a note…')
  })

  it('calls onChange with the sanitized content on blur', () => {
    const onChange = jest.fn()
    const { container } = render(<RichEditor value="" onChange={onChange} variant="minimal" />)
    const content = container.querySelector('[data-slot="rich-editor-content"]') as HTMLDivElement
    content.innerHTML = '<p>hello <script>alert(1)</script></p>'
    fireEvent.blur(content)
    expect(onChange).toHaveBeenCalledTimes(1)
    const value = onChange.mock.calls[0][0]
    // Sanitizer drops <script>, keeps inline text.
    expect(value).not.toContain('<script>')
    expect(value).toContain('hello')
  })

  it('makes the content non-editable when disabled', () => {
    const { container } = render(
      <RichEditor value="" onChange={jest.fn()} variant="minimal" disabled />,
    )
    const content = container.querySelector('[data-slot="rich-editor-content"]')!
    expect(content.getAttribute('contenteditable')).toBe('false')
  })

  it('forwards aria-invalid to the root container', () => {
    const { container } = render(
      <RichEditor value="" onChange={jest.fn()} variant="minimal" aria-invalid />,
    )
    const root = container.querySelector('[data-slot="rich-editor"]')!
    expect(root.getAttribute('aria-invalid')).toBe('true')
  })
})

describe('RichEditorColorPalette + RichEditorColorButton', () => {
  it('renders all 10 palette swatches', () => {
    const onChange = jest.fn()
    const { container } = render(<RichEditorColorPalette onChange={onChange} />)
    const swatches = container.querySelectorAll('[data-color-key]')
    expect(swatches).toHaveLength(10)
  })

  it('uses the configured Figma palette values verbatim', () => {
    const { container } = render(<RichEditorColorPalette />)
    // After the Profile Dropdown Items layout switch the swatch lives in an
    // inner <span> sibling of the label, so query the swatch span explicitly.
    const blue = container.querySelector('[data-color-key="blue"] span[aria-hidden="true"]') as HTMLElement
    expect(blue.style.backgroundColor).toMatch(/rgb\(99,\s*102,\s*241\)|#6366f1/i)
    expect(RICH_EDITOR_COLOR_PALETTE.blue).toBe('#6366f1')
  })

  it('emits onChange when a swatch is clicked', () => {
    const onChange = jest.fn()
    render(<RichEditorColorPalette onChange={onChange} />)
    const red = document.querySelector('[data-color-key="red"]') as HTMLElement
    fireEvent.click(red)
    expect(onChange).toHaveBeenCalledWith('red')
  })

  it('full variant exposes the Text color trigger swatch', () => {
    const { container } = render(<RichEditor value="" onChange={jest.fn()} variant="full" />)
    const colorButton = container.querySelector('button[aria-label="Text color"]')!
    expect(colorButton).not.toBeNull()
    expect(colorButton.querySelector('[data-slot="rich-editor-color-swatch"]')).not.toBeNull()
  })
})

describe('RichEditor — custom variant + compound API', () => {
  it("variant='custom' renders the supplied children (no preset toolbar items)", () => {
    const onActivate = jest.fn()
    render(
      <RichEditor value="" onChange={jest.fn()} variant="custom">
        <RichEditorToolbar>
          <RichEditorIconButton
            icon={<span data-testid="x-icon" />}
            ariaLabel="Custom"
            onActivate={onActivate}
          />
          <RichEditorDivider />
        </RichEditorToolbar>
        <RichEditorContent placeholder="custom" />
      </RichEditor>,
    )
    expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument()
    // No preset Bold button present in custom mode.
    expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('throws when toolbar atoms are rendered outside <RichEditor>', () => {
    // Suppress noisy React error logging for this expected throw.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(<RichEditorIconButton icon={<span />} ariaLabel="loose" />),
    ).toThrow(/must be rendered inside <RichEditor>/)
    spy.mockRestore()
  })

  it('marks the toolbar slot with role="toolbar" and data-slot', () => {
    const { container } = render(<RichEditor value="" onChange={jest.fn()} variant="basic" />)
    const toolbar = container.querySelector('[data-slot="rich-editor-toolbar"]')
    expect(toolbar).not.toBeNull()
    expect(toolbar?.getAttribute('role')).toBe('toolbar')
  })
})

describe('RichEditorDropdownButton + RichEditorTextDropdown', () => {
  it("RichEditorDropdownButton renders inside <RichEditor variant='custom'>", () => {
    render(
      <RichEditor value="" onChange={jest.fn()} variant="custom">
        <RichEditorToolbar>
          <RichEditorDropdownButton
            icon={<span data-testid="more-icon" />}
            ariaLabel="More"
            menu={<div>menu</div>}
          />
        </RichEditorToolbar>
      </RichEditor>,
    )
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
  })

  it("RichEditorTextDropdown renders a labelled trigger inside <RichEditor variant='custom'>", () => {
    render(
      <RichEditor value="" onChange={jest.fn()} variant="custom">
        <RichEditorToolbar>
          <RichEditorTextDropdown ariaLabel="Heading" label="H1" menu={<div>menu</div>} />
        </RichEditorToolbar>
      </RichEditor>,
    )
    const trigger = screen.getByRole('button', { name: 'Heading' })
    expect(trigger.textContent).toContain('H1')
  })

  it("RichEditorColorButton renders inside <RichEditor variant='custom'>", () => {
    render(
      <RichEditor value="" onChange={jest.fn()} variant="custom">
        <RichEditorToolbar>
          <RichEditorColorButton ariaLabel="Pick color" colorValue="purple" />
        </RichEditorToolbar>
      </RichEditor>,
    )
    const trigger = screen.getByRole('button', { name: 'Pick color' })
    const swatch = trigger.querySelector('[data-slot="rich-editor-color-swatch"]') as HTMLElement
    expect(swatch?.style.backgroundColor).toMatch(/rgb\(125,\s*82,\s*244\)|#7d52f4/i)
  })
})
