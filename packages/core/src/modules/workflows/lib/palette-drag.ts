/**
 * Palette drag transfer contract (spec section 4.2: "Drag-from-palette drops at
 * the cursor; click appends for keyboard users").
 *
 * A palette entry carries TWO payloads, the same way a ledger row does
 * (`lib/ledger-drag.ts`): a human-readable `text/plain` label so dropping
 * somewhere with no handler degrades to inserting text rather than doing
 * something surprising, and a private MIME carrying the machine payload the
 * canvas reads.
 *
 * Dragging is an ENHANCEMENT over the click path, never the only way in: every
 * palette entry stays a button, because the click path is the keyboard path.
 *
 * PURE and DOM-free: it reads a minimal `DataTransfer` shape, so the payload is
 * unit-testable without a real drag gesture (jsdom cannot perform one).
 */

export const WORKFLOW_PALETTE_DRAG_MIME = 'application/x-om-workflow-palette'

export type PaletteDragItem =
  | { kind: 'step'; nodeType: string }
  | { kind: 'activity'; activityType: string }

export interface PaletteDragDataTransfer {
  getData: (type: string) => string
  setData: (type: string, value: string) => void
  types?: ReadonlyArray<string>
  effectAllowed?: string
}

export function writePaletteDragPayload(
  dataTransfer: PaletteDragDataTransfer,
  item: PaletteDragItem,
  label: string,
): void {
  dataTransfer.setData('text/plain', label)
  dataTransfer.setData(WORKFLOW_PALETTE_DRAG_MIME, JSON.stringify(item))
  dataTransfer.effectAllowed = 'copy'
}

function parsePaletteDragItem(raw: string): PaletteDragItem | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const candidate = parsed as Record<string, unknown>
  if (candidate.kind === 'step' && typeof candidate.nodeType === 'string' && candidate.nodeType.length > 0) {
    return { kind: 'step', nodeType: candidate.nodeType }
  }
  if (candidate.kind === 'activity' && typeof candidate.activityType === 'string' && candidate.activityType.length > 0) {
    return { kind: 'activity', activityType: candidate.activityType }
  }
  return null
}

/** The dragged palette entry, or null when the drag did not come from the palette. */
export function readPaletteDragItem(
  dataTransfer: PaletteDragDataTransfer | null | undefined,
): PaletteDragItem | null {
  if (!dataTransfer) return null
  if (Array.isArray(dataTransfer.types) && !dataTransfer.types.includes(WORKFLOW_PALETTE_DRAG_MIME)) return null
  const raw = dataTransfer.getData(WORKFLOW_PALETTE_DRAG_MIME)
  if (typeof raw !== 'string' || raw.length === 0) return null
  return parsePaletteDragItem(raw)
}
