import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/**
 * `configs` is a kernel module, so everything its upgrade-action catalog pulls into the
 * TypeScript program must compile when the optional modules owning those actions are
 * disabled (#9568). A disabled module disappears from the app's generated entity id
 * registry (`#generated/entities.ids.generated`), so any file reached from the catalog that
 * reads `E.<module>` fails typechecking with TS2339 — even behind a lazy `import()`, which
 * the compiler still follows. Lazy-imported helpers must therefore stay registry-free.
 */

const coreSrcRoot = resolve(__dirname, '..', '..', '..', '..')
const entryFile = resolve(__dirname, '..', 'upgrade-actions.ts')
const GENERATED_ENTITY_IDS = '#generated/entities.ids.generated'
const CORE_PREFIX = '@open-mercato/core/'
const IMPORT_SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g

function resolveSourceFile(basePath: string): string | null {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    join(basePath, 'index.ts'),
    join(basePath, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('.')) return resolveSourceFile(resolve(dirname(fromFile), specifier))
  if (specifier.startsWith(CORE_PREFIX)) {
    return resolveSourceFile(join(coreSrcRoot, specifier.slice(CORE_PREFIX.length)))
  }
  return null
}

function collectReachableCoreFiles(entry: string): Map<string, string[]> {
  const reachable = new Map<string, string[]>()
  const queue = [entry]
  while (queue.length) {
    const file = queue.shift() as string
    if (reachable.has(file)) continue
    const specifiers = Array.from(readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER), (match) => match[1])
    reachable.set(file, specifiers)
    for (const specifier of specifiers) {
      const target = resolveSpecifier(file, specifier)
      if (target && !reachable.has(target)) queue.push(target)
    }
  }
  return reachable
}

describe('configs upgrade-action catalog optional-module compile boundary', () => {
  const reachable = collectReachableCoreFiles(entryFile)

  it('follows the lazy imports of cross-module actions', () => {
    const reachedModules = new Set(
      Array.from(reachable.keys(), (file) => relative(join(coreSrcRoot, 'modules'), file).split('/')[0]),
    )
    expect(reachedModules.has('customers')).toBe(true)
    expect(reachedModules.has('attachments')).toBe(true)
  })

  it('does not reach the generated entity id registry from another module', () => {
    const offenders = Array.from(reachable.entries())
      .filter(([, specifiers]) => specifiers.includes(GENERATED_ENTITY_IDS))
      .map(([file]) => relative(coreSrcRoot, file))
    expect(offenders).toEqual([])
  })

  it('does not reach the customers CLI', () => {
    const customersCli = join(coreSrcRoot, 'modules', 'customers', 'cli.ts')
    expect(reachable.has(customersCli)).toBe(false)
  })
})
