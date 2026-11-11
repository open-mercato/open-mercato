import { Extension, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { resolveCommentAnchor } from './CommentAnchorNavigation'
import {
  resolveFindingRanges,
  type DocumentFindingItem,
  type FindingDecorationRange,
  type FindingRange,
  type FindingResolutionResult,
} from './findingModel'

type FindingDecorationsState = {
  ranges: FindingDecorationRange[]
  activeId: string | null
  decorations: DecorationSet
}

type FindingDecorationsMeta = {
  ranges: FindingDecorationRange[]
  activeId: string | null
}

export const FINDING_DECORATIONS_PLUGIN_KEY = new PluginKey<FindingDecorationsState>('documentsFindingDecorations')

export const FINDING_DECORATION_ATTRIBUTE = 'data-finding-id'

export function findingDecorationClass(range: FindingDecorationRange, activeId: string | null): string {
  const classes = ['om-doc-finding', `om-doc-finding--${range.severity}`]
  if (range.id === activeId) classes.push('om-doc-finding--active')
  return classes.join(' ')
}

export function createFindingDecorationSet(
  doc: ProseMirrorNode,
  ranges: FindingDecorationRange[],
  activeId: string | null,
): DecorationSet {
  const size = doc.content.size
  const decorations = ranges
    .filter((range) => range.from >= 0 && range.to <= size && range.from < range.to)
    .map((range) => Decoration.inline(
      range.from,
      range.to,
      { class: findingDecorationClass(range, activeId), [FINDING_DECORATION_ATTRIBUTE]: range.id },
      { findingId: range.id },
    ))
  return DecorationSet.create(doc, decorations)
}

export function mapFindingDecorationRanges(
  ranges: FindingDecorationRange[],
  mapPosition: (position: number, association: number) => number,
): FindingDecorationRange[] {
  return ranges.flatMap((range) => {
    const from = mapPosition(range.from, 1)
    const to = mapPosition(range.to, -1)
    return from < to ? [{ ...range, from, to }] : []
  })
}

function readMeta(transaction: Transaction): FindingDecorationsMeta | null {
  const meta = transaction.getMeta(FINDING_DECORATIONS_PLUGIN_KEY) as FindingDecorationsMeta | undefined
  return meta && Array.isArray(meta.ranges) ? meta : null
}

function applyFindingDecorationsState(
  transaction: Transaction,
  current: FindingDecorationsState,
  _oldState: EditorState,
  newState: EditorState,
): FindingDecorationsState {
  const meta = readMeta(transaction)
  if (meta) {
    return {
      ranges: meta.ranges,
      activeId: meta.activeId,
      decorations: createFindingDecorationSet(newState.doc, meta.ranges, meta.activeId),
    }
  }
  if (!transaction.docChanged || current.ranges.length === 0) return current
  return {
    ranges: mapFindingDecorationRanges(current.ranges, (position, association) => transaction.mapping.map(position, association)),
    activeId: current.activeId,
    decorations: current.decorations.map(transaction.mapping, transaction.doc),
  }
}

export function createFindingDecorationsPlugin(): Plugin<FindingDecorationsState> {
  return new Plugin<FindingDecorationsState>({
    key: FINDING_DECORATIONS_PLUGIN_KEY,
    state: {
      init: () => ({ ranges: [], activeId: null, decorations: DecorationSet.empty }),
      apply: applyFindingDecorationsState,
    },
    props: {
      decorations: (state) => FINDING_DECORATIONS_PLUGIN_KEY.getState(state)?.decorations ?? null,
    },
  })
}

export const DocumentFindingDecorations = Extension.create({
  name: 'documentFindingDecorations',
  addProseMirrorPlugins() {
    return [createFindingDecorationsPlugin()]
  },
})

export function readFindingDecorationRanges(state: EditorState): FindingDecorationRange[] {
  return FINDING_DECORATIONS_PLUGIN_KEY.getState(state)?.ranges ?? []
}

export function isFindingDecorationTransaction(transaction: Transaction): boolean {
  return readMeta(transaction) !== null
}

function editorAvailable(editor: Editor | null): editor is Editor {
  return Boolean(editor && !editor.isDestroyed && FINDING_DECORATIONS_PLUGIN_KEY.getState(editor.state))
}

export function setFindingDecorations(
  editor: Editor | null,
  ranges: FindingDecorationRange[],
  activeId: string | null,
): void {
  if (!editorAvailable(editor)) return
  editor.view.dispatch(
    editor.state.tr
      .setMeta(FINDING_DECORATIONS_PLUGIN_KEY, { ranges, activeId } satisfies FindingDecorationsMeta)
      .setMeta('addToHistory', false),
  )
}

function readRangeText(editor: Editor, range: FindingRange): string {
  return editor.state.doc.textBetween(range.from, range.to, ' ', ' ')
}

export function resolveFindingsInEditor(
  editor: Editor | null,
  findings: DocumentFindingItem[],
): FindingResolutionResult {
  if (!editor || editor.isDestroyed) return resolveFindingRanges(findings, () => null, () => '')
  return resolveFindingRanges(
    findings,
    (anchor) => resolveCommentAnchor(editor, anchor),
    (range) => readRangeText(editor, range),
  )
}

export function syncFindingDecorations(
  editor: Editor | null,
  findings: DocumentFindingItem[],
  activeId: string | null,
): FindingResolutionResult {
  const result = resolveFindingsInEditor(editor, findings)
  setFindingDecorations(editor, result.ranges, activeId)
  return result
}

export function selectFindingRange(editor: Editor | null, range: FindingRange): boolean {
  if (!editor || editor.isDestroyed) return false
  return editor.chain().setTextSelection(range).scrollIntoView().run()
}

export function replaceFindingText(editor: Editor | null, range: FindingRange, text: string): boolean {
  if (!editor || editor.isDestroyed || !editor.isEditable) return false
  const chain = editor.chain()
  return text.length > 0
    ? chain.insertContentAt(range, { type: 'text', text }).run()
    : chain.deleteRange(range).run()
}

export function revertLastEditorChange(editor: Editor | null): boolean {
  if (!editor || editor.isDestroyed || !editor.isEditable) return false
  return editor.commands.undo()
}

export const FINDING_DECORATION_STYLES = `
.ProseMirror .om-doc-finding {
  border-bottom: 2px solid transparent;
  border-radius: var(--radius-sm, 0.25rem);
  cursor: pointer;
  transition: box-shadow 120ms ease;
}
.ProseMirror .om-doc-finding--blocking {
  background: var(--status-error-bg);
  border-bottom-color: var(--status-error-icon);
}
.ProseMirror .om-doc-finding--warning {
  background: var(--status-warning-bg);
  border-bottom-color: var(--status-warning-icon);
}
.ProseMirror .om-doc-finding--info {
  background: var(--status-info-bg);
  border-bottom-color: var(--status-info-icon);
}
.ProseMirror .om-doc-finding--active {
  box-shadow: 0 0 0 2px var(--ring);
}
.om-doc-preview .ProseMirror .om-doc-finding {
  cursor: default;
}
@media (prefers-reduced-motion: reduce) {
  .ProseMirror .om-doc-finding { transition: none; }
}
`
