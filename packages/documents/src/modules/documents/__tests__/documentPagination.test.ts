/** @jest-environment jsdom */

import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import {
  calculateDocumentPageBreaks,
  createDocumentPaginationPlugin,
  DOCUMENT_PAGINATION_PLUGIN_KEY,
  DOCUMENT_PAGINATION_STYLES,
  DOCUMENT_PAGINATION_UPDATE_DELAY_MS,
} from '../backend/documents/[id]/documentPagination'
import { pageAtOffset } from '../backend/documents/[id]/DocumentNavigator'

describe('document pagination', () => {
  it('keeps fixed A4 geometry and allows horizontal scrolling on narrow screens', () => {
    expect(DOCUMENT_PAGINATION_STYLES).toContain('width: 210mm')
    expect(DOCUMENT_PAGINATION_STYLES).toContain('min-width: 210mm')
    expect(DOCUMENT_PAGINATION_STYLES).toContain('overflow-x: auto')
    expect(DOCUMENT_PAGINATION_STYLES).not.toContain('zoom:')
    expect(DOCUMENT_PAGINATION_STYLES).not.toContain('--documents-mobile-page-scale')
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
        paragraph: { content: 'text*', toDOM: () => ['p', 0] },
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

  it('rebuilds a page-break widget when its geometry changes at the same document position', () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = () => 1
    globalThis.cancelAnimationFrame = () => undefined
    const schema = new Schema({
      nodes: {
        doc: { content: 'paragraph+' },
        paragraph: { content: 'text*', toDOM: () => ['p', 0] },
        text: {},
      },
    })
    const doc = schema.node('doc', undefined, [schema.node('paragraph', undefined, schema.text('Stored text'))])
    const mount = document.createElement('div')
    document.body.append(mount)
    let view: EditorView | null = null
    try {
      const activeView = new EditorView(mount, {
        state: EditorState.create({ doc, plugins: [createDocumentPaginationPlugin()] }),
      })
      view = activeView
      const setBreakGeometry = (remainingContentHeight: number) => {
        activeView.dispatch(activeView.state.tr.setMeta(DOCUMENT_PAGINATION_PLUGIN_KEY, {
          breaks: [{ position: 0, remainingContentHeight, totalHeight: remainingContentHeight + 50 }],
        }))
      }

      setBreakGeometry(20)
      const firstWidget = mount.querySelector<HTMLElement>('[data-document-page-break]')
      const firstPageEndHeight = firstWidget?.querySelector<HTMLElement>('.om-doc-page-end')?.style.height

      setBreakGeometry(80)
      const updatedWidget = mount.querySelector<HTMLElement>('[data-document-page-break]')
      const updatedPageEndHeight = updatedWidget?.querySelector<HTMLElement>('.om-doc-page-end')?.style.height

      expect(firstWidget).not.toBeNull()
      expect(updatedWidget).not.toBe(firstWidget)
      expect(updatedPageEndHeight).not.toBe(firstPageEndHeight)
    } finally {
      view?.destroy()
      mount.remove()
      globalThis.requestAnimationFrame = originalRequestAnimationFrame
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    }
  })

  it('skips selection-only updates and debounces measurement after document changes', () => {
    jest.useFakeTimers()
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = (callback) => window.setTimeout(() => callback(0), 0)
    globalThis.cancelAnimationFrame = (handle) => window.clearTimeout(handle)
    const measurementSpy = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 794,
      bottom: 40,
      width: 794,
      height: 40,
      toJSON: () => ({}),
    })
    const schema = new Schema({
      nodes: {
        doc: { content: 'paragraph+' },
        paragraph: { content: 'text*', toDOM: () => ['p', 0] },
        text: {},
      },
    })
    const doc = schema.node('doc', undefined, [schema.node('paragraph', undefined, schema.text('Stored text'))])
    const mount = document.createElement('div')
    document.body.append(mount)
    const view = new EditorView(mount, {
      state: EditorState.create({ doc, plugins: [createDocumentPaginationPlugin()] }),
    })

    jest.runOnlyPendingTimers()
    measurementSpy.mockClear()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    jest.advanceTimersByTime(DOCUMENT_PAGINATION_UPDATE_DELAY_MS + 10)
    expect(measurementSpy).not.toHaveBeenCalled()

    view.dispatch(view.state.tr.insertText('x', 2))
    jest.advanceTimersByTime(DOCUMENT_PAGINATION_UPDATE_DELAY_MS - 1)
    expect(measurementSpy).not.toHaveBeenCalled()
    jest.advanceTimersByTime(2)
    expect(measurementSpy).toHaveBeenCalled()

    view.destroy()
    mount.remove()
    measurementSpy.mockRestore()
    globalThis.requestAnimationFrame = originalRequestAnimationFrame
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    jest.useRealTimers()
  })
})
