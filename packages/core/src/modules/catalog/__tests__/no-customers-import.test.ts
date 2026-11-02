import fs from 'node:fs'
import path from 'node:path'

/**
 * Catalog must not import code from the customers module.
 *
 * The regression this pins (#6691): the price-kind currency selector imported
 * `customers/components/detail/hooks/useCurrencyDictionary` and read
 * `/api/customers/dictionaries/currency`, so a catalog settings screen depended
 * on the CRM for what is a currencies concern. Currency options now come from
 * the `currencies` module's `/api/currencies/currencies/options` contract.
 */

const MODULE_ROOT = path.resolve(__dirname, '..')
const FORBIDDEN = /@open-mercato\/core\/modules\/customers\/|['"](\.\.\/)+customers\//

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'migrations') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc)
      continue
    }
    if (/\.tsx?$/.test(entry.name)) acc.push(full)
  }
  return acc
}

describe('catalog does not import the customers module', () => {
  it('imports nothing from the customers module', () => {
    const offenders = collectSourceFiles(MODULE_ROOT)
      .filter((file) => FORBIDDEN.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(MODULE_ROOT, file))

    expect(offenders).toEqual([])
  })

  it('reads price-kind currency options from the currencies module', () => {
    const source = fs.readFileSync(path.join(MODULE_ROOT, 'lib', 'currencyOptions.ts'), 'utf8')
    expect(source).toContain('CURRENCY_OPTIONS_URL')
    expect(source).not.toContain('/api/customers/')
  })
})
