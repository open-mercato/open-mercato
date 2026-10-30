import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const moduleRoot = join(__dirname, '..')
const modulesRoot = join(moduleRoot, '..')
const coreAlias = '@open-mercato/core/modules/'
const nextRuntimeSpecifiers = new Set(['next/server', 'next/headers'])
const valueImportPattern = /^import\s+(?!type\s)[^;]*?from\s+'([^']+)'/gm

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string | null = null
  if (specifier.startsWith('.')) base = normalize(join(dirname(fromFile), specifier))
  else if (specifier.startsWith(coreAlias)) base = join(modulesRoot, specifier.slice(coreAlias.length))
  if (!base) return null
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function findNextRuntimeImports(entry: string): string[] {
  const visited = new Set<string>()
  const offenders = new Set<string>()
  const pending = [entry]
  while (pending.length > 0) {
    const file = pending.pop() as string
    if (visited.has(file)) continue
    visited.add(file)
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(valueImportPattern)) {
      const specifier = match[1]
      if (nextRuntimeSpecifiers.has(specifier)) offenders.add(file.slice(modulesRoot.length + 1))
      const resolved = resolveSpecifier(file, specifier)
      if (resolved) pending.push(resolved)
    }
  }
  return [...offenders].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

const subscriberDir = join(moduleRoot, 'subscribers')
const entries = [
  join(moduleRoot, 'di.ts'),
  join(moduleRoot, 'search.ts'),
  ...readdirSync(subscriberDir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join(subscriberDir, file)),
]

describe('ecommerce non-request entry points', () => {
  it.each(entries.map((entry) => [entry.slice(moduleRoot.length + 1), entry]))(
    '%s never statically imports next/server or next/headers',
    (_label, entry) => {
      expect(findNextRuntimeImports(entry)).toEqual([])
    },
  )
})
