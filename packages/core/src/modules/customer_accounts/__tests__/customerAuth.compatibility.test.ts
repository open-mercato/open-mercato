import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

it('accepts the previously supported successful user-validation result', () => {
  const sourcePath = path.join(__dirname, '../lib/customerAuth.ts')
  const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true)
  const resultType = source.statements.find((statement): statement is ts.TypeAliasDeclaration =>
    ts.isTypeAliasDeclaration(statement) && statement.name.text === 'UserValidationResult',
  )
  expect(resultType).toBeDefined()
  if (!resultType) return

  const consumerPath = '/legacy-consumer.ts'
  const consumer = ts.createSourceFile(consumerPath, `
    interface Array<T> { length: number }
    ${resultType.getText(source)}
    const legacyResult: UserValidationResult = {
      valid: true,
      resolvedFeatures: [],
      isPortalAdmin: false,
    }
  `, ts.ScriptTarget.Latest, true)
  const options: ts.CompilerOptions = { strict: true, noLib: true, types: [] }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = (fileName) => fileName === consumerPath ? consumer : undefined
  const program = ts.createProgram([consumerPath], options, host)

  expect(program.getSemanticDiagnostics(consumer).map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  )).toEqual([])
})
