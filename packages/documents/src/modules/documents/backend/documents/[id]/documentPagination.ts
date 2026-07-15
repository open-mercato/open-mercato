import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

export const A4_PAGE_WIDTH_MM = 210
export const A4_PAGE_HEIGHT_MM = 297
export const DOCUMENT_PAGE_HORIZONTAL_MARGIN_MM = 20
export const DOCUMENT_PAGE_VERTICAL_MARGIN_MM = 22
export const DOCUMENT_PAGE_GUTTER_PX = 24

const CSS_PIXELS_PER_MM = 96 / 25.4
const PAGE_CONTENT_HEIGHT_PX = (
  A4_PAGE_HEIGHT_MM - (DOCUMENT_PAGE_VERTICAL_MARGIN_MM * 2)
) * CSS_PIXELS_PER_MM
const PAGE_VERTICAL_MARGIN_PX = DOCUMENT_PAGE_VERTICAL_MARGIN_MM * CSS_PIXELS_PER_MM
const PAGE_BREAK_EPSILON_PX = 0.5
export const DOCUMENT_PAGINATION_UPDATE_DELAY_MS = 120

export type PaginationBlockMeasurement = {
  position: number
  top: number
  bottom: number
}

export type DocumentPageBreak = {
  position: number
  remainingContentHeight: number
  totalHeight: number
}

type PaginationPluginState = {
  breaks: DocumentPageBreak[]
  decorations: DecorationSet
}

type PaginationMeta = {
  breaks: DocumentPageBreak[]
}

export const DOCUMENT_PAGINATION_PLUGIN_KEY = new PluginKey<PaginationPluginState>('documentsPagination')

function nextPageBreak(
  position: number,
  remainingContentHeight: number,
  pageMarginHeight: number,
  pageGutterHeight: number,
): DocumentPageBreak {
  const safeRemaining = Math.max(0, remainingContentHeight)
  return {
    position,
    remainingContentHeight: safeRemaining,
    totalHeight: safeRemaining + (pageMarginHeight * 2) + pageGutterHeight,
  }
}

export function calculateDocumentPageBreaks(
  blocks: PaginationBlockMeasurement[],
  options: {
    pageContentHeight?: number
    firstPageUsedHeight?: number
    pageMarginHeight?: number
    pageGutterHeight?: number
  } = {},
): DocumentPageBreak[] {
  const pageContentHeight = Math.max(1, options.pageContentHeight ?? PAGE_CONTENT_HEIGHT_PX)
  const firstPageUsedHeight = Math.max(0, options.firstPageUsedHeight ?? 0)
  const pageMarginHeight = Math.max(0, options.pageMarginHeight ?? PAGE_VERTICAL_MARGIN_PX)
  const pageGutterHeight = Math.max(0, options.pageGutterHeight ?? DOCUMENT_PAGE_GUTTER_PX)
  const breaks: DocumentPageBreak[] = []
  let pageStart = -Math.min(firstPageUsedHeight, pageContentHeight)
  let pageBottom = pageStart + pageContentHeight

  for (const block of blocks) {
    const top = Math.max(0, block.top)
    const bottom = Math.max(top, block.bottom)
    const height = bottom - top
    if (bottom <= pageBottom + PAGE_BREAK_EPSILON_PX) continue

    const hasEarlierContentOnPage = top > pageStart + PAGE_BREAK_EPSILON_PX
    if (height > pageContentHeight) {
      if (hasEarlierContentOnPage) {
        breaks.push(nextPageBreak(
          block.position,
          pageBottom - top,
          pageMarginHeight,
          pageGutterHeight,
        ))
        pageStart = top
        pageBottom = pageStart + pageContentHeight
      }
      while (bottom > pageBottom + PAGE_BREAK_EPSILON_PX) {
        pageStart = pageBottom
        pageBottom = pageStart + pageContentHeight
      }
      continue
    }

    breaks.push(nextPageBreak(
      block.position,
      pageBottom - top,
      pageMarginHeight,
      pageGutterHeight,
    ))
    pageStart = top
    pageBottom = pageStart + pageContentHeight
  }

  return breaks
}

function createPageBreakDom(pageBreak: DocumentPageBreak, pageNumber: number): HTMLElement {
  const root = document.createElement('div')
  root.className = 'om-doc-page-break'
  root.contentEditable = 'false'
  root.setAttribute('aria-hidden', 'true')
  root.setAttribute('data-document-page-break', '')

  const pageEnd = document.createElement('div')
  pageEnd.className = 'om-doc-page-end'
  pageEnd.style.height = `${pageBreak.remainingContentHeight + PAGE_VERTICAL_MARGIN_PX}px`
  const pageNumberLabel = document.createElement('span')
  pageNumberLabel.className = 'om-doc-page-number'
  pageNumberLabel.textContent = String(pageNumber)
  pageEnd.append(pageNumberLabel)
  const gutter = document.createElement('div')
  gutter.className = 'om-doc-page-gutter'
  gutter.style.height = `${DOCUMENT_PAGE_GUTTER_PX}px`
  const pageStart = document.createElement('div')
  pageStart.className = 'om-doc-page-start'
  pageStart.setAttribute('data-document-page-start', '')
  pageStart.style.height = `${PAGE_VERTICAL_MARGIN_PX}px`
  root.append(pageEnd, gutter, pageStart)
  return root
}

function createDecorations(doc: ProseMirrorNode, breaks: DocumentPageBreak[]): DecorationSet {
  return DecorationSet.create(doc, breaks.map((pageBreak, index) => Decoration.widget(
    pageBreak.position,
    () => createPageBreakDom(pageBreak, index + 1),
    {
      key: [
        'document-page-break',
        pageBreak.position,
        index + 1,
        pageBreak.remainingContentHeight,
      ].join(':'),
      side: -1,
      ignoreSelection: true,
    },
  )))
}

function readPaginationMeta(transaction: Transaction): PaginationMeta | null {
  const meta = transaction.getMeta(DOCUMENT_PAGINATION_PLUGIN_KEY) as PaginationMeta | undefined
  return meta && Array.isArray(meta.breaks) ? meta : null
}

function paginationStateApply(
  transaction: Transaction,
  current: PaginationPluginState,
  _oldState: EditorState,
  newState: EditorState,
): PaginationPluginState {
  const meta = readPaginationMeta(transaction)
  if (meta) {
    return {
      breaks: meta.breaks,
      decorations: createDecorations(newState.doc, meta.breaks),
    }
  }
  if (!transaction.docChanged) return current
  const mappedBreaks = current.breaks.map((pageBreak) => ({
    ...pageBreak,
    position: transaction.mapping.map(pageBreak.position, -1),
  }))
  return {
    breaks: mappedBreaks,
    decorations: current.decorations.map(transaction.mapping, transaction.doc),
  }
}

function breaksEqual(left: DocumentPageBreak[], right: DocumentPageBreak[]): boolean {
  return left.length === right.length && left.every((value, index) => {
    const candidate = right[index]
    return candidate !== undefined
      && value.position === candidate.position
      && Math.abs(value.remainingContentHeight - candidate.remainingContentHeight) < PAGE_BREAK_EPSILON_PX
      && Math.abs(value.totalHeight - candidate.totalHeight) < PAGE_BREAK_EPSILON_PX
  })
}

function measureTopLevelBlocks(view: EditorView, currentBreaks: DocumentPageBreak[]): PaginationBlockMeasurement[] {
  const rootRect = view.dom.getBoundingClientRect()
  const paper = view.dom.closest<HTMLElement>('.om-doc-paper')
  const paperWidthCssPx = A4_PAGE_WIDTH_MM * CSS_PIXELS_PER_MM
  const scale = paper ? Math.max(0.01, paper.getBoundingClientRect().width / paperWidthCssPx) : 1
  const blocks: PaginationBlockMeasurement[] = []
  let breakIndex = 0
  let insertedHeight = 0

  view.state.doc.forEach((_node, position) => {
    const nodeDom = view.nodeDOM(position)
    if (!(nodeDom instanceof HTMLElement)) return
    const rect = nodeDom.getBoundingClientRect()
    while (breakIndex < currentBreaks.length) {
      const pageBreak = currentBreaks[breakIndex]
      if (!pageBreak || pageBreak.position > position) break
      insertedHeight += pageBreak.totalHeight
      breakIndex += 1
    }
    blocks.push({
      position,
      top: ((rect.top - rootRect.top) / scale) - insertedHeight,
      bottom: ((rect.bottom - rootRect.top) / scale) - insertedHeight,
    })
  })
  return blocks
}

function firstPageUsedHeight(view: EditorView): number {
  const paper = view.dom.closest<HTMLElement>('.om-doc-paper')
  if (!paper) return 0
  const paperRect = paper.getBoundingClientRect()
  const paperWidthCssPx = A4_PAGE_WIDTH_MM * CSS_PIXELS_PER_MM
  const scale = Math.max(0.01, paperRect.width / paperWidthCssPx)
  const paddingTop = Number.parseFloat(getComputedStyle(paper).paddingTop) || PAGE_VERTICAL_MARGIN_PX
  return Math.max(0, ((view.dom.getBoundingClientRect().top - paperRect.top) / scale) - paddingTop)
}

export function createDocumentPaginationPlugin(): Plugin<PaginationPluginState> {
  return new Plugin<PaginationPluginState>({
    key: DOCUMENT_PAGINATION_PLUGIN_KEY,
    state: {
      init: () => ({ breaks: [], decorations: DecorationSet.empty }),
      apply: paginationStateApply,
    },
    props: {
      decorations: (state) => DOCUMENT_PAGINATION_PLUGIN_KEY.getState(state)?.decorations ?? null,
    },
    view: (view) => {
      let frame: number | null = null
      let updateTimer: number | null = null
      let destroyed = false
      const recompute = () => {
        frame = null
        if (destroyed) return
        const current = DOCUMENT_PAGINATION_PLUGIN_KEY.getState(view.state)?.breaks ?? []
        const next = calculateDocumentPageBreaks(measureTopLevelBlocks(view, current), {
          firstPageUsedHeight: firstPageUsedHeight(view),
        })
        if (breaksEqual(current, next)) return
        view.dispatch(
          view.state.tr
            .setMeta(DOCUMENT_PAGINATION_PLUGIN_KEY, { breaks: next } satisfies PaginationMeta)
            .setMeta('addToHistory', false),
        )
      }
      const schedule = () => {
        if (destroyed || frame !== null) return
        if (updateTimer !== null) {
          window.clearTimeout(updateTimer)
          updateTimer = null
        }
        frame = requestAnimationFrame(recompute)
      }
      const scheduleDocumentUpdate = () => {
        if (destroyed) return
        if (updateTimer !== null) window.clearTimeout(updateTimer)
        updateTimer = window.setTimeout(() => {
          updateTimer = null
          schedule()
        }, DOCUMENT_PAGINATION_UPDATE_DELAY_MS)
      }
      const resizeObserver = typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(schedule)
      resizeObserver?.observe(view.dom)
      const paper = view.dom.closest<HTMLElement>('.om-doc-paper')
      if (paper) resizeObserver?.observe(paper)
      view.dom.addEventListener('load', schedule, true)
      window.addEventListener('resize', schedule)
      schedule()

      return {
        update: (_nextView, previousState) => {
          if (previousState.doc === view.state.doc) return
          scheduleDocumentUpdate()
        },
        destroy: () => {
          destroyed = true
          if (frame !== null) cancelAnimationFrame(frame)
          if (updateTimer !== null) window.clearTimeout(updateTimer)
          resizeObserver?.disconnect()
          view.dom.removeEventListener('load', schedule, true)
          window.removeEventListener('resize', schedule)
        },
      }
    },
  })
}

export const DocumentPagination = Extension.create({
  name: 'documentPagination',
  addProseMirrorPlugins() {
    return [createDocumentPaginationPlugin()]
  },
})

export const DOCUMENT_PAGINATION_STYLES = `
.om-doc-paper {
  box-sizing: border-box;
  width: ${A4_PAGE_WIDTH_MM}mm;
  min-width: ${A4_PAGE_WIDTH_MM}mm;
  max-width: ${A4_PAGE_WIDTH_MM}mm;
  min-height: ${A4_PAGE_HEIGHT_MM}mm;
  padding: ${DOCUMENT_PAGE_VERTICAL_MARGIN_MM}mm ${DOCUMENT_PAGE_HORIZONTAL_MARGIN_MM}mm;
}
.om-doc-canvas {
  overflow-x: auto;
  scrollbar-gutter: stable;
  overscroll-behavior-inline: contain;
}
.om-doc-paper .om-doc-page-break {
  display: block;
  width: ${A4_PAGE_WIDTH_MM}mm;
  margin-left: -${DOCUMENT_PAGE_HORIZONTAL_MARGIN_MM}mm;
  pointer-events: none;
  user-select: none;
}
.om-doc-paper .om-doc-page-end,
.om-doc-paper .om-doc-page-start {
  background: var(--card);
}
.om-doc-paper .om-doc-page-end {
  position: relative;
}
.om-doc-paper .om-doc-page-number {
  position: absolute;
  right: ${DOCUMENT_PAGE_HORIZONTAL_MARGIN_MM}mm;
  bottom: 6mm;
  color: var(--muted-foreground);
  font-size: 0.75rem;
  line-height: 1rem;
}
.om-doc-paper .om-doc-page-gutter {
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: var(--muted);
  box-shadow: inset 0 1px 2px color-mix(in oklab, var(--foreground) 8%, transparent);
}
`
