import { MAX_ROWS, buildSegmentExportCsv } from '../segment-export'

const row = (id: string, displayName: string | null, primaryEmail: string | null) => ({ id, displayName, primaryEmail })

describe('buildSegmentExportCsv', () => {
  it('writes the header and one row per member, in the order given', () => {
    const resolution = { ids: ['c1', 'c2'], complete: true, checked: 2 }
    const rows = [row('c1', 'Alice', 'alice@example.com'), row('c2', 'Bob', 'bob@example.com')]
    const { csv, complete } = buildSegmentExportCsv(resolution, rows)
    expect(complete).toBe(true)
    expect(csv).toBe(
      'customer_id,display_name,email\r\n'
      + 'c1,Alice,alice@example.com\r\n'
      + 'c2,Bob,bob@example.com\r\n',
    )
  })

  it('reports a member missing from the fetched rows as blank cells rather than dropping it', () => {
    const resolution = { ids: ['c1'], complete: true, checked: 1 }
    const { csv } = buildSegmentExportCsv(resolution, [])
    expect(csv).toBe('customer_id,display_name,email\r\nc1,,\r\n')
  })

  /**
   * The trailing row IS the signal a browser navigation can see — see the docblock on
   * `buildSegmentExportCsv`. A segment the resolver could not finish checking (`resolution.complete` false)
   * must carry it, and `complete` in the return value — the same flag the route mirrors in a header — must
   * say so too.
   */
  it('appends the incomplete-export row and reports complete: false when the resolver stopped early', () => {
    const resolution = { ids: ['c1'], complete: false, checked: 4_000 }
    const { csv, complete } = buildSegmentExportCsv(resolution, [row('c1', 'Alice', 'alice@example.com')])
    expect(complete).toBe(false)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('customer_id,display_name,email')
    expect(lines[1]).toBe('c1,Alice,alice@example.com')
    expect(lines[2]).toContain('INCOMPLETE EXPORT')
    expect(lines[2]).toContain('Only 4000 of the segment were checked')
  })

  /**
   * The resolver can report `complete: true` while still handing back exactly `MAX_ROWS` ids — it stopped
   * because it hit the FILE cap, not because it ran out of candidates. The file is not the whole segment
   * either way, so the trailing row must appear on this path too, not only when the resolver itself gives up.
   */
  it('treats hitting MAX_ROWS as incomplete even when the resolver says complete: true', () => {
    const ids = Array.from({ length: MAX_ROWS }, (_, index) => `c${index}`)
    const resolution = { ids, complete: true, checked: MAX_ROWS }
    const { csv, complete } = buildSegmentExportCsv(resolution, [])
    expect(complete).toBe(false)
    expect(csv.split('\r\n').at(-2)).toContain('INCOMPLETE EXPORT')
  })

  it('escapes a formula-leading display name so a spreadsheet never evaluates it', () => {
    const resolution = { ids: ['c1'], complete: true, checked: 1 }
    const { csv } = buildSegmentExportCsv(resolution, [row('c1', '=HYPERLINK("https://evil/","x")', null)])
    const dataLine = csv.split('\r\n')[1]
    // Quoted (the value contains a comma) and apostrophe-prefixed so the leading `=` never reaches the cell.
    expect(dataLine).toContain("'=HYPERLINK")
    expect(dataLine.startsWith('c1,"\'=HYPERLINK')).toBe(true)
  })
})
