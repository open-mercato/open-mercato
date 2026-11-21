/** @jest-environment node */
import * as path from 'node:path'
import * as ts from 'typescript'
import { legacyPricingFormatter, legacySubmittedAmountPlusFee } from './__fixtures__/legacyPayPageContracts'

const FIXTURE = path.join(__dirname, '__fixtures__', 'legacyPayPageContracts.ts')
const TSCONFIG = path.join(__dirname, '..', '..', '..', '..', '..', 'tsconfig.json')

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

describe('checkout amount contracts stay backward compatible (spec D7)', () => {
  it('compiles the numeric toSubmittedAmount return and number-only amount formatters', () => {
    expect(fixtureDiagnostics()).toEqual([])
  }, 120000)

  it('returns a number from toSubmittedAmount', () => {
    expect(legacySubmittedAmountPlusFee('110,70', 'pl-PL')).toBeCloseTo(111.7)
  })

  it('accepts a formatter that only understands numbers', () => {
    expect(legacyPricingFormatter(12.5, 'USD')).toBe('USD 12.50')
  })
})
