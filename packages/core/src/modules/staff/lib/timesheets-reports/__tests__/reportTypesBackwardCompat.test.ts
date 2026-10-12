/** @jest-environment node */
import * as path from 'node:path'
import * as ts from 'typescript'
import { buildReportPdfLines, buildReportTable, type ReportExportInput } from '../reportExport'
import { computeReportTotals, sumResolvedAmounts } from '../reportTotals'
import { legacyExportInput, legacyResolved, toPublicTotals } from './__fixtures__/legacyReportShapes'

const FIXTURE = path.join(__dirname, '__fixtures__', 'legacyReportShapes.ts')

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  esModuleInterop: true,
}

function fixtureDiagnostics(): string[] {
  const program = ts.createProgram([FIXTURE], COMPILER_OPTIONS)
  const source = program.getSourceFile(FIXTURE)
  if (!source) throw new Error('[internal] fixture not found')
  return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)].map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
  )
}

function pdfTexts(input: ReportExportInput): string[] {
  return buildReportPdfLines(input).flatMap((line) => (line.kind === 'cells' ? line.cells.map((cell) => cell.text) : []))
}

describe('report types stay backward compatible (spec D7: exact siblings are optional)', () => {
  it('compiles float-only ReportLine, ReportGroup, ReportTotals, ResolvedEntryValues and ReportRow objects', () => {
    expect(fixtureDiagnostics()).toEqual([])
  }, 60000)

  it('prints the float values of float-only line, group and totals shapes', () => {
    const texts = pdfTexts(legacyExportInput())
    expect(texts).toContain('180.75 EUR')
    expect(texts).toContain('120.50 EUR/h')
    expect(texts).toContain('120.50')
    expect(texts).toContain('60.25')
  })

  it('falls back to the float rate and amount for a float-only export row', () => {
    const table = buildReportTable(legacyExportInput())
    expect(table.rows[0]).toEqual(expect.objectContaining({ amount: '120.50', rate: '120.50' }))
  })

  it('sums float-only resolved entry values', () => {
    expect(sumResolvedAmounts(legacyResolved, 2)).toBe('180.75')
  })

  it('still fills the exact siblings on computed totals', () => {
    const totals = toPublicTotals(
      computeReportTotals({
        entries: [],
        projects: [],
        directory: { taskLabelById: {}, personLabelById: {} },
        options: { grouping: 'project_task', nonbillableMode: 'separate', includeAlreadyReported: false },
        labels: { unassignedTask: 'No task', unassignedPerson: 'No person', nonbillableGroup: 'Non-billable' },
      }),
    )
    expect(totals.totalAmountExact).toBe('0')
  })
})
