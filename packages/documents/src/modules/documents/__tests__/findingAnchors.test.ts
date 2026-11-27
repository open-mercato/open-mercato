import { relativePositionToAbsolutePosition } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { htmlToYDoc } from '../lib/collabMaterializer'
import { createFindingAnchorer, normalizeFindingText } from '../lib/findingAnchors'
import {
  extractReviewBlocksFromYjsState,
  parseReviewDocument,
} from '../lib/reviewContent'
import { documentCommentAnchorWriteSchema } from '../data/validators'

type JsdomModule = typeof import('jsdom')
type JsdomInstance = InstanceType<JsdomModule['JSDOM']>

jest.mock('happy-dom', () => {
  const { JSDOM } = jest.requireActual<JsdomModule>('jsdom')
  class Window {
    readonly document: Document
    readonly DOMParser: typeof globalThis.DOMParser
    readonly happyDOM = {
      abort: () => undefined,
      close: () => undefined,
    }

    private readonly dom: JsdomInstance

    constructor() {
      this.dom = new JSDOM('<!doctype html><html><body></body></html>')
      this.document = this.dom.window.document
      this.DOMParser = this.dom.window.DOMParser
    }
  }

  return { Window }
})

const CONTRACT_HTML = [
  '<h1>Mutual Non-Disclosure Agreement</h1>',
  '<h2>1. Definitions</h2>',
  '<p>"Confidential Information" means any non-public information.</p>',
  '<h2>2. Obligations</h2>',
  '<p>The Recipient shall keep the information confidential for two years.</p>',
  '<ul><li><p>No copies without consent.</p></li><li><p>Return all materials on request.</p></li></ul>',
  '<h2>3. Term</h2>',
  '<p>The Recipient shall keep the information confidential for two years.</p>',
  '<table><tbody><tr><td><p>Party</p></td><td><p>Notice period: 30 days</p></td></tr></tbody></table>',
].join('')

function encodeState(html: string): Buffer {
  const ydoc = htmlToYDoc(html)
  const state = Buffer.from(Y.encodeStateAsUpdate(ydoc))
  ydoc.destroy()
  return state
}

function resolveAnchor(
  state: Buffer,
  anchor: { relativeFrom: string; relativeTo: string },
): { from: number | null; to: number | null; text: string | null } {
  const parsed = parseReviewDocument(state)
  if (!parsed) throw new Error('[internal] expected parsed document')
  try {
    const from = relativePositionToAbsolutePosition(
      parsed.ydoc,
      parsed.fragment,
      Y.decodeRelativePosition(Buffer.from(anchor.relativeFrom, 'base64')),
      parsed.mapping,
    )
    const to = relativePositionToAbsolutePosition(
      parsed.ydoc,
      parsed.fragment,
      Y.decodeRelativePosition(Buffer.from(anchor.relativeTo, 'base64')),
      parsed.mapping,
    )
    const text = from !== null && to !== null ? parsed.doc.textBetween(from, to, ' ') : null
    return { from, to, text }
  } finally {
    parsed.ydoc.destroy()
  }
}

describe('review content blocks', () => {
  it('orders headings, paragraphs, list items and table cells with section labels', () => {
    const blocks = extractReviewBlocksFromYjsState(encodeState(CONTRACT_HTML))
    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'heading',
      'paragraph',
      'heading',
      'paragraph',
      'listItem',
      'listItem',
      'heading',
      'paragraph',
      'tableCell',
      'tableCell',
    ])
    expect(blocks.map((block) => block.index)).toEqual(blocks.map((_, position) => position))
    expect(blocks[1]).toMatchObject({ kind: 'heading', level: 2, text: '1. Definitions', sectionLabel: '1. Definitions' })
    expect(blocks[5]).toMatchObject({ kind: 'listItem', sectionLabel: '2. Obligations', text: 'No copies without consent.' })
    expect(blocks[10]).toMatchObject({ kind: 'tableCell', sectionLabel: '3. Term', text: 'Notice period: 30 days' })
  })

  it('returns no blocks for empty state', () => {
    expect(extractReviewBlocksFromYjsState(null)).toEqual([])
    expect(extractReviewBlocksFromYjsState(Buffer.alloc(0))).toEqual([])
  })
})

describe('finding anchors', () => {
  const state = encodeState(CONTRACT_HTML)

  it('anchors a located quote in the comment anchor format and round-trips it', () => {
    const anchorer = createFindingAnchorer(state)
    try {
      const result = anchorer.locate({ quote: 'keep the information confidential' })
      expect(result.anchorStatus).toBe('located')
      if (result.anchorStatus !== 'located') return
      expect(documentCommentAnchorWriteSchema.safeParse(result.anchor).success).toBe(true)
      const resolved = resolveAnchor(state, result.anchor)
      expect(resolved.from).toBe(result.from)
      expect(resolved.to).toBe(result.to)
      expect(resolved.text).toBe('keep the information confidential')
    } finally {
      anchorer.dispose()
    }
  })

  it('selects the requested occurrence of a repeated quote', () => {
    const anchorer = createFindingAnchorer(state)
    try {
      const first = anchorer.locate({ quote: 'confidential for two years', occurrence: 1 })
      const second = anchorer.locate({ quote: 'confidential for two years', occurrence: 2 })
      const third = anchorer.locate({ quote: 'confidential for two years', occurrence: 3 })
      expect(first.anchorStatus).toBe('located')
      expect(second.anchorStatus).toBe('located')
      expect(third.anchorStatus).toBe('unlocated')
      if (first.anchorStatus !== 'located' || second.anchorStatus !== 'located') return
      expect(second.from).toBeGreaterThan(first.from)
    } finally {
      anchorer.dispose()
    }
  })

  it('searches inside the labelled section first, then the whole document', () => {
    const anchorer = createFindingAnchorer(state)
    try {
      const global = anchorer.locate({ quote: 'confidential for two years' })
      const inTerm = anchorer.locate({ quote: 'confidential for two years', sectionLabel: '3. Term' })
      const fallback = anchorer.locate({ quote: 'non-public information', sectionLabel: '3. Term' })
      expect(global.anchorStatus).toBe('located')
      expect(inTerm.anchorStatus).toBe('located')
      expect(fallback.anchorStatus).toBe('located')
      if (global.anchorStatus !== 'located' || inTerm.anchorStatus !== 'located') return
      expect(inTerm.from).toBeGreaterThan(global.from)
    } finally {
      anchorer.dispose()
    }
  })

  it('normalizes whitespace and typographic quotes on both sides', () => {
    const anchorer = createFindingAnchorer(state)
    try {
      const result = anchorer.locate({ quote: '“Confidential   Information”\n means' })
      expect(result.anchorStatus).toBe('located')
      if (result.anchorStatus !== 'located') return
      expect(resolveAnchor(state, result.anchor).text).toBe('"Confidential Information" means')
    } finally {
      anchorer.dispose()
    }
    expect(normalizeFindingText('  ‘a’  “b” ')).toBe('\'a\' "b"')
  })

  it('locates list item and table cell passages', () => {
    const anchorer = createFindingAnchorer(state)
    try {
      const listItem = anchorer.locate({ quote: 'Return all materials' })
      const tableCell = anchorer.locate({ quote: 'Notice period: 30 days' })
      expect(listItem.anchorStatus).toBe('located')
      expect(tableCell.anchorStatus).toBe('located')
      if (tableCell.anchorStatus !== 'located') return
      expect(resolveAnchor(state, tableCell.anchor).text).toBe('Notice period: 30 days')
    } finally {
      anchorer.dispose()
    }
  })

  it('returns unlocated for a missing quote or empty content', () => {
    const anchorer = createFindingAnchorer(state)
    try {
      expect(anchorer.locate({ quote: 'This sentence is not in the agreement' })).toEqual({
        anchorStatus: 'unlocated',
        anchor: null,
      })
    } finally {
      anchorer.dispose()
    }
    const empty = createFindingAnchorer(null)
    expect(empty.locate({ quote: 'anything' }).anchorStatus).toBe('unlocated')
    empty.dispose()
  })
})
