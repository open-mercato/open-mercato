import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentOverrideProvider } from '../../injection/ComponentOverrideProvider'
import MarkdownField, { MARKDOWN_FIELD_COMPONENT_HANDLE, type MarkdownFieldProps } from '../MarkdownField'
import MdxEditorImpl from '../MdxEditorImpl'

type Plugin = { name: string; params?: { codeBlockLanguages?: Record<string, string> } }
let mockPlugins: Plugin[] = []
const mockSetMarkdown = jest.fn()
const mockMount = jest.fn()
const mockUnmount = jest.fn()
let mockLocale = 'en'

jest.mock('@mdxeditor/editor/style.css', () => ({}), { virtual: true })
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback: string) => mockLocale === 'pl' && key === 'custom.languages.script' ? 'Skrypt' : fallback,
}))
jest.mock('../../../theme', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }))
jest.mock('@mdxeditor/editor', () => {
  const ReactModule = require('react') as typeof React
  const Noop = () => null
  return {
    ...Object.fromEntries([
      'headingsPlugin', 'listsPlugin', 'quotePlugin', 'thematicBreakPlugin', 'linkPlugin',
      'linkDialogPlugin', 'imagePlugin', 'tablePlugin', 'codeBlockPlugin', 'codeMirrorPlugin',
      'markdownShortcutPlugin', 'diffSourcePlugin', 'toolbarPlugin',
    ].map((name) => [name, (params?: Plugin['params']) => ({ name, params })])),
    ...Object.fromEntries([
      'UndoRedo', 'BoldItalicUnderlineToggles', 'CodeToggle', 'StrikeThroughSupSubToggles',
      'ListsToggle', 'BlockTypeSelect', 'CreateLink', 'InsertImage', 'InsertTable',
      'InsertThematicBreak', 'Separator', 'DiffSourceToggleWrapper',
    ].map((name) => [name, Noop])),
    MDXEditor: ReactModule.forwardRef(function Editor(props: {
      plugins: Plugin[]; markdown: string; onChange: (value: string) => void
    }, ref) {
      mockPlugins = props.plugins
      ReactModule.useImperativeHandle(ref, () => ({ setMarkdown: mockSetMarkdown }))
      ReactModule.useEffect(() => { mockMount(); return () => { mockUnmount() } }, [])
      return ReactModule.createElement('textarea', {
        'aria-label': 'Markdown', defaultValue: props.markdown,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => props.onChange(event.target.value),
      })
    }),
  }
})

const liveEditor: ComponentOverride<MarkdownFieldProps> = {
  target: { componentId: MARKDOWN_FIELD_COMPONENT_HANDLE }, priority: 0,
  wrapper: () => MdxEditorImpl,
}

function options() {
  return mockPlugins.find((plugin) => plugin.name === 'codeMirrorPlugin')?.params?.codeBlockLanguages
}

function EditorHost({ overrides }: { overrides: ComponentOverride<MarkdownFieldProps>[] }) {
  const [value, setValue] = React.useState('```js\noriginal\n```')
  return (
    <ComponentOverrideProvider overrides={[liveEditor, ...overrides] as ComponentOverride[]}>
      <MarkdownField value={value} onChange={setValue} codeBlockLanguages={{ php: 'PHP' }} />
    </ComponentOverrideProvider>
  )
}

beforeEach(() => {
  mockLocale = 'en'
  mockPlugins = []
  jest.clearAllMocks()
})

it('applies module-style props transforms through the real host and composes a direct patch', () => {
  const overrides: ComponentOverride<MarkdownFieldProps>[] = [{
    target: { componentId: MARKDOWN_FIELD_COMPONENT_HANDLE }, priority: 10,
    propsTransform: (props) => ({ ...props, codeBlockLanguages: {
      ...props.codeBlockLanguages, rust: 'Rust', js: 'ECMAScript', sql: null,
    } }),
  }]
  const { container } = render(<EditorHost overrides={overrides} />)
  expect(container.querySelector('[data-component-handle="section:ui.inputs.MarkdownField"]')).toBeTruthy()
  expect(options()).toMatchObject({ '': 'Plain text', php: 'PHP', rust: 'Rust', js: 'ECMAScript' })
  expect(options()).not.toHaveProperty('sql')
})

it('updates late overrides and translated labels without remounting or resetting unsaved content', () => {
  const view = render(<EditorHost overrides={[]} />)
  const input = screen.getByRole('textbox', { name: 'Markdown' })
  fireEvent.change(input, { target: { value: '```rust\nunsaved work\n```' } })
  const overrides: ComponentOverride<MarkdownFieldProps>[] = [{
    target: { componentId: MARKDOWN_FIELD_COMPONENT_HANDLE }, priority: 10,
    propsTransform: (props) => ({ ...props, codeBlockLanguages: {
      ...props.codeBlockLanguages, js: { label: 'Script', labelKey: 'custom.languages.script' },
    } }),
  }]
  view.rerender(<EditorHost overrides={overrides} />)
  expect(options()?.js).toBe('Script')
  mockLocale = 'pl'
  view.rerender(<EditorHost overrides={overrides} />)
  expect(options()?.js).toBe('Skrypt')
  expect(screen.getByRole('textbox', { name: 'Markdown' })).toBe(input)
  expect(input).toHaveValue('```rust\nunsaved work\n```')
  expect(mockMount).toHaveBeenCalledTimes(1)
  expect(mockUnmount).not.toHaveBeenCalled()
  expect(mockSetMarkdown).not.toHaveBeenCalled()
})
