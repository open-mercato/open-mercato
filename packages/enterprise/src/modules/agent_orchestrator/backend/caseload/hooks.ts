"use client"

import * as React from 'react'

/**
 * Caseload inbox cursor model (UX remediation spec 4, Phase 1).
 *
 * Replaces the implicit `selectedId` + reset-to-`rows[0]` effect with an
 * explicit cursor over the loaded, filtered row set. Semantics:
 * - the cursor follows `cursorId` across refreshes/reorders;
 * - when the id vanishes, it lands on the NEAREST index without auto-acting;
 * - after a dispose it advances to the next pending row (the one that slides
 *   into the disposed slot), moving backwards at the end of the queue;
 * - an empty row set yields the null cursor (pane renders its empty state).
 *
 * The pure functions below are the whole model — the React hook only binds
 * them to state so they stay unit-testable without a renderer.
 */

export type CursorRowLike = { id: string; isPending: boolean }

export type CursorState = {
  cursorId: string | null
  /** Position of `cursorId` in the loaded, filtered row set; -1 when null. */
  cursorIndex: number
}

export const EMPTY_CURSOR: CursorState = { cursorId: null, cursorIndex: -1 }

/**
 * Re-anchor the cursor after the row set changed (live refresh, reorder,
 * filter). Follows the id when it survived; clamps to the nearest index when
 * it vanished; defaults to the first row when there was no cursor yet.
 */
export function reconcileCursor(prev: CursorState, rows: readonly CursorRowLike[]): CursorState {
  if (rows.length === 0) {
    return prev.cursorId === null && prev.cursorIndex === -1 ? prev : EMPTY_CURSOR
  }
  if (prev.cursorId != null) {
    const index = rows.findIndex((row) => row.id === prev.cursorId)
    if (index >= 0) {
      return index === prev.cursorIndex ? prev : { cursorId: prev.cursorId, cursorIndex: index }
    }
    const nearest = Math.max(0, Math.min(prev.cursorIndex, rows.length - 1))
    return { cursorId: rows[nearest].id, cursorIndex: nearest }
  }
  return { cursorId: rows[0].id, cursorIndex: 0 }
}

/**
 * Deliberate advance-to-next after a dispose: target the next pending row
 * after the cursor (skipping everything just disposed), searching backwards
 * from the cursor when the tail has none, then falling back to the nearest
 * surviving row of any status. `rows` is the PRE-reload row set — the returned
 * index is computed against the survivors so it already matches what the next
 * refresh will render (reconcile then confirms it by id).
 */
export function advanceCursorAfterDispose(
  prev: CursorState,
  rows: readonly CursorRowLike[],
  disposedIds: readonly string[],
): CursorState {
  const disposed = new Set(disposedIds)
  const survivors = rows.filter((row) => !disposed.has(row.id))
  if (survivors.length === 0) return EMPTY_CURSOR
  if (prev.cursorId != null && !disposed.has(prev.cursorId)) {
    return reconcileCursor(prev, survivors)
  }
  const anchor = prev.cursorIndex
  let target: CursorRowLike | null = null
  for (let index = anchor + 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (row.isPending && !disposed.has(row.id)) {
      target = row
      break
    }
  }
  if (!target) {
    for (let index = Math.min(anchor, rows.length) - 1; index >= 0; index -= 1) {
      const row = rows[index]
      if (row.isPending && !disposed.has(row.id)) {
        target = row
        break
      }
    }
  }
  if (target) {
    return { cursorId: target.id, cursorIndex: survivors.findIndex((row) => row.id === target.id) }
  }
  const nearest = Math.max(0, Math.min(anchor, survivors.length - 1))
  return { cursorId: survivors[nearest].id, cursorIndex: nearest }
}

/**
 * Relative cursor movement (j/k, arrows). A null cursor anchors to the first
 * row when moving forward and the last row when moving backwards; movement is
 * clamped to the row set, never wrapping (wrap-around makes "did I hit the
 * end?" unknowable during rapid keying).
 */
export function moveCursorBy(prev: CursorState, rows: readonly CursorRowLike[], delta: number): CursorState {
  if (rows.length === 0) return EMPTY_CURSOR
  if (prev.cursorId == null) {
    const index = delta >= 0 ? 0 : rows.length - 1
    return { cursorId: rows[index].id, cursorIndex: index }
  }
  const currentIndex = rows.findIndex((row) => row.id === prev.cursorId)
  const anchor = currentIndex >= 0 ? currentIndex : Math.max(0, Math.min(prev.cursorIndex, rows.length - 1))
  const next = Math.max(0, Math.min(anchor + delta, rows.length - 1))
  const target = rows[next]
  if (target.id === prev.cursorId && next === prev.cursorIndex) return prev
  return { cursorId: target.id, cursorIndex: next }
}

/**
 * Bulk-selection preservation across live refreshes: keep only ids that are
 * still pending in the refreshed rows. Returns the SAME reference when nothing
 * changed so `setState` callers can skip a re-render.
 */
export function intersectSelection(prev: Set<string>, pendingIds: Iterable<string>): Set<string> {
  if (prev.size === 0) return prev
  const pending = pendingIds instanceof Set ? (pendingIds as Set<string>) : new Set(pendingIds)
  const next = new Set<string>()
  for (const id of prev) {
    if (pending.has(id)) next.add(id)
  }
  return next.size === prev.size ? prev : next
}

export type InboxCursor = {
  cursorId: string | null
  cursorIndex: number
  /** Explicit user selection (row click). Unknown ids are ignored. */
  setCursor: (id: string) => void
  /** Relative movement for j/k + arrow hotkeys (clamped, never wraps). */
  moveCursor: (delta: number) => void
  /** Escape: close the pane by dropping the cursor (next refresh re-anchors). */
  clearCursor: () => void
  /** Deliberate advance-to-neighbor after dispose (single or bulk). */
  advanceAfterDispose: (disposedIds: readonly string[]) => void
}

export function useInboxCursor(rows: readonly CursorRowLike[]): InboxCursor {
  const [cursor, setCursorState] = React.useState<CursorState>(() => reconcileCursor(EMPTY_CURSOR, rows))
  const rowsRef = React.useRef(rows)
  rowsRef.current = rows

  React.useEffect(() => {
    setCursorState((prev) => reconcileCursor(prev, rows))
  }, [rows])

  const setCursor = React.useCallback((id: string) => {
    const index = rowsRef.current.findIndex((row) => row.id === id)
    if (index < 0) return
    setCursorState({ cursorId: id, cursorIndex: index })
  }, [])

  const moveCursor = React.useCallback((delta: number) => {
    setCursorState((prev) => moveCursorBy(prev, rowsRef.current, delta))
  }, [])

  const clearCursor = React.useCallback(() => {
    setCursorState(EMPTY_CURSOR)
  }, [])

  const advanceAfterDispose = React.useCallback((disposedIds: readonly string[]) => {
    setCursorState((prev) => advanceCursorAfterDispose(prev, rowsRef.current, disposedIds))
  }, [])

  return { cursorId: cursor.cursorId, cursorIndex: cursor.cursorIndex, setCursor, moveCursor, clearCursor, advanceAfterDispose }
}

/**
 * Caseload inbox hotkeys (UX remediation spec 4, Phase 2).
 *
 * One `document`-level keydown listener drives the whole triage keyboard: the
 * resolver below is a pure function over an event snapshot so the guard rules
 * (editable focus, open modal layer, held modifiers, key repeat) are
 * unit-testable without a renderer. Letter keys act only when nothing modal is
 * open and focus is not in a text-entry control — the two failure modes that
 * would turn a keystroke meant for a form into a disposition.
 */
export type CaseloadHotkeyAction =
  | 'next'
  | 'prev'
  | 'open'
  | 'approve'
  | 'reject'
  | 'edit'
  | 'toggleSelect'
  | 'legend'
  | 'escape'

export type CaseloadHotkeyEvent = {
  key: string
  repeat: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  /** Focus sits in an input/textarea/select/contenteditable. */
  editableTarget: boolean
  /** The event target is natively activatable (button/link) — Enter defers to it. */
  interactiveTarget: boolean
  /** A dialog or the shortcut-legend popover is open — everything is inert. */
  modalOpen: boolean
}

export function resolveCaseloadHotkey(event: CaseloadHotkeyEvent): CaseloadHotkeyAction | null {
  if (event.repeat) return null
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  if (event.modalOpen) return null
  if (event.editableTarget) return null
  switch (event.key) {
    case 'j':
    case 'ArrowDown':
      return 'next'
    case 'k':
    case 'ArrowUp':
      return 'prev'
    case 'o':
      return 'open'
    case 'Enter':
      // A focused button/link owns Enter — native activation already does the
      // right thing (row buttons set the cursor, footer buttons act).
      return event.interactiveTarget ? null : 'open'
    case 'a':
      return 'approve'
    case 'r':
      return 'reject'
    case 'e':
      return 'edit'
    case 'x':
      return 'toggleSelect'
    case '?':
      return 'legend'
    case 'Escape':
      return 'escape'
    default:
      return null
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return !!target.closest('button, a[href], [role="button"], [role="option"], summary')
}

/**
 * Any open modal layer makes the hotkeys inert: house dialogs stamp
 * `data-dialog-content` (Radix adds `data-state`), Radix keeps `role="dialog"`
 * for third-party content, and the shortcut-legend popover opts in explicitly
 * via `data-caseload-hotkey-modal` (popovers carry no dialog role).
 */
function hasOpenModalLayer(): boolean {
  return !!document.querySelector(
    '[data-dialog-content][data-state="open"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-caseload-hotkey-modal][data-state="open"]',
  )
}

export function useCaseloadHotkeys(enabled: boolean, onAction: (action: CaseloadHotkeyAction) => void): void {
  const handlerRef = React.useRef(onAction)
  handlerRef.current = onAction

  React.useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveCaseloadHotkey({
        key: event.key,
        repeat: event.repeat,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        editableTarget: isEditableTarget(event.target),
        interactiveTarget: isInteractiveTarget(event.target),
        modalOpen: hasOpenModalLayer(),
      })
      if (!action) return
      event.preventDefault()
      handlerRef.current(action)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
