import { execFileSync } from 'node:child_process'
import path from 'node:path'

const PACKAGE_ROOT = path.resolve(__dirname, '../../../..')

const PROBE = path.join(__dirname, 'fixtures', 'resolve-export.mjs')

function resolveFromPackage(specifier: string): string {
  return execFileSync(process.execPath, [PROBE, specifier], { cwd: PACKAGE_ROOT, encoding: 'utf8' }).trim()
}

describe('@open-mercato/shared/lib/money package exports', () => {
  it.each(['@open-mercato/shared/lib/money/internal', '@open-mercato/shared/lib/money/internal.ts'])(
    'blocks the private %s subpath',
    (specifier) => {
      expect(resolveFromPackage(specifier)).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED')
    },
  )

  it.each(['@open-mercato/shared/lib/money', '@open-mercato/shared/lib/money/money.ts', '@open-mercato/shared/lib/db/moneyColumns'])(
    'keeps the public %s import path',
    (specifier) => {
      expect(resolveFromPackage(specifier)).toBe('resolved')
    },
  )
})
