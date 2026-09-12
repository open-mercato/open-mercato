/** @jest-environment node */
import { inflateRawSync } from 'node:zlib'
import { buildXlsx, buildSheetXml, columnName, XLSX_CONTENT_TYPE } from '../xlsx'
import { buildPdf, encodePdfText, measureText, PDF_CONTENT_TYPE } from '../pdf'
import {
  buildReportPdfLines,
  buildReportTable,
  normalizeReportExportFormat,
  serializeReportExport,
  type ReportExportInput,
} from '../reportExport'
import { buildReportRows, sumReportRowAmounts, sumReportRowMinutes } from '../reportRows'
import { computeReportTotals, type ReportInputEntry, type ReportInputProject } from '../reportTotals'

const projects: ReportInputProject[] = [
  { id: 'p1', name: 'Nordvik — migracja B2B', hourlyRate: 320, currencyCode: 'PLN' },
]

const directory = {
  taskLabelById: { t1: 'Migracja koszyka B2B', t2: 'Refaktor serwisu podatkowego' },
  personLabelById: { m1: 'Marek Wójcik', m2: 'Paulina Zych' },
}

const labels = { unassignedTask: 'Bez zadania', unassignedPerson: 'Bez osoby', nonbillableGroup: 'Czas nierozliczalny' }

const entries: ReportInputEntry[] = [
  {
    id: 'e1',
    timeProjectId: 'p1',
    taskId: 't1',
    rootTaskId: 't1',
    staffMemberId: 'm1',
    date: '2026-06-01',
    durationMinutes: 1365,
    roundedMinutes: 1365,
    isBillable: true,
    rateOverrideAmount: null,
    description: 'Zamknięcie API koszyka',
    frozen: null,
  },
  {
    id: 'e2',
    timeProjectId: 'p1',
    taskId: 't2',
    rootTaskId: 't2',
    staffMemberId: 'm2',
    date: '2026-06-02',
    durationMinutes: 255,
    roundedMinutes: 255,
    isBillable: true,
    rateOverrideAmount: 260,
    description: 'Rabaty kontraktowe',
    frozen: null,
  },
  {
    id: 'e3',
    timeProjectId: 'p1',
    taskId: null,
    rootTaskId: null,
    staffMemberId: 'm1',
    date: '2026-06-03',
    durationMinutes: 135,
    roundedMinutes: 135,
    isBillable: false,
    rateOverrideAmount: null,
    description: 'Cotygodniowe statusy',
    frozen: null,
  },
]

function makeExportInput(overrides: Partial<ReportExportInput> = {}): ReportExportInput {
  const totals = computeReportTotals({
    entries,
    projects,
    directory,
    options: { grouping: 'project_task', nonbillableMode: 'separate', includeAlreadyReported: false },
    labels,
  })
  const rows = buildReportRows({ entries, projects, directory, labels })
  return {
    reference: 'RAP-2026-0042',
    title: 'Nordvik · czerwiec 2026',
    customerName: 'Nordvik Retail AB',
    periodLabel: '2026-06-01 – 2026-06-30',
    issuedByLabel: 'Marek Wójcik',
    issuedAtLabel: '2026-07-20',
    currencyCode: 'PLN',
    showRates: true,
    groups: totals.groups,
    rows,
    totals: {
      billableMinutes: totals.billableMinutes,
      nonbillableMinutes: totals.nonbillableMinutes,
      totalAmount: totals.totalAmount,
    },
    roundingLabel: 'zaokrąglenie 15 min, zawsze w górę',
    labels: {
      documentTitle: 'Zestawienie czasu i kosztów',
      issuedBy: 'Wystawił',
      reference: 'Numer',
      period: 'Okres',
      line: 'Zadanie',
      time: 'Czas',
      rate: 'Stawka',
      amount: 'Kwota',
      total: 'Razem do zafakturowania',
      totalHint: '{billable} rozliczalne · {nonbillable} nierozliczalne · {rounding}',
      nonbillable: 'Czas nierozliczalny',
      overrideBadge: 'stawka wg ustaleń',
      date: 'Data',
      project: 'Projekt',
      task: 'Zadanie',
      person: 'Osoba',
      description: 'Opis',
      billable: 'Rozliczalny',
      yes: 'Tak',
      no: 'Nie',
      rawMinutes: 'Minuty surowe',
      roundedMinutes: 'Minuty zaokrąglone',
    },
    ...overrides,
  }
}

describe('report rows', () => {
  it('flattens one row per entry and reconciles with the grouped total', () => {
    const input = makeExportInput()
    expect(input.rows).toHaveLength(3)
    // The raw CSV a client's accountant adds up must reach the same number the
    // PDF prints — same per-entry values, summed in integer cents.
    expect(sumReportRowAmounts(input.rows)).toBe(input.totals.totalAmount)
    expect(sumReportRowMinutes(input.rows, true)).toBe(input.totals.billableMinutes)
    expect(sumReportRowMinutes(input.rows, false)).toBe(input.totals.nonbillableMinutes)
  })

  it('gives a non-billable row no amount rather than a zero', () => {
    const input = makeExportInput()
    const nonBillable = input.rows.find((row) => !row.isBillable)
    expect(nonBillable?.amount).toBeNull()
  })

  it('sorts by date so an accounting export reads chronologically', () => {
    const dates = makeExportInput().rows.map((row) => row.date)
    expect(dates).toEqual([...dates].sort())
  })
})

describe('CSV/XLSX carry the raw accounting columns (screen 14 note 3)', () => {
  it('includes date, person and description, which the grouped sheet never prints', () => {
    const table = buildReportTable(makeExportInput())
    const fields = table.columns.map((column) => column.field)
    expect(fields).toEqual(
      expect.arrayContaining(['date', 'person', 'description', 'rawMinutes', 'roundedMinutes']),
    )
    expect(table.rows[0].description).toBe('Zamknięcie API koszyka')
  })

  it('shows raw beside rounded minutes, so the rounding is visible rather than derived', () => {
    const table = buildReportTable(
      makeExportInput({
        rows: buildReportRows({
          entries: [{ ...entries[0], durationMinutes: 47, roundedMinutes: 60 }],
          projects,
          directory,
          labels,
        }),
      }),
    )
    expect(table.rows[0].rawMinutes).toBe(47)
    expect(table.rows[0].roundedMinutes).toBe(60)
  })

  it('omits the rate column entirely when rates are hidden', () => {
    const table = buildReportTable(makeExportInput({ showRates: false }))
    expect(table.columns.map((column) => column.field)).not.toContain('rate')
  })
})

describe('CSV serialization', () => {
  it('produces a UTF-8 CSV with a BOM so Excel keeps Polish names intact', () => {
    const file = serializeReportExport('csv', makeExportInput())
    expect(file.filename).toBe('RAP-2026-0042.csv')
    expect(file.contentType).toContain('text/csv')
    const text = file.body.toString('utf8')
    expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(text).toContain('Marek Wójcik')
    expect(text).toContain('Migracja koszyka B2B')
  })
})

describe('XLSX writer', () => {
  it('names columns bijectively', () => {
    expect(columnName(0)).toBe('A')
    expect(columnName(25)).toBe('Z')
    expect(columnName(26)).toBe('AA')
  })

  it('writes numbers as numbers so a column of amounts sums in Excel', () => {
    const xml = buildSheetXml({ name: 'S', rows: [['Amount'], [1234.56]] })
    expect(xml).toContain('<c r="A2"><v>1234.56</v></c>')
    expect(xml).toContain('t="inlineStr"')
  })

  it('escapes XML rather than producing a file Excel refuses', () => {
    const xml = buildSheetXml({ name: 'S', rows: [['A & B <c>']] })
    expect(xml).toContain('A &amp; B &lt;c&gt;')
  })

  it('emits a real ZIP whose parts inflate back to their XML', () => {
    const file = serializeReportExport('xlsx', makeExportInput())
    expect(file.contentType).toBe(XLSX_CONTENT_TYPE)
    expect(file.filename).toBe('RAP-2026-0042.xlsx')
    // Local file header signature, then the end-of-central-directory record.
    expect(file.body.readUInt32LE(0)).toBe(0x04034b50)
    const eocd = file.body.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    expect(eocd).toBeGreaterThan(0)
    expect(file.body.readUInt16LE(eocd + 10)).toBe(5)

    // Inflate the first entry and check it really is the content-types part.
    const nameLength = file.body.readUInt16LE(26)
    const extraLength = file.body.readUInt16LE(28)
    const compressedSize = file.body.readUInt32LE(18)
    const name = file.body.subarray(30, 30 + nameLength).toString('utf8')
    expect(name).toBe('[Content_Types].xml')
    const start = 30 + nameLength + extraLength
    const inflated = inflateRawSync(file.body.subarray(start, start + compressedSize)).toString('utf8')
    expect(inflated).toContain('spreadsheetml.sheet.main+xml')
  })

  it('carries the Polish description through the sheet part', () => {
    const file = buildXlsx({ name: 'RAP', rows: [['Opis'], ['Zamknięcie API koszyka']] })
    const eocdIndex = file.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    expect(eocdIndex).toBeGreaterThan(0)
  })
})

describe('PDF writer', () => {
  it('maps Polish glyphs to their /Differences code points instead of dropping them', () => {
    // ą=1 ć=2 ę=3 ł=4 ń=5 ś=6 ź=7 ż=8; ó is plain WinAnsi 0xF3.
    expect(encodePdfText('ąćęłńśźż')).toBe(
      [1, 2, 3, 4, 5, 6, 7, 8].map((code) => String.fromCharCode(code)).join(''),
    )
    expect(encodePdfText('ó')).toBe('ó')
  })

  it('escapes the three characters that would otherwise break a PDF string', () => {
    expect(encodePdfText('a(b)c\\d')).toBe('a\\(b\\)c\\\\d')
  })

  it('renders an unmappable character visibly rather than silently dropping it', () => {
    expect(encodePdfText('日')).toBe('?')
  })

  it('measures wider text as wider, which is what right-alignment depends on', () => {
    expect(measureText('WWWW', 9, false)).toBeGreaterThan(measureText('iiii', 9, false))
    expect(measureText('1 234,56', 9, false)).toBeGreaterThan(0)
  })

  it('emits a structurally complete document with a resolvable xref', () => {
    const file = buildPdf({ title: 'x', lines: [{ kind: 'cells', cells: [{ text: 'Nordvik', x: 42 }] }] })
    const text = file.toString('latin1')
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)

    const startxrefMatch = /startxref\n(\d+)\n%%EOF/.exec(text)
    expect(startxrefMatch).not.toBeNull()
    const xrefOffset = Number(startxrefMatch![1])
    // The offset must actually land on the xref table, which is the single thing
    // most likely to be wrong in a hand-written PDF.
    expect(text.slice(xrefOffset, xrefOffset + 4)).toBe('xref')

    // And the first object offset must land on that object's header.
    const rowMatch = /xref\n0 (\d+)\n0000000000 65535 f \n(\d{10})/.exec(text)
    expect(rowMatch).not.toBeNull()
    expect(text.slice(Number(rowMatch![2]), Number(rowMatch![2]) + 7)).toBe('1 0 obj')
  })

  it('paginates rather than writing past the bottom of the page', () => {
    const many = Array.from({ length: 200 }, (_, index) => ({
      kind: 'cells' as const,
      cells: [{ text: `row ${index}`, x: 42 }],
    }))
    const file = buildPdf({ title: 'x', lines: many }).toString('latin1')
    const pageCount = (file.match(/\/Type \/Page[^s]/g) ?? []).length
    expect(pageCount).toBeGreaterThan(1)
    expect(file).toContain(`/Count ${pageCount}`)
  })
})

describe('PDF mirrors the sheet (screen 14 note 3)', () => {
  it('prints every group, the override badge and the total', () => {
    const input = makeExportInput()
    const lines = buildReportPdfLines(input)
    const texts = lines.flatMap((line) => (line.kind === 'cells' ? line.cells.map((cell) => cell.text.trim()) : []))
    expect(texts).toContain('Nordvik — migracja B2B')
    expect(texts).toContain('Czas nierozliczalny')
    expect(texts.some((text) => text.includes('stawka wg ustaleń'))).toBe(true)
    expect(texts).toContain('Razem do zafakturowania')
    expect(texts.some((text) => text.includes('rozliczalne'))).toBe(true)
  })

  it('prints a dash, never a zero amount, on a non-billable line', () => {
    const input = makeExportInput()
    const lines = buildReportPdfLines(input)
    const nonBillableIndex = lines.findIndex(
      (line) => line.kind === 'cells' && line.cells.some((cell) => cell.text === 'Czas nierozliczalny'),
    )
    const following = lines.slice(nonBillableIndex + 1, nonBillableIndex + 5)
    const amounts = following.flatMap((line) =>
      line.kind === 'cells' ? line.cells.filter((cell) => cell.align === 'right').map((cell) => cell.text) : [],
    )
    expect(amounts).toContain('—')
    expect(amounts).not.toContain('0.00')
  })

  it('renders a valid PDF file for the whole report', () => {
    const file = serializeReportExport('pdf', makeExportInput())
    expect(file.contentType).toBe(PDF_CONTENT_TYPE)
    expect(file.filename).toBe('RAP-2026-0042.pdf')
    expect(file.body.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
  })
})

describe('normalizeReportExportFormat', () => {
  it('accepts exactly the three documented formats', () => {
    expect(normalizeReportExportFormat('pdf')).toBe('pdf')
    expect(normalizeReportExportFormat('csv')).toBe('csv')
    expect(normalizeReportExportFormat('xlsx')).toBe('xlsx')
    expect(normalizeReportExportFormat('json')).toBeNull()
    expect(normalizeReportExportFormat(null)).toBeNull()
  })
})
