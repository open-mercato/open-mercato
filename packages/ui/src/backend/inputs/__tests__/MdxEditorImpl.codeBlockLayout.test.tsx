import * as React from 'react'
import { render } from '@testing-library/react'
import { compile, optimize } from '@tailwindcss/node'
import MdxEditorImpl from '../MdxEditorImpl'

jest.mock('@mdxeditor/editor/style.css', () => ({}))
jest.mock('../../../theme', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }))
jest.mock('@mdxeditor/editor', () => {
  const React = require('react') as typeof import('react')
  const plugins = Object.fromEntries([
    'headingsPlugin', 'listsPlugin', 'quotePlugin', 'thematicBreakPlugin',
    'linkPlugin', 'linkDialogPlugin', 'imagePlugin', 'tablePlugin',
    'markdownShortcutPlugin', 'diffSourcePlugin', 'toolbarPlugin',
  ].map((name) => [name, jest.fn()]))
  return {
    ...plugins,
    MDXEditor: React.forwardRef<HTMLDivElement, { className?: string }>(({ className }, ref) => (
      <div ref={ref} className={className}>
        <div className="_codeMirrorWrapper_vendor">
          <div className="_codeMirrorToolbar_vendor">Language and delete controls</div>
          <div className="cm-editor">Tagged block</div>
        </div>
      </div>
    )),
  }
})

describe('code block toolbar layout', () => {
  it('reserves space above code and lets controls wrap without styling other editors', async () => {
    const { container } = render(<MdxEditorImpl onChange={jest.fn()} />)
    const editor = container.querySelector('.om-mdx-editor')
    const toolbar = container.querySelector<HTMLElement>('._codeMirrorToolbar_vendor')
    expect(editor).not.toBeNull()
    expect(toolbar).not.toBeNull()

    const compiler = await compile('@tailwind utilities;', {
      base: process.cwd(),
      onDependency: () => {},
    })
    const stylesheet = document.createElement('style')
    stylesheet.textContent = `
      ._codeMirrorToolbar_vendor { position: absolute; display: flex; top: 0; right: 0; }
      ${optimize(compiler.build(Array.from(editor!.classList))).code}
    `
    const outsideToolbar = document.createElement('div')
    outsideToolbar.className = '_codeMirrorToolbar_vendor'
    document.head.appendChild(stylesheet)
    document.body.appendChild(outsideToolbar)

    try {
      const style = getComputedStyle(toolbar!)
      expect(style.position).toBe('static')
      expect(style.flexWrap).toBe('wrap')
      expect(style.justifyContent).toBe('flex-end')
      expect(getComputedStyle(outsideToolbar).position).toBe('absolute')
      expect(Array.from(stylesheet.sheet!.cssRules).some((rule) => (
        rule instanceof CSSStyleRule
        && rule.style.getPropertyValue('position') === 'static'
        && rule.style.getPropertyPriority('position') === 'important'
      ))).toBe(true)
    } finally {
      stylesheet.remove()
      outsideToolbar.remove()
    }
  })
})
