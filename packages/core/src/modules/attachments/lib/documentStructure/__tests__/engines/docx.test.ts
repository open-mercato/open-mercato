import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import {
  createDocxStructureEngine,
  decodeHtmlEntities,
  docxStructureEngine,
  parseMammothHtmlBlocks,
} from '../../engines/docx'
import { DocumentStructureFileTooLargeError } from '../../engines/text'
import { structureDocument } from '../../structurer'
import { documentEngineResultSchema } from '../../types'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const RELATIONSHIP_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_RELATIONSHIP_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships'

let workDir: string

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'om-docx-engine-'))
})

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function run(text: string, bold = false): string {
  const properties = bold ? '<w:rPr><w:b/></w:rPr>' : ''
  return `<w:r>${properties}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
}

function paragraph(content: string, style?: string, numbering?: { numId: number; level: number }): string {
  const styleXml = style ? `<w:pStyle w:val="${style}"/>` : ''
  const numberingXml = numbering
    ? `<w:numPr><w:ilvl w:val="${numbering.level}"/><w:numId w:val="${numbering.numId}"/></w:numPr>`
    : ''
  const properties = styleXml || numberingXml ? `<w:pPr>${styleXml}${numberingXml}</w:pPr>` : ''
  return `<w:p>${properties}${content}</w:p>`
}

function heading(level: number, text: string): string {
  return paragraph(run(text), `Heading${level}`)
}

function table(rows: string[][]): string {
  const rowXml = rows
    .map((cells) => `<w:tr>${cells.map((cell) => `<w:tc>${paragraph(run(cell))}</w:tc>`).join('')}</w:tr>`)
    .join('')
  return `<w:tbl>${rowXml}</w:tbl>`
}

function headingStyle(level: number): string {
  return `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/></w:style>`
}

function numberingLevels(format: 'bullet' | 'decimal'): string {
  return [0, 1, 2]
    .map((level) => `<w:lvl w:ilvl="${level}"><w:numFmt w:val="${format}"/><w:lvlText w:val="${format === 'bullet' ? '-' : `%${level + 1}.`}"/></w:lvl>`)
    .join('')
}

async function buildDocx(name: string, bodyXml: string): Promise<string> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATIONSHIP_NAMESPACE}">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_RELATIONSHIP_NAMESPACE}">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${WORD_NAMESPACE}">` +
      [1, 2, 3].map(headingStyle).join('') +
      '</w:styles>',
  )
  zip.file(
    'word/numbering.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${WORD_NAMESPACE}">` +
      `<w:abstractNum w:abstractNumId="0">${numberingLevels('bullet')}</w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="1">${numberingLevels('decimal')}</w:abstractNum>` +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
      '</w:numbering>',
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${WORD_NAMESPACE}" xmlns:r="${RELATIONSHIP_NAMESPACE}">` +
      `<w:body>${bodyXml}</w:body></w:document>`,
  )
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  const filePath = path.join(workDir, name)
  writeFileSync(filePath, buffer)
  return filePath
}

function rulebookBody(): string {
  return [
    heading(1, 'Chapter 1 General Provisions'),
    paragraph(run('This rulebook governs synthetic matches & tests.')),
    heading(2, '1.1 Scope'),
    paragraph(run('Applies to ') + run('every', true) + run(' match <officially> sanctioned.')),
    heading(2, '1.2 Definitions'),
    paragraph(run('Ball'), undefined, { numId: 1, level: 0 }),
    paragraph(run('Leather ball'), undefined, { numId: 1, level: 1 }),
    paragraph(run('Field'), undefined, { numId: 1, level: 0 }),
    heading(1, 'Chapter 2 Equipment'),
    heading(3, 'Measurements'),
    table([
      ['Item', 'Size'],
      ['Goal', '7.32 m'],
    ]),
    paragraph(run('First step'), undefined, { numId: 2, level: 0 }),
    paragraph(run('Second step'), undefined, { numId: 2, level: 0 }),
  ].join('')
}

describe('docxStructureEngine.supports', () => {
  it('accepts DOCX by mime type or extension', () => {
    expect(docxStructureEngine.supports(DOCX_MIME)).toBe(true)
    expect(docxStructureEngine.supports(`${DOCX_MIME}; charset=binary`)).toBe(true)
    expect(docxStructureEngine.supports('application/octet-stream', '.DOCX')).toBe(true)
  })

  it('rejects other types', () => {
    expect(docxStructureEngine.supports('application/msword', 'doc')).toBe(false)
    expect(docxStructureEngine.supports('application/pdf', 'pdf')).toBe(false)
    expect(docxStructureEngine.supports('text/plain', 'txt')).toBe(false)
  })
})

describe('parseMammothHtmlBlocks', () => {
  it('maps headings, paragraphs, nested lists and tables to blocks', () => {
    const html =
      '<h1>Title</h1><p>Intro <strong>bold</strong> and <em>em</em> with <a href="https://example.com">link</a>.</p>' +
      '<ul><li>One<ul><li>Nested <strong>item</strong></li></ul></li><li>Two</li></ul>' +
      '<ol><li><p>Para item</p><p>second line</p></li></ol>' +
      '<table><tr><th><p>Head A</p></th><th><p>Head B</p></th></tr><tr><td><p>a1</p></td><td><p>b1</p></td></tr></table>' +
      '<h4>Deep</h4><p>Line one<br />Line two</p><p></p>'
    expect(parseMammothHtmlBlocks(html)).toEqual([
      { text: 'Title', page: null, source: 'docx', headingLevel: 1 },
      { text: 'Intro bold and em with link.', page: null, source: 'docx' },
      { text: 'One', page: null, source: 'docx', listDepth: 0 },
      { text: 'Nested item', page: null, source: 'docx', listDepth: 1 },
      { text: 'Two', page: null, source: 'docx', listDepth: 0 },
      { text: 'Para item\nsecond line', page: null, source: 'docx', listDepth: 0 },
      { text: 'Head A | Head B\na1 | b1', page: null, source: 'docx', isTable: true },
      { text: 'Deep', page: null, source: 'docx', headingLevel: 4 },
      { text: 'Line one\nLine two', page: null, source: 'docx' },
    ])
  })

  it('keeps list item text that follows a nested list on the outer item depth', () => {
    const blocks = parseMammothHtmlBlocks('<ol><li>Outer<ol><li>Inner</li></ol>tail</li></ol>')
    expect(blocks.map((block) => [block.text, block.listDepth])).toEqual([
      ['Outer', 0],
      ['Inner', 1],
      ['tail', 0],
    ])
  })

  it('flattens nested tables into the outer cell', () => {
    const blocks = parseMammothHtmlBlocks(
      '<table><tr><td><p>outer</p><table><tr><td><p>inner</p></td></tr></table></td><td>x</td></tr></table><p>after</p>',
    )
    expect(blocks).toEqual([
      { text: 'outer inner | x', page: null, source: 'docx', isTable: true },
      { text: 'after', page: null, source: 'docx' },
    ])
  })

  it('decodes entities and ignores comments and images', () => {
    const blocks = parseMammothHtmlBlocks(
      '<!-- note --><p>A &amp; B &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x2014; &nbsp;f &bogus; <img src="" /></p>',
    )
    expect(blocks).toEqual([{ text: 'A & B <c> "d" \'e\' — f &bogus;', page: null, source: 'docx' }])
    expect(decodeHtmlEntities('&#0; &#xD800; &#x110000;')).toBe('&#0; &#xD800; &#x110000;')
  })

  it('returns no blocks for empty html', () => {
    expect(parseMammothHtmlBlocks('')).toEqual([])
    expect(parseMammothHtmlBlocks('<p></p><ul><li></li></ul><table></table>')).toEqual([])
  })
})

describe('docxStructureEngine.extract', () => {
  it('extracts headings, lists, tables and entities from a generated DOCX', async () => {
    const filePath = await buildDocx('rulebook.docx', rulebookBody())
    const result = await docxStructureEngine.extract({ filePath, mimeType: DOCX_MIME, extension: 'docx' })
    expect(documentEngineResultSchema.parse(result)).toEqual(result)
    expect(result.pageCount).toBeNull()
    expect(result.pageCharCounts).toEqual([])
    expect(result.blocks.every((block) => block.page === null && block.source === 'docx')).toBe(true)
    expect(result.blocks.map((block) => [block.text, block.headingLevel ?? null, block.listDepth ?? null, block.isTable === true])).toEqual([
      ['Chapter 1 General Provisions', 1, null, false],
      ['This rulebook governs synthetic matches & tests.', null, null, false],
      ['1.1 Scope', 2, null, false],
      ['Applies to every match <officially> sanctioned.', null, null, false],
      ['1.2 Definitions', 2, null, false],
      ['Ball', null, 0, false],
      ['Leather ball', null, 1, false],
      ['Field', null, 0, false],
      ['Chapter 2 Equipment', 1, null, false],
      ['Measurements', 3, null, false],
      ['Item | Size\nGoal | 7.32 m', null, null, true],
      ['First step', null, 0, false],
      ['Second step', null, 0, false],
    ])
  })

  it('produces a golden outline through structureDocument', async () => {
    const filePath = await buildDocx('golden.docx', rulebookBody())
    const result = await docxStructureEngine.extract({ filePath, mimeType: DOCX_MIME, extension: 'docx' })
    const structured = structureDocument(result, { engine: 'docx', engineVersion: docxStructureEngine.version })
    expect(structured.status).toBe('completed')
    expect(structured.pageCount).toBeNull()
    expect(structured.sections.every((section) => section.pageStart === null && section.source === 'docx')).toBe(true)
    const outline = structured.sections
      .filter((section) => section.kind !== 'paragraph')
      .map((section) => [section.depth, section.kind, section.numberLabel, section.heading])
    expect(outline).toEqual([
      [0, 'document', null, null],
      [1, 'chapter', 'Chapter 1', 'General Provisions'],
      [2, 'clause', '1.1', 'Scope'],
      [2, 'clause', '1.2', 'Definitions'],
      [3, 'list_item', null, null],
      [4, 'list_item', null, null],
      [3, 'list_item', null, null],
      [1, 'chapter', 'Chapter 2', 'Equipment'],
      [2, 'section', null, 'Measurements'],
      [3, 'table', null, null],
      [3, 'list_item', null, null],
      [3, 'list_item', null, null],
    ])
    expect(structured.normalizedText).toContain('Item | Size')
  })

  it('refuses files above the byte cap', async () => {
    const filePath = await buildDocx('large.docx', rulebookBody())
    const engine = createDocxStructureEngine({ maxBytes: () => 16 })
    await expect(engine.extract({ filePath, mimeType: DOCX_MIME })).rejects.toBeInstanceOf(
      DocumentStructureFileTooLargeError,
    )
  })

  it('uses an injected html converter', async () => {
    const filePath = await buildDocx('injected.docx', rulebookBody())
    const engine = createDocxStructureEngine({ convertToHtml: async () => '<h2>Injected</h2>' })
    const result = await engine.extract({ filePath, mimeType: DOCX_MIME })
    expect(result.blocks).toEqual([{ text: 'Injected', page: null, source: 'docx', headingLevel: 2 }])
  })
})
