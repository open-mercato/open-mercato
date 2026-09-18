import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/**
 * CLI module registry boundary guard.
 *
 * `registerCliModules` / `getCliModules` / `hasCliModules` back a registry that
 * is populated by exactly one thing: the `mercato` bin (`packages/cli/src/bin.ts`
 * and two `mercato.ts` commands). `getCliModules()` fails OPEN - it returns `[]`
 * when nothing registered - so runtime code that reads it outside a CLI process
 * gets an empty list and silently does nothing.
 *
 * That is not hypothetical. The events worker used to build its subscriber map
 * from `getCliModules()`. A worker started any way other than through the bin
 * dispatched zero subscribers and marked the queue job COMPLETED with no error
 * and no log, dropping outbound webhooks, workflow event triggers and
 * business-rule triggers. It now resolves the DI `eventBus` instead, which every
 * bootstrapped process populates from the app registry (`registerModules`).
 *
 * Runtime (non-CLI) code MUST therefore use the app registry (`getModules`) or a
 * DI-resolved service. Only CLI entrypoints may touch this one:
 * - anything under `packages/cli/`
 * - a module's own `cli.ts` command file
 * - `registry.ts` itself, which defines the functions
 */

const REPO_ROOT = resolve(__dirname, '../../../../..')
const SCAN_ROOTS = ['packages', 'apps']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.mercato', 'build', 'coverage', '.turbo'])
const SOURCE_EXTENSIONS = ['.ts', '.tsx']

const CLI_REGISTRY_CALL = /\b(getCliModules|hasCliModules|registerCliModules)\s*\(/

// Comments legitimately name these functions when documenting why runtime code
// must NOT use them, so match against code only. Approximate stripping is fine:
// the output is only fed to a regex, never parsed.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function isAllowedCliEntrypoint(repoRelativePath: string): boolean {
  const segments = repoRelativePath.split(sep)
  // The CLI package owns the registry's lifecycle.
  if (repoRelativePath.startsWith(join('packages', 'cli') + sep)) {
    return true
  }
  // A module's own CLI command file runs inside a bootstrapped `mercato` process.
  if (segments[segments.length - 1] === 'cli.ts') {
    return true
  }
  // The definitions themselves.
  if (repoRelativePath === join('packages', 'shared', 'src', 'modules', 'registry.ts')) {
    return true
  }
  return false
}

function isTestFile(repoRelativePath: string): boolean {
  return repoRelativePath.includes(`${sep}__tests__${sep}`)
    || repoRelativePath.endsWith('.test.ts')
    || repoRelativePath.endsWith('.test.tsx')
}

function collectSourceFiles(dir: string, found: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return found
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) {
      continue
    }
    const absolute = join(dir, entry)
    let stats
    try {
      stats = statSync(absolute)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      collectSourceFiles(absolute, found)
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      found.push(absolute)
    }
  }
  return found
}

describe('CLI module registry boundary', () => {
  const sourceFiles = SCAN_ROOTS.flatMap((root) => collectSourceFiles(join(REPO_ROOT, root)))

  it('scans a meaningful number of source files', () => {
    // Guards against a broken walk silently passing the assertion below.
    expect(sourceFiles.length).toBeGreaterThan(500)
  })

  it('is only read from CLI entrypoints, never from runtime code', () => {
    const offenders = sourceFiles
      .map((absolute) => ({ absolute, repoRelative: relative(REPO_ROOT, absolute) }))
      .filter(({ repoRelative }) => !isAllowedCliEntrypoint(repoRelative) && !isTestFile(repoRelative))
      .filter(({ absolute }) => CLI_REGISTRY_CALL.test(stripComments(readFileSync(absolute, 'utf8'))))
      .map(({ repoRelative }) => repoRelative)

    expect(offenders).toEqual([])
  })
})
