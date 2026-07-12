import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import {
  calculateDocumentPageBreaks,
  createDocumentPaginationPlugin,
  DOCUMENT_PAGINATION_PLUGIN_KEY,
  DOCUMENT_PAGINATION_STYLES,
} from '../backend/documents/[id]/documentPagination'
import { pageAtOffset } from '../backend/documents/[id]/DocumentNavigator'

describe('document pagination', () => {
  it('scales the paginated A4 paper surface on phone-sized screens', () => {
    expect(DOCUMENT_PAGINATION_STYLES).toContain('@media (max-width: 639px)')
    expect(DOCUMENT_PAGINATION_STYLES).toContain('zoom: var(--documents-mobile-page-scale, 1)')
    expect(DOCUMENT_PAGINATION_STYLES).not.toContain('.om-doc-paper .om-doc-page-break {\n    display: none')
    expect(DOCUMENT_PAGINATION_STYLES).toContain('.om-doc-page-number')
  })

  it('maps scroll offsets to pages with a binary-search boundary', () => {
    const pageTops = [100, 1100, 2100, 3100]

    expect(pageAtOffset(pageTops, 0)).toEqual({ currentPage: 1, totalPages: 4 })
    expect(pageAtOffset(pageTops, 1099)).toEqual({ currentPage: 1, totalPages: 4 })
    expect(pageAtOffset(pageTops, 1100)).toEqual({ currentPage: 2, totalPages: 4 })
    expect(pageAtOffset(pageTops, 9999)).toEqual({ currentPage: 4, totalPages: 4 })
    expect(pageAtOffset([], 9999)).toEqual({ currentPage: 1, totalPages: 1 })
  })

  it('adds a presentation break only at the next safe block boundary', () => {
    const breaks = calculateDocumentPageBreaks([
      { position: 0, top: 0, bottom: 42 },
      { position: 7, top: 48, bottom: 104 },
      { position: 14, top: 110, bottom: 170 },
    ], {
      pageContentHeight: 120,
      firstPageUsedHeight: 10,
      pageMarginHeight: 8,
      pageGutterHeight: 12,
    })

    expect(breaks).toEqual([
      { position: 14, remainingContentHeight: 0, totalHeight: 28 },
    ])
  })

  it('removes breaks when content fits and bounds oversized indivisible blocks', () => {
    expect(calculateDocumentPageBreaks([
      { position: 0, top: 0, bottom: 80 },
      { position: 5, top: 85, bottom: 260 },
      { position: 10, top: 265, bottom: 285 },
    ], {
      pageContentHeight: 100,
      pageMarginHeight: 10,
      pageGutterHeight: 10,
    })).toEqual([
      { position: 5, remainingContentHeight: 15, totalHeight: 45 },
    ])

    expect(calculateDocumentPageBreaks([
      { position: 0, top: 0, bottom: 80 },
    ], { pageContentHeight: 100 })).toEqual([])
  })

  it('keeps pagination metadata out of document JSON and history content', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'paragraph+' },
        paragraph: { content: 'text*' },
        text: {},
      },
    })
    const doc = schema.node('doc', undefined, [schema.node('paragraph', undefined, schema.text('Stored text'))])
    let state = EditorState.create({ doc, plugins: [createDocumentPaginationPlugin()] })
    const before = state.doc.toJSON()
    const transaction = state.tr
      .setMeta(DOCUMENT_PAGINATION_PLUGIN_KEY, {
        breaks: [{ position: 0, remainingContentHeight: 20, totalHeight: 50 }],
      })
      .setMeta('addToHistory', false)
    state = state.apply(transaction)

    expect(state.doc.toJSON()).toEqual(before)
    expect(transaction.docChanged).toBe(false)
    expect(transaction.getMeta('addToHistory')).toBe(false)
    expect(DOCUMENT_PAGINATION_PLUGIN_KEY.getState(state)?.decorations.find()).toHaveLength(1)
  })
})
