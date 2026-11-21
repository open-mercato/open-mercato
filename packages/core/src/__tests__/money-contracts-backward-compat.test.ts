/** @jest-environment node */
import * as path from 'node:path'
import * as ts from 'typescript'
import {
  legacyAdjustmentRow,
  legacyAdjustmentTotal,
  legacyCatalogAmount,
  legacyExchangeRatePayload,
  legacyValidatedRate,
} from './__fixtures__/legacyMoneyContracts'

const FIXTURE = path.join(__dirname, '__fixtures__', 'legacyMoneyContracts.ts')
const TSCONFIG = path.join(__dirname, '..', '..', 'tsconfig.json')

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

const translate = (key: string) => key
const formValues = {
  fromCurrencyCode: 'EUR',
  toCurrencyCode: 'USD',
  rate: '1.25',
  date: '2026-10-29T00:00:00.000Z',
  source: 'Manual',
  isActive: true,
}

describe('money contracts stay backward compatible (spec D7)', () => {
  it('compiles the pre-exact numeric helper, payload, callback and construction shapes', () => {
    expect(fixtureDiagnostics()).toEqual([])
  }, 120000)

  it('returns numbers from the legacy exchange-rate and catalog-price helpers', () => {
    expect(legacyValidatedRate(formValues, translate)).toBe(1.25)
    expect(legacyCatalogAmount).toBe(10)
  })

  it('builds a payload from the legacy numeric validated shape without touching metadata', () => {
    const payload = legacyExchangeRatePayload(formValues)
    expect(payload.rate).toBe('1.25')
    expect(payload).not.toHaveProperty('metadata')
  })

  it('keeps adjustment amounts numeric for callbacks doing arithmetic', async () => {
    await expect(
      legacyAdjustmentTotal({ label: null, code: null, kind: 'discount', calculatorKey: null, currencyCode: 'USD', amountNet: 5, amountGross: 6.15 }),
    ).resolves.toBeCloseTo(11.15)
    expect(legacyAdjustmentRow.amountNet).toBe(5)
  })
})
