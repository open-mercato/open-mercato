/**
 * Awilix resolves CLASSIC-mode dependencies by parsing PARAMETER NAMES out of the
 * function source (`packages/shared/src/lib/di/container.ts` creates the container
 * with `InjectionMode.CLASSIC`). Any bundler that renames identifiers therefore
 * breaks resolution: Turbopack renamed `em` to `em2` in a dev chunk and Awilix
 * looked up a registration that does not exist.
 *
 * That failure is silent where it matters most. `resolveCrudMutationGuardService`
 * catches the AwilixResolutionError and returns null, `bridgeLegacyGuard` returns
 * null in turn, and the mutation proceeds with optimistic locking — and the
 * enterprise record-lock 409 layered on top of it — NOT enforced. The write still
 * answers 201, so nothing surfaces except a warning line.
 *
 * `.proxy()` makes a registration read its dependencies as PROPERTIES of the
 * cradle (`cradle.em`), and property names survive mangling. This guard pins that
 * every `asFunction` registration which takes an argument opts into it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '../../../../../..')
const scanRoots = ['packages', 'apps'].map((dir) => path.join(repoRoot, dir))

function collectDiFiles(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next' || entry === '.mercato') continue
    const full = path.join(dir, entry)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      collectDiFiles(full, out)
    } else if (entry === 'di.ts' || entry === 'container.ts') {
      out.push(full)
    }
  }
}

const diFiles: string[] = []
for (const root of scanRoots) collectDiFiles(root, diFiles)

const toRepoRelative = (file: string) => path.relative(repoRoot, file)

/**
 * Does this `asFunction(...)` body declare a parameter?
 *
 * Only INLINE function expressions can be judged statically — an arrow or a
 * `function` expression written at the registration. A bare reference
 * (`asFunction(createThing)`) is deliberately skipped: its signature lives in
 * another module, and guessing would produce exactly the false positive this
 * comment replaced.
 */
function declaresParameter(chunk: string): boolean {
  const body = chunk.replace(/^\s*/, '')
  if (body.startsWith('(')) {
    return !/^\(\s*\)/.test(body)
  }
  const fn = body.match(/^(?:async\s+)?function\s*[A-Za-z0-9_$]*\s*\(([^)]*)\)/)
  if (fn) return fn[1].trim().length > 0
  return false
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

describe('Awilix registrations survive identifier mangling', () => {
  it('scans the whole workspace, not a truncated slice of it', () => {
    // A floor, because the readdir above swallows its errors: without one, a scan
    // that collapsed to nothing would report green and the guard would pass vacuously.
    expect(diFiles.length).toBeGreaterThan(20)
  })

  it('has no argument-taking asFunction registration that skips .proxy()', () => {
    const offenders: string[] = []

    for (const file of diFiles) {
      const source = stripComments(readFileSync(file, 'utf8'))
      // Split on the registration boundary so each `asFunction(...)` is checked
      // against the `.proxy()` that belongs to it, not one later in the file.
      const chunks = source.split(/asFunction\(/).slice(1)
      for (const chunk of chunks) {
        if (!declaresParameter(chunk)) continue
        // Chunks are split at each `asFunction(`, so the only `.proxy()` a chunk
        // can contain is the one chained onto its own registration.
        if (!/\.proxy\(\)/.test(chunk)) {
          offenders.push(toRepoRelative(file))
        }
      }
    }

    expect(Array.from(new Set(offenders))).toEqual([])
  })
})
