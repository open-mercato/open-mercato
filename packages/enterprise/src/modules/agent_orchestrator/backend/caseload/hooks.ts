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

  const advanceAfterDispose = React.useCallback((disposedIds: readonly string[]) => {
    setCursorState((prev) => advanceCursorAfterDispose(prev, rowsRef.current, disposedIds))
  }, [])

  return { cursorId: cursor.cursorId, cursorIndex: cursor.cursorIndex, setCursor, advanceAfterDispose }
}
