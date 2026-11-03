/**
 * Workflows Module - drag-a-field-into-a-parameter transfer contract (spec
 * 2026-07-26-workflows-ux-redesign.md section 3.5: "click and drag are both
 * first-class").
 *
 * A ledger row in the Input data panel carries TWO payloads:
 * - `text/plain` = the ready-to-paste `{{path}}` pill, so dropping onto ANY
 *   `<input>`/`<textarea>` works through the browser's native text drop even
 *   where this module has no handler at all;
 * - a private MIME carrying the BARE path, so template-capable fields can
 *   intercept the drop, insert at the caret through `insertAtElementCursor`,
 *   and choose their own insert mode (mapping cells take bare paths).
 *
 * Pure and DOM-free: it reads a minimal `DataTransfer` shape, so both the drag
 * payload and the drop insertion are unit-testable without a real drag gesture.
 */

import { insertAtElementCursor, type CursorInsertionResult, type CursorInsertionTarget } from './insert-at-cursor'

export const LEDGER_PATH_MIME = 'application/x-om-ledger-path'

export type LedgerInsertMode = 'template' | 'bare'

export interface LedgerDragDataTransfer {
  getData: (type: string) => string
  setData: (type: string, value: string) => void
  types?: ReadonlyArray<string>
}

export function ledgerInsertionText(path: string, insertMode: LedgerInsertMode): string {
  return insertMode === 'bare' ? path : `{{${path}}}`
}

/** Writes both payloads for a dragged ledger row. */
export function writeLedgerDragPayload(dataTransfer: LedgerDragDataTransfer, path: string): void {
  dataTransfer.setData('text/plain', ledgerInsertionText(path, 'template'))
  dataTransfer.setData(LEDGER_PATH_MIME, path)
}

/** The dragged ledger path, or null when the drag did not come from the panel. */
export function readLedgerDragPath(dataTransfer: LedgerDragDataTransfer | null | undefined): string | null {
  if (!dataTransfer) return null
  if (Array.isArray(dataTransfer.types) && !dataTransfer.types.includes(LEDGER_PATH_MIME)) return null
  const path = dataTransfer.getData(LEDGER_PATH_MIME)
  return typeof path === 'string' && path.length > 0 ? path : null
}

/**
 * Resolves what a drop should write into a text control. Returns null when the
 * payload is not a ledger path, leaving the browser's native handling intact.
 */
export function resolveLedgerDrop(
  dataTransfer: LedgerDragDataTransfer | null | undefined,
  target: CursorInsertionTarget | null,
  currentValue: string,
  insertMode: LedgerInsertMode = 'template',
): CursorInsertionResult | null {
  const path = readLedgerDragPath(dataTransfer)
  if (path === null) return null
  return insertAtElementCursor(target, currentValue, ledgerInsertionText(path, insertMode))
}
