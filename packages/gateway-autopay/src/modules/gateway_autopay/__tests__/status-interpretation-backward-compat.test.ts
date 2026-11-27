/** @jest-environment node */
import * as path from 'node:path'
import * as ts from 'typescript'
import { legacyStatusInterpretation } from './__fixtures__/legacyStatusInterpretation'

const FIXTURE = path.join(__dirname, '__fixtures__', 'legacyStatusInterpretation.ts')
const TSCONFIG = path.join(__dirname, '..', '..', '..', '..', 'tsconfig.json')

function fixtureDiagnostics(): string[] {
  const config = ts.readConfigFile(TSCONFIG, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(TSCONFIG))
  const program = ts.createProgram([FIXTURE], { ...parsed.options, noEmit: true })
  const source = program.getSourceFile(FIXTURE)
  if (!source) throw new Error('[internal] fixture not found')
  return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)].map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
  )
}

describe('AutopayStatusInterpretation stays backward compatible (spec D7)', () => {
  it('compiles the pre-exact construction shape without the exact siblings', () => {
    expect(fixtureDiagnostics()).toEqual([])
  }, 120000)

  it('keeps the legacy numeric amounts', () => {
    expect(legacyStatusInterpretation.amount).toBe(10)
    expect(legacyStatusInterpretation).not.toHaveProperty('amountExact')
  })
})
