/**
 * Undo/redo command stack for the workflow Studio (spec section 4.5).
 *
 * One stack over the whole editor document — the canvas and the inspector edit
 * the same `{ nodes, edges, metadata }` object, so a step rename undoes exactly
 * like a deleted route. Entries are SNAPSHOTS rather than diffs: a workflow
 * document is small enough that copying a reference to the already-immutable
 * node/edge arrays costs nothing, and a snapshot cannot drift out of sync with
 * the live state the way an inverse-command log can.
 *
 * The stack stores the document as it was BEFORE each edit, which is what lets
 * callers commit from inside an asynchronous handler: capture the document up
 * front, run the confirmation, and only commit once the edit actually lands.
 *
 * Every entry carries a human label ("Delete step", "Paste"), so the shortcut
 * can say what it just reverted and a later phase can name AI checkpoints in
 * the same stack.
 *
 * PURE: plain data in, plain data out — no React, no xyflow runtime.
 */

import type { Node, Edge } from '@xyflow/react'

/** Spec section 4.5: "100 steps". */
export const EDITOR_HISTORY_LIMIT = 100

/**
 * The document the stack versions. `metadata` is the definition's editor-owned
 * metadata bag (pinned samples and, from step 3.9, annotations); the
 * definition-panel text fields are deliberately NOT on the stack — a text input
 * has its own native undo and committing per keystroke would evict real
 * structural edits from a 100-entry stack.
 */
/**
 * The definition-panel fields the canvas does NOT carry — triggers, the context
 * schema, the sub-workflow port contract, the interpolation mode and the
 * workflow-level error handler.
 *
 * Kept OPAQUE here on purpose: this module must not learn the definition's
 * vocabulary to version it, and the page is the only thing that reads the
 * shape back. Versioning them matters because the Code view's Apply replaces
 * the WHOLE document — undoing it without them would restore the graph with
 * somebody else's triggers attached.
 */
export interface WorkflowEditorPanelState {
  triggers: unknown
  contextSchema: unknown
  io: unknown
  interpolation: unknown
  errorHandler: unknown
}

export interface WorkflowEditorDocument {
  nodes: Node[]
  edges: Edge[]
  metadata: Record<string, unknown> | null
  /**
   * Absent on entries captured before this field existed, which is why every
   * reader treats it as optional and simply leaves the panel alone when it is
   * missing.
   */
  panel?: WorkflowEditorPanelState
}

export interface EditorHistoryEntry<TDocument> {
  /** Translated description of the edit this entry reverts. */
  label: string
  document: TDocument
}

export interface EditorHistoryState<TDocument> {
  past: EditorHistoryEntry<TDocument>[]
  future: EditorHistoryEntry<TDocument>[]
}

export interface EditorHistoryStep<TDocument> {
  state: EditorHistoryState<TDocument>
  document: TDocument
  label: string
}

export function createEditorHistory<TDocument>(): EditorHistoryState<TDocument> {
  return { past: [], future: [] }
}

/**
 * Record an edit.
 *
 * `previousDocument` is the state to return to, and `label` names the edit that
 * replaced it. A new edit invalidates the redo branch: once the author has
 * diverged, the abandoned future is unreachable and keeping it would let a redo
 * resurrect a document that never followed from what is on screen.
 */
export function commitEditorHistory<TDocument>(
  state: EditorHistoryState<TDocument>,
  previousDocument: TDocument,
  label: string,
  limit: number = EDITOR_HISTORY_LIMIT,
): EditorHistoryState<TDocument> {
  const past = [...state.past, { label, document: previousDocument }]
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    future: [],
  }
}

export function canUndoEditorHistory<TDocument>(state: EditorHistoryState<TDocument>): boolean {
  return state.past.length > 0
}

export function canRedoEditorHistory<TDocument>(state: EditorHistoryState<TDocument>): boolean {
  return state.future.length > 0
}

/**
 * Step back one edit. Returns the document to restore plus the next stack
 * state, or `null` when there is nothing to undo. `currentDocument` is what is
 * on screen right now — it becomes the redo target.
 */
export function undoEditorHistory<TDocument>(
  state: EditorHistoryState<TDocument>,
  currentDocument: TDocument,
): EditorHistoryStep<TDocument> | null {
  const entry = state.past[state.past.length - 1]
  if (!entry) return null
  return {
    state: {
      past: state.past.slice(0, state.past.length - 1),
      future: [{ label: entry.label, document: currentDocument }, ...state.future],
    },
    document: entry.document,
    label: entry.label,
  }
}

/** Step forward one previously undone edit. */
export function redoEditorHistory<TDocument>(
  state: EditorHistoryState<TDocument>,
  currentDocument: TDocument,
): EditorHistoryStep<TDocument> | null {
  const entry = state.future[0]
  if (!entry) return null
  return {
    state: {
      past: [...state.past, { label: entry.label, document: currentDocument }],
      future: state.future.slice(1),
    },
    document: entry.document,
    label: entry.label,
  }
}
