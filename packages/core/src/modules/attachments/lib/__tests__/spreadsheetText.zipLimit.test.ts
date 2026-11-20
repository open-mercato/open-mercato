/** @jest-environment node */
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { extractSpreadsheetText } from '../spreadsheetText'
import * as archiveHelpers from '../xlsxSheetNames'
import { buildArchive, packageRelationships } from './xlsxArchive'
import type { ArchiveEntryInput } from './xlsxArchive'
import { buildWorkbook } from '../../__integration__/helpers/xlsxWorkbook'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

const readSheetNames = jest.spyOn(archiveHelpers, 'readXlsxSheetNames')
const limits = { maxUncompressedBytes: 5 * 1024 * 1024, maxSheets: 10, maxCells: 1_000_000, maxTextChars: 1_000_000 }
let directory: string

function storedWorkbook(sharedText: string): ArchiveEntryInput[] {
  const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  return [
    { name: '[Content_Types].xml', content: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>' },
    packageRelationships('xl/workbook.xml'),
    { name: 'xl/workbook.xml', content: `<workbook xmlns:r="${relationships}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `<Relationships><Relationship Id="rId1" Type="${relationships}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relationships}/sharedStrings" Target="sharedStrings.xml"/></Relationships>` },
    { name: 'xl/worksheets/sheet1.xml', content: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>' },
    { name: 'xl/sharedStrings.xml', content: `<sst><si><t>safe</t></si><si><t>${sharedText}</t></si></sst>` },
  ]
}

async function extractArchive(archive: Buffer, maxUncompressedBytes = limits.maxUncompressedBytes): Promise<string | null> {
  const filePath = join(directory, 'workbook.xlsx')
  await fs.writeFile(filePath, archive)
  return extractSpreadsheetText(filePath, { ...limits, maxUncompressedBytes })
}

beforeAll(async () => { directory = await fs.mkdtemp(join(tmpdir(), 'spreadsheet-zip-cap-')) })
afterAll(async () => { await fs.rm(directory, { recursive: true, force: true }) })
afterEach(() => { jest.clearAllMocks() })

describe('spreadsheet archive byte budget', () => {
  it('skips a workbook with a 6 MiB stored shared-string part before starting the workbook parser', async () => {
    const archive = buildArchive(storedWorkbook('x'.repeat(6 * 1024 * 1024)))

    await expect(extractArchive(archive)).resolves.toBeNull()
    expect(readSheetNames).not.toHaveBeenCalled()
    expect(mockReportError).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ code: 'attachments.spreadsheet_entry_too_large' }),
    )
  })

  it.each(['stored', 'deflate'] as const)('extracts a valid %s workbook within the budget', async (compression) => {
    const entries = storedWorkbook('unused').map(entry => ({ ...entry, compression }))

    await expect(extractArchive(buildArchive(entries))).resolves.toBe('## Data\nsafe')
    expect(readSheetNames).toHaveBeenCalledTimes(1)
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it.each(['stored', 'deflate'] as const)('rejects aggregate %s parts before the workbook parser even when each part fits', async (compression) => {
    const entries = storedWorkbook('x'.repeat(2500)).map(entry => ({ ...entry, compression }))
    const total = entries.reduce((bytes, entry) => bytes + Buffer.byteLength(entry.content), 0)
    expect(entries.every(entry => Buffer.byteLength(entry.content) < total - 1)).toBe(true)

    await expect(extractArchive(buildArchive(entries), total - 1)).resolves.toBeNull()
    expect(readSheetNames).not.toHaveBeenCalled()
    expect(mockReportError).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ code: 'attachments.spreadsheet_entry_too_large' }),
    )
  })

  it('preserves real workbook extraction including dates, booleans and cached formulas', async () => {
    const archive = await buildWorkbook([
      { name: 'Values', rows: [['safe', 42, true, new Date('2026-01-01T00:00:00Z'), { formula: '1+1', formulaResult: 2 }]] },
    ])

    await expect(extractArchive(archive)).resolves.toBe('## Values\nsafe\t42\tTRUE\t2026-01-01\t2')
    expect(mockReportError).not.toHaveBeenCalled()
  })
})
