import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const PACKAGE_ROOT = join(__dirname, '..', '..', '..', '..')
const SUBPATH = './lib/db/duplicateEntityClassNames'

type ExportTarget = { types?: string | string[]; default?: string }

function readExports(): Record<string, ExportTarget | string> {
  const packageJson = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
    exports?: Record<string, ExportTarget | string>
  }
  return packageJson.exports ?? {}
}

/**
 * Node's subpath resolution: an exact key wins outright, and only when none matches do
 * the `*` patterns compete on the longest static prefix. `@open-mercato/cli` imports this
 * subpath across a workspace boundary, and resolvers do not agree on wildcard handling,
 * so it must not depend on one.
 */
function resolveSubpath(exports: Record<string, ExportTarget | string>, subpath: string): string | null {
  if (Object.prototype.hasOwnProperty.call(exports, subpath)) return subpath
  let best: string | null = null
  for (const key of Object.keys(exports)) {
    const star = key.indexOf('*')
    if (star < 0) continue
    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue
    if (subpath.length < prefix.length + suffix.length) continue
    if (!best || prefix.length > best.slice(0, best.indexOf('*')).length) best = key
  }
  return best
}

describe('@open-mercato/shared duplicateEntityClassNames export map', () => {
  const exports = readExports()

  it('resolves through an explicit entry rather than a wildcard pattern', () => {
    expect(resolveSubpath(exports, SUBPATH)).toBe(SUBPATH)
  })

  it('maps types to the source module and default to the built module', () => {
    expect(exports[SUBPATH]).toEqual({
      types: './src/lib/db/duplicateEntityClassNames.ts',
      default: './dist/lib/db/duplicateEntityClassNames.js',
    })
  })

  // Both halves of the mapping must exist in a packed package. `default` is produced by
  // `yarn build:packages`, which the validation gate runs before `yarn test`.
  it('ships both mapped files', () => {
    const target = exports[SUBPATH] as ExportTarget
    expect(existsSync(join(PACKAGE_ROOT, target.types as string))).toBe(true)
    expect(existsSync(join(PACKAGE_ROOT, target.default as string))).toBe(true)
  })

  it('keeps the module importable under the mapped default condition', async () => {
    const target = exports[SUBPATH] as ExportTarget
    await expect(import(join(PACKAGE_ROOT, target.default as string))).resolves.toBeDefined()
  })
})
