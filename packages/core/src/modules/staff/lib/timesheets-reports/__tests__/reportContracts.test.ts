import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

it('compiles legacy number-only values against the report contracts', () => {
  const contractPath = join(__dirname, '../reportTotals.ts')
  const source = ts.createSourceFile(contractPath, readFileSync(contractPath, 'utf8'), ts.ScriptTarget.Latest, true)
  const contractNames = new Set(['ResolvedEntryValues', 'ReportLine', 'ReportGroup', 'ReportTotals', 'AlreadyReportedSource'])
  const declarations = source.statements
    .filter((statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && contractNames.has(statement.name.text))
    .map((statement) => statement.getText(source))
    .join('\n')
  const fixture = `${declarations}
    const entry: ResolvedEntryValues = { entryId: 'entry', minutes: 60, rawMinutes: 60, rate: 12.5, amount: 12.5, isBillable: true, hasOverride: false, isFrozen: false }
    const line: ReportLine = { key: 'task', label: 'Task', minutes: 60, rate: 12.5, amount: 12.5, entryCount: 1, hasOverride: false, children: [] }
    const group: ReportGroup = { key: 'project', kind: 'project', label: 'Project', rate: 12.5, minutes: 60, amount: 12.5, entryCount: 1, lines: [line] }
    const totals: ReportTotals = { groups: [group], billableMinutes: 60, nonbillableMinutes: 0, entryCount: 1, totalAmount: 12.5, alreadyReportedCount: 0, alreadyReportedMinutes: 0, alreadyReportedIn: [] }
  `
  const fixturePath = join(__dirname, 'legacy-report-contracts.ts')
  const options: ts.CompilerOptions = { strict: true, noEmit: true, types: [], skipLibCheck: true }
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => fileName === fixturePath
    ? ts.createSourceFile(fileName, fixture, languageVersion, true)
    : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram([fixturePath], options, host)
  const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  expect(diagnostics).toEqual([])
})
