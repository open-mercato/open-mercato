/**
 * Workflows Module - cursor-aware text insertion (spec
 * 2026-07-26-workflows-ux-redesign.md section 3.5, step 3.2).
 *
 * Pure helper shared by the variable picker: given the current value of a
 * text control and a selection range, produce the value with the insertion
 * spliced in and the cursor position immediately after it. Works identically
 * for `<input>` and `<textarea>` — the element-facing wrapper only reads
 * `selectionStart`/`selectionEnd`, degrading to append-at-end when the
 * element is missing or does not expose a selection (e.g. non-text inputs).
 */

export interface CursorInsertionResult {
  value: string
  cursor: number
}

export function insertAtCursor(
  currentValue: string,
  insertion: string,
  selectionStart: number | null,
  selectionEnd: number | null,
): CursorInsertionResult {
  const length = currentValue.length
  const clamp = (position: number) => Math.min(Math.max(position, 0), length)
  const start = selectionStart === null ? length : clamp(selectionStart)
  const end = selectionEnd === null ? start : Math.max(clamp(selectionEnd), start)
  const value = `${currentValue.slice(0, start)}${insertion}${currentValue.slice(end)}`
  return { value, cursor: start + insertion.length }
}

export interface CursorInsertionTarget {
  selectionStart: number | null
  selectionEnd: number | null
}

export function insertAtElementCursor(
  element: CursorInsertionTarget | null,
  currentValue: string,
  insertion: string,
): CursorInsertionResult {
  if (element === null) return insertAtCursor(currentValue, insertion, null, null)
  let selectionStart: number | null = null
  let selectionEnd: number | null = null
  try {
    selectionStart = element.selectionStart
    selectionEnd = element.selectionEnd
  } catch {
    selectionStart = null
    selectionEnd = null
  }
  return insertAtCursor(currentValue, insertion, selectionStart, selectionEnd)
}
