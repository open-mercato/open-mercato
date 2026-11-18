import {
  MARKDOWN_IMPORT_MAX_FILE_BYTES,
  convertMarkdownImport,
  extractFirstH1Title,
  isConvertedHtmlWithinLimit,
  markdownToDocumentHtml,
  titleFromFilename,
  validateMarkdownImportFile,
  validateMarkdownImportSource,
} from '../lib/markdownImport'
import { materializeDocumentHtml } from '../lib/collabMaterializer'

type JsdomModule = typeof import('jsdom')

jest.mock('happy-dom', () => {
  const { JSDOM } = jest.requireActual<JsdomModule>('jsdom')
  class Window {
    readonly document: Document
    readonly DOMParser: typeof globalThis.DOMParser
    readonly happyDOM = { abort: () => undefined, close: () => undefined }

    constructor() {
      const dom = new JSDOM('<!doctype html><html><body></body></html>')
      this.document = dom.window.document
      this.DOMParser = dom.window.DOMParser
    }
  }
  return { Window }
})

function compact(html: string): string {
  return html.replace(/>\s+</g, '><')
}

describe('markdownToDocumentHtml', () => {
  it('maps heading levels to h1/h2/h3', () => {
    const html = markdownToDocumentHtml('# Agreement\n\n## Definitions\n\n### Scope\n\nBody text.')
    expect(html).toContain('<h1>Agreement</h1>')
    expect(html).toContain('<h2>Definitions</h2>')
    expect(html).toContain('<h3>Scope</h3>')
    expect(html).toContain('<p>Body text.</p>')
  })

  it('renders inline marks, links, blockquotes and code', () => {
    const html = markdownToDocumentHtml('Some *italic*, **bold** and ~~gone~~ [site](https://example.com).\n\n> Quoted\n\n```\nconst x = 1\n```')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<del>gone</del>')
    expect(html).toContain('<a href="https://example.com">site</a>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<pre><code>const x = 1')
  })

  it('renders GFM tables', () => {
    const html = markdownToDocumentHtml('| Party | Role |\n| --- | --- |\n| Alpha | Buyer |\n')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>Party</th>')
    expect(html).toContain('<td>Buyer</td>')
  })

  it('renders bullet, ordered and task lists', () => {
    const html = compact(markdownToDocumentHtml('- one\n- two\n\n1. first\n2. second\n\n- [x] done\n- [ ] open\n'))
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>')
    expect(html).toContain('<ol><li>first</li><li>second</li></ol>')
    expect(html).toContain('<ul data-type="taskList">')
    expect(html).toContain('<li data-type="taskItem" data-checked="true"><p>done</p></li>')
    expect(html).toContain('<li data-type="taskItem" data-checked="false"><p>open</p></li>')
    expect(html).not.toContain('<input')
  })

  it('drops raw HTML and unsafe link schemes', () => {
    const html = markdownToDocumentHtml('Hello <script>alert(1)</script> <b onclick="x()">bold</b>\n\n<div>block</div>\n\n[click](javascript:alert(1))')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('<div')
    expect(html).not.toContain('javascript:')
  })

  it('survives the server editor-schema materialisation with headings intact', () => {
    const materialized = materializeDocumentHtml(markdownToDocumentHtml('# Title\n\n## Section\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] task'))
    expect(materialized).not.toBeNull()
    expect(materialized?.html).toContain('<h1>Title</h1>')
    expect(materialized?.html).toContain('<h2>Section</h2>')
    expect(materialized?.html).toContain('<table')
    expect(materialized?.html).toContain('data-type="taskItem"')
  })
})

describe('title extraction', () => {
  it('uses the first H1 text, keeping the H1 in the body', () => {
    const result = convertMarkdownImport('notes.md', 'Intro\n\n# Master **Services** &amp; Terms\n\n# Second')
    expect(result.title).toBe('Master Services & Terms')
    expect(result.contentHtml).toContain('<h1>')
    expect(result.contentText).toContain('Intro')
  })

  it('falls back to the filename without extension', () => {
    expect(convertMarkdownImport('supply_agreement.v2.md', '## Only H2\n\ntext').title).toBe('supply agreement.v2')
    expect(titleFromFilename('folder/Readme.markdown')).toBe('Readme')
    expect(extractFirstH1Title('<h2>x</h2>')).toBeNull()
  })

  it('clamps very long titles', () => {
    expect(convertMarkdownImport('a.md', `# ${'x'.repeat(600)}`).title).toHaveLength(512)
  })
})

describe('validation', () => {
  it('accepts markdown and plain-text files', () => {
    expect(validateMarkdownImportFile({ name: 'a.md', size: 10, type: '' })).toBeNull()
    expect(validateMarkdownImportFile({ name: 'a.markdown', size: 10, type: 'text/markdown' })).toBeNull()
    expect(validateMarkdownImportFile({ name: 'a.txt', size: 10, type: 'text/plain' })).toBeNull()
  })

  it('rejects non-text files', () => {
    expect(validateMarkdownImportFile({ name: 'a.pdf', size: 10, type: 'application/pdf' })).toEqual({ code: 'unsupported' })
    expect(validateMarkdownImportFile({ name: 'a.md', size: 10, type: 'image/png' })).toEqual({ code: 'unsupported' })
    expect(validateMarkdownImportSource('abc\u0000def')).toEqual({ code: 'unsupported' })
  })

  it('enforces the size limit and rejects empty files', () => {
    expect(validateMarkdownImportFile({ name: 'a.md', size: MARKDOWN_IMPORT_MAX_FILE_BYTES + 1 })).toEqual({ code: 'tooLarge', maxBytes: MARKDOWN_IMPORT_MAX_FILE_BYTES })
    expect(validateMarkdownImportFile({ name: 'a.md', size: MARKDOWN_IMPORT_MAX_FILE_BYTES })).toBeNull()
    expect(validateMarkdownImportFile({ name: 'a.md', size: 0 })).toEqual({ code: 'empty' })
    expect(validateMarkdownImportSource('   \n')).toEqual({ code: 'empty' })
    expect(isConvertedHtmlWithinLimit('<p>small</p>')).toBe(true)
    expect(isConvertedHtmlWithinLimit('x'.repeat(3 * 1024 * 1024))).toBe(false)
  })
})
