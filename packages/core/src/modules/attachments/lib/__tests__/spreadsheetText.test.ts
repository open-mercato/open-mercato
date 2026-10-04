/** @jest-environment node */
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { SpreadsheetTextLimits } from '../spreadsheetText'
import { buildArchive, packageRelationships } from './xlsxArchive'
import type { ArchiveEntryInput } from './xlsxArchive'
import { buildWorkbook } from '../../__integration__/helpers/xlsxWorkbook'
import type { WorkbookOptions, WorkbookSheet } from '../../__integration__/helpers/xlsxWorkbook'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

const defaultLimits: SpreadsheetTextLimits = {
  maxUncompressedBytes: 5 * 1024 * 1024,
  maxSheets: 10,
  maxCells: 1_000_000,
  maxTextChars: 1_000_000,
}

async function writeWorkbook(name: string, sheets: WorkbookSheet[], options?: WorkbookOptions): Promise<string> {
  const filePath = join(tmpdir(), `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`)
  await fs.writeFile(filePath, await buildWorkbook(sheets, options))
  return filePath
}

function cellImageWorkbookEntries(): ArchiveEntryInput[] {
  const spreadsheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const relationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const officeRelationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  return [
    {
      name: '[Content_Types].xml',
      content:
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>',
    },
    packageRelationships('xl/workbook.xml'),
    {
      name: 'xl/workbook.xml',
      content: `<workbook xmlns="${spreadsheetNamespace}" xmlns:r="${officeRelationships}"><sheets><sheet name="Arkusz" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content:
        `<Relationships xmlns="${relationshipsNamespace}">` +
        `<Relationship Id="rId1" Type="${officeRelationships}/worksheet" Target="worksheets/sheet1.xml"/>` +
        '<Relationship Id="rId2" Type="http://www.wps.cn/officeDocument/2017/relationships/cellimage" Target="cellimages.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content: `<worksheet xmlns="${spreadsheetNamespace}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>tekst</t></is></c></row></sheetData></worksheet>`,
    },
    {
      name: 'xl/cellimages.xml',
      content: '<etc:cellImages xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData"/>',
    },
    {
      name: 'xl/_rels/cellimages.xml.rels',
      content: `<Relationships xmlns="${relationshipsNamespace}"><Relationship Id="rId1" Type="${officeRelationships}/image" Target="media/image1.png"/></Relationships>`,
    },
    { name: 'xl/media/image1.png', content: Buffer.alloc(0), compression: 'corrupt' },
  ]
}

async function extract(filePath: string, limits: Partial<SpreadsheetTextLimits> = {}): Promise<string | null> {
  const { extractSpreadsheetText } = await import('../spreadsheetText')
  return extractSpreadsheetText(filePath, { ...defaultLimits, ...limits })
}

describe('extractSpreadsheetText', () => {
  afterEach(async () => {
    mockReportError.mockReset()
    delete process.env.OM_ATTACHMENT_SPREADSHEET_MAX_CONCURRENCY
    delete process.env.OM_ATTACHMENT_SPREADSHEET_MAX_WAIT_QUEUE
    const { resetSpreadsheetConcurrencyStateForTests } = await import('../spreadsheetText')
    resetSpreadsheetConcurrencyStateForTests()
  })

  it('renders each sheet as a heading followed by tab-separated rows', async () => {
    const filePath = await writeWorkbook('offer.xlsx', [
      {
        name: 'Oferta',
        rows: [
          ['Indeks', 'Nazwa', 'Cena', 'Dostępny'],
          ['CEM-42', 'Cement 42,5R', 23.5, true],
          ['PRE-01', 'Pręt Ø12', 4, false],
        ],
      },
      { name: 'Uwagi', rows: [['Ceny netto']] },
    ])

    await expect(extract(filePath)).resolves.toBe(
      [
        '## Oferta',
        'Indeks\tNazwa\tCena\tDostępny',
        'CEM-42\tCement 42,5R\t23.5\tTRUE',
        'PRE-01\tPręt Ø12\t4\tFALSE',
        '## Uwagi',
        'Ceny netto',
      ].join('\n'),
    )
  })

  it('reads inline strings, dates and cached formula results', async () => {
    const filePath = await writeWorkbook(
      'inline.xlsx',
      [
        {
          name: 'Dane',
          rows: [
            ['Dostawa', new Date(Date.UTC(2026, 9, 1))],
            ['Odbiór', new Date(Date.UTC(2026, 9, 1, 14, 30))],
            ['Suma', { formula: 'SUM(B1:B2)', formulaResult: 42 }],
          ],
        },
      ],
      { inlineStrings: true },
    )

    await expect(extract(filePath)).resolves.toBe(
      ['## Dane', 'Dostawa\t2026-10-01', 'Odbiór\t2026-10-01 14:30:00', 'Suma\t42'].join('\n'),
    )
  })

  it('keeps inner empty cells, trims trailing ones and skips empty rows and sheets', async () => {
    const filePath = await writeWorkbook('sparse.xlsx', [
      { name: 'Pusty', rows: [] },
      {
        name: 'Lista',
        rows: [
          ['A', null, 'C', null, null],
          [null, null],
          ['  wiele\tbiałych\nznaków  '],
        ],
      },
    ])

    await expect(extract(filePath)).resolves.toBe(['## Lista', 'A\t\tC', 'wiele białych znaków'].join('\n'))
  })

  it('reads macro-enabled workbooks without touching the VBA project', async () => {
    const filePath = await writeWorkbook('macros.xlsm', [{ name: 'Makra', rows: [['wartość', 7]] }], {
      vbaProject: new Uint8Array([1, 2, 3, 4]),
    })

    await expect(extract(filePath)).resolves.toBe(['## Makra', 'wartość\t7'].join('\n'))
  })

  it('returns null for an empty workbook', async () => {
    const filePath = await writeWorkbook('empty.xlsx', [{ name: 'Arkusz1', rows: [] }])

    await expect(extract(filePath)).resolves.toBeNull()
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('returns null and reports the error for a corrupt file', async () => {
    const filePath = join(tmpdir(), `${Date.now()}-corrupt.xlsx`)
    await fs.writeFile(filePath, 'not a zip archive')

    await expect(extract(filePath)).resolves.toBeNull()
    expect(mockReportError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ module: 'attachments', code: 'attachments.spreadsheet_extraction_failed' }),
    )
  })

  it('returns null for a password-protected workbook and reports it as encrypted', async () => {
    const filePath = await writeWorkbook('protected.xlsx', [{ name: 'Tajne', rows: [['x']] }], { password: 'secret' })

    await expect(extract(filePath)).resolves.toBeNull()
    expect(mockReportError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ module: 'attachments', code: 'attachments.spreadsheet_encrypted' }),
    )
  })

  it('returns null when an archive entry decompresses past the cap', async () => {
    const rows = Array.from({ length: 200 }, (_, index) => [`wiersz ${index}`, index])
    const filePath = await writeWorkbook('large.xlsx', [{ name: 'Duży', rows }])

    await expect(extract(filePath, { maxUncompressedBytes: 1_024 })).resolves.toBeNull()
    expect(mockReportError).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'attachments.spreadsheet_entry_too_large' }),
    )
  })

  it('keeps text already read when a later sheet exceeds the decompression cap', async () => {
    const filePath = await writeWorkbook(
      'partial.xlsx',
      [
        { name: 'Mały', rows: [['a']] },
        { name: 'Duży', rows: Array.from({ length: 300 }, (_, index) => [index, index * 2, index * 3]) },
      ],
      { inlineStrings: true },
    )

    await expect(extract(filePath, { maxUncompressedBytes: 4_096 })).resolves.toBe(['## Mały', 'a'].join('\n'))
    expect(mockReportError).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'attachments.spreadsheet_entry_too_large' }),
    )
  })

  it('never decompresses parts beyond the workbook, its worksheets, shared strings and styles', async () => {
    const filePath = join(tmpdir(), `${Date.now()}-${Math.random().toString(36).slice(2)}-cell-images.xlsx`)
    await fs.writeFile(filePath, buildArchive(cellImageWorkbookEntries()))

    await expect(extract(filePath)).resolves.toBe(['## Arkusz', 'tekst'].join('\n'))
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('stops after the configured number of sheets', async () => {
    const filePath = await writeWorkbook('sheets.xlsx', [
      { name: 'Pierwszy', rows: [['1']] },
      { name: 'Drugi', rows: [['2']] },
      { name: 'Trzeci', rows: [['3']] },
    ])

    await expect(extract(filePath, { maxSheets: 2 })).resolves.toBe(['## Pierwszy', '1', '## Drugi', '2'].join('\n'))
  })

  it('stops at the scanned-cell cap, counting empty cells', async () => {
    const filePath = await writeWorkbook('cells.xlsx', [
      { name: 'Komórki', rows: [['a', null, 'b'], ['c', null, 'd'], ['e', null, 'f']] },
    ])

    await expect(extract(filePath, { maxCells: 7 })).resolves.toBe(['## Komórki', 'a\t\tb', 'c\t\td'].join('\n'))
  })

  it('stops at the text cap without splitting a row', async () => {
    const filePath = await writeWorkbook('text.xlsx', [
      { name: 'Tekst', rows: [['abcdefghij'], ['klmnopqrst'], ['uvwxyz']] },
    ])

    await expect(extract(filePath, { maxTextChars: 30 })).resolves.toBe(['## Tekst', 'abcdefghij', 'klmnopqrst'].join('\n'))
  })

  it('runs one extraction per slot and skips extraction when the wait queue is full', async () => {
    process.env.OM_ATTACHMENT_SPREADSHEET_MAX_CONCURRENCY = '1'
    process.env.OM_ATTACHMENT_SPREADSHEET_MAX_WAIT_QUEUE = '1'
    const filePath = await writeWorkbook('queue.xlsx', [{ name: 'Kolejka', rows: [['x']] }])
    const { extractSpreadsheetText } = await import('../spreadsheetText')

    const running = extractSpreadsheetText(filePath, defaultLimits)
    const waiting = extractSpreadsheetText(filePath, defaultLimits)
    const skipped = extractSpreadsheetText(filePath, defaultLimits)

    await expect(skipped).resolves.toBeNull()
    await expect(Promise.all([running, waiting])).resolves.toEqual(['## Kolejka\nx', '## Kolejka\nx'])
    await expect(extractSpreadsheetText(filePath, defaultLimits)).resolves.toBe('## Kolejka\nx')
  })

  it('bounds the text built from one shared string referenced by many cells', async () => {
    const longValue = 'x'.repeat(30_000)
    const rows = Array.from({ length: 200 }, () => [longValue])
    const filePath = await writeWorkbook('amplified.xlsx', [{ name: 'Powtórzenia', rows }])

    const result = await extract(filePath, { maxTextChars: 100_000 })

    expect(result?.split('\n')).toHaveLength(4)
    expect(result!.length).toBeLessThanOrEqual(100_000)
  })
})
