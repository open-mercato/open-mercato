import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A module reading `E.<other>.<entity>` must declare `<other>` in `requires`.
 *
 * `E` is the generated entity-id registry, and it only has a key for a module that is ENABLED. So
 * `E.catalog.catalog_product` is `undefined.catalog_product` wherever `catalog` is switched off — and when the
 * read sits at module scope, inside an object literal evaluated on import, it throws while a registry is being
 * assembled rather than inside a request somebody can trace.
 *
 * `eudr` did exactly that: `data/enrichers.ts` declared `targetEntity: E.catalog.catalog_product` with no
 * `requires`, so an installation without `catalog` could not reach its own LOGIN screen, and the error read
 * `Cannot read properties of undefined (reading 'catalog_product')` — a property name, with nothing to connect
 * it to a module choice.
 *
 * Open Mercato is an ERP or a CRM depending on which modules are installed, so "this module cannot run without
 * that one" is a first-class fact about a module and belongs in its manifest. Nothing checked it until now,
 * which is why a one-line omission cost a whole installation shape.
 *
 * Two ways to satisfy this, and both are in use:
 *  - declare the owner in `requires`, which makes `yarn generate` refuse the combination up front;
 *  - read through optional chaining (`E.catalog?.catalog_product`) and handle its absence, which is what
 *    `attachments/lib/assignmentDetails.ts` does one directory away from the module that did not.
 */
const MODULES_ROOT = join(__dirname, '..', 'modules')

/** `E.<module>.` where the module is not the one doing the reading. */
const ENTITY_READ = /\bE\.([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)/g
/** The same read, but written defensively — the other acceptable answer. */
const GUARDED_READ = /\bE\.([a-z][a-z0-9_]*)\?\./g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (entry === '__tests__' || entry === '__integration__' || entry === 'seed') return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return entry.endsWith('.ts') || entry.endsWith('.tsx') ? [path] : []
  })
}

function declaredRequires(moduleDir: string): Set<string> {
  const indexPath = join(MODULES_ROOT, moduleDir, 'index.ts')
  let source = ''
  try {
    source = readFileSync(indexPath, 'utf8')
  } catch {
    return new Set()
  }
  const match = /requires:\s*\[([^\]]*)\]/.exec(source)
  if (!match) return new Set()
  return new Set([...match[1].matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1]))
}

const moduleDirs = readdirSync(MODULES_ROOT).filter((entry) =>
  statSync(join(MODULES_ROOT, entry)).isDirectory(),
)

describe('cross-module entity-id reads', () => {
  it('finds the modules it is meant to be checking', () => {
    // A restructure that empties this would turn the rule into a silent pass.
    expect(moduleDirs.length).toBeGreaterThan(10)
  })

  const offenders: string[] = []

  for (const moduleDir of moduleDirs) {
    const requires = declaredRequires(moduleDir)
    for (const path of sourceFiles(join(MODULES_ROOT, moduleDir))) {
      const source = readFileSync(path, 'utf8')
      const guarded = new Set([...source.matchAll(GUARDED_READ)].map((entry) => entry[1]))
      for (const match of source.matchAll(ENTITY_READ)) {
        const owner = match[1]
        if (owner === moduleDir) continue
        // Not every `E.x.y` is a module: the registry is keyed by module id, and a key that is not a sibling
        // directory is something else entirely.
        if (!moduleDirs.includes(owner)) continue
        if (requires.has(owner) || guarded.has(owner)) continue
        offenders.push(`${moduleDir} reads E.${owner}.${match[2]} in ${path.slice(path.indexOf('/modules/'))}`)
      }
    }
  }

  it('each declares the module it reads, or reads it defensively', () => {
    // Named rather than counted: the failure has to say which module reads which, and where.
    expect([...new Set(offenders)]).toEqual([])
  })

  it('still recognises an undeclared read, so the rule cannot pass by having stopped matching', () => {
    /**
     * The positive control, against a fixture rather than real source: the rule's own correctness must not
     * depend on some module out there continuing to break it.
     */
    const bad = 'const spec = { targetEntity: E.catalog.catalog_product }'
    const good = 'if (E.catalog?.catalog_product) use(E.catalog.catalog_product)'
    expect([...bad.matchAll(ENTITY_READ)].map((entry) => entry[1])).toEqual(['catalog'])
    expect([...good.matchAll(GUARDED_READ)].map((entry) => entry[1])).toEqual(['catalog'])
  })
})
