import { parseMarkdownBlocks, parsePlainTextBlocks } from '../engines/text'
import { parseSectionLocator } from '../locator'
import {
  cleanBlockText,
  formatStructuredSectionLocator,
  normalizeNumberLabel,
  resolveMaxSectionChars,
  resolveMaxSections,
  splitOversizedText,
  structureDocument,
  type StructureDocumentOptions,
} from '../structurer'
import {
  documentStructureExtractionResultSchema,
  type DocumentBlock,
  type DocumentEngineResult,
  type DocumentSectionNode,
  type DocumentStructureExtractionResult,
} from '../types'

const OPTIONS: StructureDocumentOptions = { engine: 'text', engineVersion: 1 }

function engineResult(blocks: DocumentBlock[], extra: Partial<DocumentEngineResult> = {}): DocumentEngineResult {
  const pages = blocks.map((block) => block.page).filter((page): page is number => page !== null)
  return {
    blocks,
    pageCount: pages.length > 0 ? Math.max(...pages) : null,
    pageCharCounts: [],
    outline: [],
    ocrPageCount: 0,
    unreadablePages: [],
    ...extra,
  }
}

function pdfBlock(text: string, page: number, extra: Partial<DocumentBlock> = {}): DocumentBlock {
  return { text, page, source: 'text_layer', ...extra }
}

function structurePlain(text: string, options: Partial<StructureDocumentOptions> = {}) {
  return structureDocument(engineResult(parsePlainTextBlocks(text)), { ...OPTIONS, ...options })
}

function structureMarkdown(text: string, options: Partial<StructureDocumentOptions> = {}) {
  return structureDocument(engineResult(parseMarkdownBlocks(text)), { ...OPTIONS, ...options })
}

function findByLabel(result: DocumentStructureExtractionResult, label: string): DocumentSectionNode {
  const section = result.sections.find((candidate) => candidate.numberLabel === label)
  if (!section) throw new Error(`section ${label} not found`)
  return section
}

function parentOf(result: DocumentStructureExtractionResult, section: DocumentSectionNode): DocumentSectionNode | null {
  return section.parentOrdinal === null ? null : result.sections[section.parentOrdinal]
}

function expectConsistentOffsets(result: DocumentStructureExtractionResult) {
  expect(documentStructureExtractionResultSchema.safeParse(result).success).toBe(true)
  expect(result.charCount).toBe(result.normalizedText.length)
  expect(result.sectionCount).toBe(result.sections.length)
  result.sections.forEach((section, index) => {
    expect(section.ordinal).toBe(index)
    expect(result.normalizedText.slice(section.charStart, section.charEnd)).toBe(section.text)
    if (section.parentOrdinal !== null) {
      expect(section.parentOrdinal).toBeLessThan(section.ordinal)
      expect(section.depth).toBe(result.sections[section.parentOrdinal].depth + 1)
    }
  })
  const anchors = result.sections.map((section) => section.anchorKey)
  expect(new Set(anchors).size).toBe(anchors.length)
}

const LEGAL_TEXT = [
  'Preamble text for the agreement.',
  '1. Definitions',
  'In this agreement the following terms apply.',
  '1.1 "Supplier" means the party delivering goods.',
  '1.2 "Buyer" means the party receiving goods.',
  '8. Payment',
  '8.12 Late payment',
  'Interest accrues on overdue amounts:',
  '(a) at the statutory rate;',
  '(i) computed daily;',
  '(ii) compounded monthly;',
  '(b) until payment in full.',
  '8.12.3 Interest is invoiced separately.',
  '8.13 Set-off',
  'No set-off is permitted.',
  '9. Termination',
  'Either party may terminate.',
].join('\n\n')

const ARTICLE_TEXT = [
  'Article 5\nPrinciples relating to processing of personal data',
  '1. Personal data shall be:',
  '(a) processed lawfully, fairly and transparently;',
  '(b) collected for specified purposes.',
  '2. The controller shall be responsible for compliance.',
  'Art. 6 Lawfulness of processing',
  '§ 7.2 Conditions for consent',
  'Consent shall be demonstrable.',
].join('\n\n')

describe('structureDocument', () => {
  it('builds the tree from markdown heading levels', () => {
    const result = structureMarkdown(
      [
        '# Handbook',
        'Intro paragraph.',
        '## Scope',
        'Scope text.',
        '### Details',
        'Detail text.',
        '## Payment',
        '- first item',
        '  - nested item',
        '- second item',
      ].join('\n\n'),
    )
    expectConsistentOffsets(result)
    expect(result.status).toBe('completed')
    const summary = result.sections.map((section) => [section.depth, section.kind, section.heading ?? section.text])
    expect(summary).toEqual([
      [0, 'document', ''],
      [1, 'chapter', 'Handbook'],
      [2, 'section', 'Scope'],
      [3, 'section', 'Details'],
      [2, 'section', 'Payment'],
      [3, 'list_item', 'first item'],
      [4, 'list_item', 'nested item'],
      [3, 'list_item', 'second item'],
    ])
    expect(result.sections[1].text).toBe('Handbook\n\nIntro paragraph.')
    expect(result.sections[3].headingPath).toEqual(['Handbook', 'Scope', 'Details'])
  })

  it('nests numbered legal clauses by numbering depth', () => {
    const result = structurePlain(LEGAL_TEXT)
    expectConsistentOffsets(result)
    expect(result.sections[0].text).toBe('Preamble text for the agreement.')

    const definitions = findByLabel(result, '1')
    expect(definitions).toMatchObject({ kind: 'section', heading: 'Definitions', depth: 1 })
    expect(definitions.text).toBe('1. Definitions\n\nIn this agreement the following terms apply.')
    expect(parentOf(result, findByLabel(result, '1.1'))?.numberLabel).toBe('1')
    expect(findByLabel(result, '1.1').kind).toBe('clause')

    const lateFees = findByLabel(result, '8.12')
    expect(lateFees).toMatchObject({ kind: 'clause', heading: 'Late payment', headingPath: ['8', '8.12'] })
    expect(lateFees.text).toBe('8.12 Late payment\n\nInterest accrues on overdue amounts:')
    expect(parentOf(result, findByLabel(result, '(a)'))?.numberLabel).toBe('8.12')
    expect(findByLabel(result, '(a)').kind).toBe('list_item')
    expect(parentOf(result, findByLabel(result, '(i)'))?.numberLabel).toBe('(a)')
    expect(parentOf(result, findByLabel(result, '(ii)'))?.numberLabel).toBe('(a)')
    expect(parentOf(result, findByLabel(result, '(b)'))?.numberLabel).toBe('8.12')
    expect(parentOf(result, findByLabel(result, '8.12.3'))?.numberLabel).toBe('8.12')
    expect(parentOf(result, findByLabel(result, '8.13'))?.numberLabel).toBe('8')
    expect(parentOf(result, findByLabel(result, '9'))?.kind).toBe('document')
    expect(findByLabel(result, '8.13').text).toBe('8.13 Set-off\n\nNo set-off is permitted.')
  })

  it('handles Article, § and nested points with normalized labels', () => {
    const result = structurePlain(ARTICLE_TEXT)
    expectConsistentOffsets(result)
    const article = findByLabel(result, 'Article 5')
    expect(article).toMatchObject({ kind: 'article', heading: 'Principles relating to processing of personal data' })
    const paragraph = findByLabel(result, '1')
    expect(paragraph.kind).toBe('paragraph')
    expect(parentOf(result, paragraph)?.numberLabel).toBe('Article 5')
    expect(parentOf(result, findByLabel(result, '(a)'))?.numberLabel).toBe('1')
    expect(parentOf(result, findByLabel(result, '(b)'))?.numberLabel).toBe('1')
    expect(parentOf(result, findByLabel(result, '2'))?.numberLabel).toBe('Article 5')
    const nextArticle = findByLabel(result, 'Article 6')
    expect(nextArticle).toMatchObject({ heading: 'Lawfulness of processing', depth: 1 })
    const consent = findByLabel(result, '§7.2')
    expect(consent).toMatchObject({ kind: 'section', heading: 'Conditions for consent' })
    expect(consent.text).toBe('§ 7.2 Conditions for consent\n\nConsent shall be demonstrable.')
  })

  it('detects roman, lettered and ALL-CAPS headings', () => {
    const result = structurePlain(
      ['I. General provisions', 'A. Scope', 'Scope text.', 'B. Terms', 'II. Final provisions', 'SCHEDULE OF FEES', 'Fee text.'].join(
        '\n\n',
      ),
    )
    expectConsistentOffsets(result)
    expect(findByLabel(result, 'I')).toMatchObject({ kind: 'part', depth: 1 })
    expect(parentOf(result, findByLabel(result, 'A'))?.numberLabel).toBe('I')
    expect(parentOf(result, findByLabel(result, 'B'))?.numberLabel).toBe('I')
    expect(findByLabel(result, 'II').depth).toBe(1)
    const caps = result.sections.find((section) => section.heading === 'SCHEDULE OF FEES')
    expect(caps).toMatchObject({ kind: 'section', numberLabel: null })
  })

  it('does not treat body text that starts with a number as a heading', () => {
    const result = structurePlain('Notice\n\n3 months notice is required.\n\n1.5 million units ship yearly.')
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0].text).toContain('3 months notice')
  })

  it('removes repeated page headers, footers and page numbers', () => {
    const pages = [1, 2, 3]
    const bodies = ['Alpha', 'Beta', 'Gamma']
    const blocks = pages.flatMap((page) => [
      pdfBlock('ACME Rulebook 2026', page, { y: 800 }),
      pdfBlock(`${bodies[page - 1]} clause body.`, page, { y: 500 }),
      pdfBlock(`Confidential - revision ${page}`, page),
      pdfBlock(`Page ${page} of 3`, page),
    ])
    const result = structureDocument(engineResult(blocks), { ...OPTIONS, engine: 'pdf_layout' })
    expectConsistentOffsets(result)
    expect(result.normalizedText).toBe('Alpha clause body.\n\nBeta clause body.\n\nGamma clause body.')
    expect(result.sections[0]).toMatchObject({ pageStart: 1, pageEnd: 3, source: 'text_layer' })
  })

  it('keeps blocks that repeat on too few pages', () => {
    const blocks = [
      pdfBlock('Shared note', 1),
      pdfBlock('Body one.', 1),
      pdfBlock('Body two.', 2),
      pdfBlock('Body three.', 3),
      pdfBlock('Shared note', 4),
      pdfBlock('Body four.', 4),
      pdfBlock('Body five.', 5),
    ]
    const result = structureDocument(engineResult(blocks), OPTIONS)
    expect(result.normalizedText).toContain('Shared note')
  })

  it('joins hyphenated line breaks inside and across blocks', () => {
    expect(cleanBlockText('The contrac-\ntor   shall deliver')).toBe('The contractor shall deliver')
    const blocks = [pdfBlock('The goods are deliv-', 1), pdfBlock('ered on time.', 2)]
    const result = structureDocument(engineResult(blocks), OPTIONS)
    expect(result.normalizedText).toBe('The goods are delivered on time.')
    expect(result.sections[0]).toMatchObject({ pageStart: 1, pageEnd: 2 })
  })

  it('splits a very long section into paragraph children with stable anchors', () => {
    const paragraphs = Array.from({ length: 12 }, (_value, index) => `Paragraph ${index + 1} ${'lorem ipsum '.repeat(8).trim()}.`)
    const text = ['8.12 Late payment', ...paragraphs, '8.13 Set-off'].join('\n\n')
    const first = structurePlain(text, { maxSectionChars: 300 })
    const second = structurePlain(text, { maxSectionChars: 300 })
    expectConsistentOffsets(first)
    const clause = findByLabel(first, '8.12')
    expect(clause.text.startsWith('8.12 Late payment')).toBe(true)
    const children = first.sections.filter((section) => section.parentOrdinal === clause.ordinal)
    expect(children.length).toBeGreaterThan(2)
    for (const child of children) {
      expect(child).toMatchObject({ kind: 'paragraph', numberLabel: null, headingPath: ['8.12'] })
    }
    for (const section of first.sections) expect(section.text.length).toBeLessThanOrEqual(300)
    expect(parentOf(first, findByLabel(first, '8.13'))?.kind).toBe('document')
    expect(second.sections.map((section) => section.anchorKey)).toEqual(first.sections.map((section) => section.anchorKey))
  })

  it('splits a single oversized paragraph at line and word boundaries', () => {
    expect(splitOversizedText('alpha beta gamma delta', 11)).toEqual(['alpha beta', 'gamma delta'])
    expect(splitOversizedText('one\ntwo\nthree', 7)).toEqual(['one\ntwo', 'three'])
    expect(splitOversizedText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
    const result = structurePlain(`Heading\n\n${'word '.repeat(200).trim()}`, { maxSectionChars: 100 })
    expectConsistentOffsets(result)
    for (const section of result.sections) expect(section.text.length).toBeLessThanOrEqual(100)
  })

  it('produces identical output for identical input', () => {
    const first = structurePlain(LEGAL_TEXT)
    const second = structurePlain(LEGAL_TEXT)
    expect(second).toEqual(first)
  })

  it('only changes anchors of inserted or renumbered clauses in a revised document', () => {
    const original = structurePlain(LEGAL_TEXT)
    const revised = structurePlain(
      LEGAL_TEXT.replace('8.13 Set-off', '8.13 Retention of title\n\nTitle passes on payment.\n\n8.14 Set-off'),
    )
    const originalAnchors = new Map(original.sections.map((section) => [section.numberLabel ?? section.heading, section.anchorKey]))
    const revisedAnchors = new Map(revised.sections.map((section) => [section.numberLabel ?? section.heading, section.anchorKey]))
    for (const label of ['1', '1.1', '8', '8.12', '(a)', '(i)', '8.12.3', '9']) {
      expect(revisedAnchors.get(label)).toBe(originalAnchors.get(label))
    }
    expect(revisedAnchors.has('8.14')).toBe(true)
    expect(originalAnchors.has('8.14')).toBe(false)
  })

  it('gives duplicate headings distinct ordinal-based anchors', () => {
    const result = structureMarkdown(
      ['# Guide', '## Notes', 'First notes.', '## Notes', 'Second notes.', '# Appendix', '## Notes', 'Third notes.'].join('\n\n'),
    )
    expectConsistentOffsets(result)
    const notes = result.sections.filter((section) => section.heading === 'Notes')
    expect(notes).toHaveLength(3)
    expect(notes[0].headingPath).toEqual(notes[1].headingPath)
    expect(notes[0].anchorKey).not.toBe(notes[1].anchorKey)
    expect(notes[2].headingPath).toEqual(['Appendix', 'Notes'])
  })

  it('applies the outline before numbering and typography', () => {
    const blocks = [
      pdfBlock('Overview', 1, { fontSize: 10 }),
      pdfBlock('Overview text.', 1, { fontSize: 10 }),
      pdfBlock('Background', 2, { fontSize: 10 }),
      pdfBlock('Background text.', 2, { fontSize: 10 }),
    ]
    const result = structureDocument(
      engineResult(blocks, {
        outline: [
          { title: 'Overview', depth: 1, page: 1 },
          { title: 'Background', depth: 2, page: 2 },
        ],
      }),
      OPTIONS,
    )
    expectConsistentOffsets(result)
    const background = result.sections.find((section) => section.heading === 'Background')
    expect(background?.headingPath).toEqual(['Overview', 'Background'])
  })

  it('detects headings from font size and bold typography', () => {
    const blocks = [
      pdfBlock('Payment Terms', 1, { fontSize: 16 }),
      pdfBlock('Body text of the payment terms.', 1, { fontSize: 10 }),
      pdfBlock('Late fees', 1, { fontSize: 10, bold: true }),
      pdfBlock('Late fee body.', 1, { fontSize: 10 }),
      pdfBlock('Delivery', 2, { fontSize: 16 }),
      pdfBlock('Delivery body.', 2, { fontSize: 10 }),
    ]
    const result = structureDocument(engineResult(blocks), OPTIONS)
    expectConsistentOffsets(result)
    const lateFees = result.sections.find((section) => section.heading === 'Late fees')
    expect(lateFees?.headingPath).toEqual(['Payment Terms', 'Late fees'])
    const delivery = result.sections.find((section) => section.heading === 'Delivery')
    expect(delivery?.depth).toBe(1)
  })

  it('adds table and unreadable page nodes and marks the extraction partial', () => {
    const blocks = [
      pdfBlock('1. Prices', 1),
      pdfBlock('Item\tPrice\nA\t10', 1, { isTable: true }),
      pdfBlock('Prices exclude tax.', 1),
      pdfBlock('2. Delivery', 3),
    ]
    const result = structureDocument(engineResult(blocks, { unreadablePages: [2] }), OPTIONS)
    expectConsistentOffsets(result)
    expect(result.status).toBe('partial')
    const prices = findByLabel(result, '1')
    const children = result.sections.filter((section) => section.parentOrdinal === prices.ordinal)
    expect(children.map((section) => section.kind)).toEqual(['table', 'paragraph', 'page_unreadable'])
    expect(children[2]).toMatchObject({ pageStart: 2, pageEnd: 2, text: '' })
  })

  it('caps the section count and marks the extraction partial', () => {
    const result = structurePlain(LEGAL_TEXT, { maxSections: 4 })
    expectConsistentOffsets(result)
    expect(result.status).toBe('partial')
    expect(result.sections).toHaveLength(4)
    expect(result.normalizedText.endsWith(result.sections[3].text)).toBe(true)
  })

  it('sets the document title on the root node', () => {
    const result = structurePlain('Body.', { title: 'Supplier  Agreement' })
    expect(result.sections[0]).toMatchObject({ kind: 'document', heading: 'Supplier Agreement', headingPath: [] })
  })

  it('formats locators that parse back to the section', () => {
    const result = structurePlain(LEGAL_TEXT)
    const lateFees = findByLabel(result, '8.12')
    const locator = formatStructuredSectionLocator(lateFees)
    expect(locator).toBe(`sec=8.12;chars=${lateFees.charStart}-${lateFees.charEnd}`)
    expect(parseSectionLocator(locator)).toMatchObject({ section: '8.12', charStart: lateFees.charStart })
  })

  it('normalizes number labels', () => {
    expect(normalizeNumberLabel('§ 8.12')).toBe('§8.12')
    expect(normalizeNumberLabel('x'.repeat(80))).toHaveLength(64)
  })

  it('reads caps from the environment with safe defaults', () => {
    const previousChars = process.env.OM_ATTACHMENT_STRUCTURE_MAX_SECTION_CHARS
    const previousSections = process.env.OM_ATTACHMENT_STRUCTURE_MAX_SECTIONS
    try {
      delete process.env.OM_ATTACHMENT_STRUCTURE_MAX_SECTION_CHARS
      process.env.OM_ATTACHMENT_STRUCTURE_MAX_SECTIONS = 'nope'
      expect(resolveMaxSectionChars()).toBe(16_000)
      expect(resolveMaxSections()).toBe(20_000)
      process.env.OM_ATTACHMENT_STRUCTURE_MAX_SECTION_CHARS = '500'
      process.env.OM_ATTACHMENT_STRUCTURE_MAX_SECTIONS = '7'
      expect(resolveMaxSectionChars()).toBe(500)
      expect(resolveMaxSections()).toBe(7)
    } finally {
      if (previousChars === undefined) delete process.env.OM_ATTACHMENT_STRUCTURE_MAX_SECTION_CHARS
      else process.env.OM_ATTACHMENT_STRUCTURE_MAX_SECTION_CHARS = previousChars
      if (previousSections === undefined) delete process.env.OM_ATTACHMENT_STRUCTURE_MAX_SECTIONS
      else process.env.OM_ATTACHMENT_STRUCTURE_MAX_SECTIONS = previousSections
    }
  })
})
