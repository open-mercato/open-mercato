/** @jest-environment jsdom */
import * as React from 'react'
import { EditorView } from '@codemirror/view'
import { ContentSecurityPolicyProvider } from '../../../theme/ContentSecurityPolicyProvider'
import { render } from '@testing-library/react'

type CodeMirrorExtensions = NonNullable<ConstructorParameters<typeof EditorView>[0]>['extensions']

type PluginMarker = { plugin: string; params?: Record<string, unknown> }

const capturedPlugins: PluginMarker[][] = []

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
    MDXEditor: (props: { plugins: PluginMarker[] }) => {
      capturedPlugins.push(props.plugins)
      return null
    },
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

function renderPlugins(): PluginMarker[] {
  capturedPlugins.length = 0
  render(<MdxEditorImpl value={'Proposed reply:\n\n```\nHello,\n```\n'} onChange={() => {}} />)
  const plugins = capturedPlugins.at(-1)
  expect(plugins).toBeDefined()
  return plugins as PluginMarker[]
}

describe('MdxEditorImpl code blocks', () => {
  it('registers the code block importer so fenced and indented blocks parse', () => {
    const codeBlock = renderPlugins().find((entry) => entry.plugin === 'codeBlock')
    expect(codeBlock).toBeDefined()
    expect(codeBlock?.params).toEqual({ defaultCodeBlockLanguage: '' })
  })

  it('registers a code block editor that accepts blocks without a language tag', () => {
    const codeMirror = renderPlugins().find((entry) => entry.plugin === 'codeMirror')
    expect(codeMirror).toBeDefined()
    const languages = codeMirror?.params?.codeBlockLanguages as Record<string, string>
    expect(Object.prototype.hasOwnProperty.call(languages, '')).toBe(true)
    expect(languages['']).toBe('Plain text')
    expect(languages).toEqual(expect.objectContaining({ ts: 'TypeScript', js: 'JavaScript' }))
  })
})

describe('CodeMirror CSP styles', () => {
  it('uses the stable document nonce for code blocks and source/diff views', () => {
    capturedPlugins.length = 0
    const view = render(
      <ContentSecurityPolicyProvider nonce="documentNonce">
        <MdxEditorImpl value={'```ts\nconst first = 1\n```'} onChange={jest.fn()} />
      </ContentSecurityPolicyProvider>,
    )
    const plugins = capturedPlugins.at(-1)!
    const extensionsFor = (name: string) => plugins.find((entry) => entry.plugin === name)?.params?.codeMirrorExtensions
    for (const name of ['codeMirror', 'diffSource']) {
      const extensions = extensionsFor(name) as CodeMirrorExtensions
      expect(extensions).toBeDefined()
      const editor = new EditorView({ extensions })
      try {
        expect(editor.state.facet(EditorView.cspNonce)).toBe('documentNonce')
      } finally {
        editor.destroy()
      }
    }
    view.rerender(
      <ContentSecurityPolicyProvider nonce="navigationNonce">
        <MdxEditorImpl value={'```ts\nconst first = 2\n```'} onChange={jest.fn()} />
      </ContentSecurityPolicyProvider>,
    )
    for (const name of ['codeMirror', 'diffSource']) {
      const extensions = capturedPlugins.at(-1)!.find((entry) => entry.plugin === name)?.params?.codeMirrorExtensions
      expect(extensions).toBe(extensionsFor(name))
    }
  })

  it('keeps CodeMirror defaults when no document nonce is supplied', () => {
    for (const plugin of renderPlugins().filter((entry) => ['codeMirror', 'diffSource'].includes(entry.plugin))) {
      const extensions = plugin.params?.codeMirrorExtensions as CodeMirrorExtensions
      expect(extensions).toEqual([])
      const editor = new EditorView({ extensions })
      try {
        expect(editor.state.facet(EditorView.cspNonce)).toBe('')
      } finally {
        editor.destroy()
      }
    }
  })
})
