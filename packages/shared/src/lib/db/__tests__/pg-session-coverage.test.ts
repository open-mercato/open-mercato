import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Every runtime Postgres connection opened with raw `pg` MUST spread `getPgSessionConfig()`, or it
 * silently keeps the server's default `TimeZone` while the ORM pool uses `OM_DB_DEFAULT_TIMEZONE`,
 * and its `date_trunc` / `CURRENT_DATE` results disagree with the rest of the app.
 *
 * Scope: package `src/` trees, excluding tests, Playwright helpers (`__integration__`) and one-off
 * migration scripts, none of which serve application traffic.
 */
const repoRoot = join(__dirname, '..', '..', '..', '..', '..', '..')
const packagesRoot = join(repoRoot, 'packages')
const SOURCE_FILE = /\.(ts|tsx|mts|mjs|js)$/
const EXCLUDED_SEGMENTS = new Set(['__tests__', '__integration__', 'migrations', 'node_modules', 'dist', 'template'])
const IMPORTS_PG = /from\s+['"]pg['"]|import\(\s*['"]pg['"]\s*\)|require\(\s*['"]pg['"]\s*\)/
const CONNECTION = /new\s+(?:pg\.)?(Pool|Client)\s*\(/g

function listSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const name of readdirSync(dir)) {
    if (EXCLUDED_SEGMENTS.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files.push(...listSourceFiles(path))
    else if (SOURCE_FILE.test(name) && !/\.(test|spec)\./.test(name)) files.push(path)
  }
  return files
}

function constructorArguments(source: string, openParenIndex: number): string {
  let depth = 0
  for (let index = openParenIndex; index < source.length; index += 1) {
    const char = source[index]
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return source.slice(openParenIndex + 1, index)
    }
  }
  return source.slice(openParenIndex + 1)
}

function findUnscopedPgConnections(source: string): number[] {
  if (!IMPORTS_PG.test(source)) return []
  const lines: number[] = []
  for (const match of source.matchAll(CONNECTION)) {
    const openParen = (match.index ?? 0) + match[0].length - 1
    if (!constructorArguments(source, openParen).includes('getPgSessionConfig(')) {
      lines.push(source.slice(0, match.index).split('\n').length)
    }
  }
  return lines
}

describe('raw pg connections carry the Postgres session time zone', () => {
  it('detects a connection without the session config and accepts one with it', () => {
    const bare = "import { Pool } from 'pg'\nconst pool = new Pool({ connectionString: url })\n"
    const scoped = "import { Client } from 'pg'\nconst client = new Client({\n  connectionString: url,\n  ...getPgSessionConfig(env),\n})\n"
    const unrelated = "import { Client } from '@modelcontextprotocol/sdk/client'\nconst client = new Client({ name: 'x' })\n"
    expect(findUnscopedPgConnections(bare)).toEqual([2])
    expect(findUnscopedPgConnections(scoped)).toEqual([])
    expect(findUnscopedPgConnections(unrelated)).toEqual([])
  })

  it('finds no runtime connection without getPgSessionConfig()', () => {
    const packageSources = readdirSync(packagesRoot)
      .map((name) => join(packagesRoot, name, 'src'))
      .filter((path) => {
        try {
          return statSync(path).isDirectory()
        } catch {
          return false
        }
      })
    const files = packageSources.flatMap(listSourceFiles)
    const violations = files.flatMap((file) =>
      findUnscopedPgConnections(readFileSync(file, 'utf8')).map((line) => `${relative(repoRoot, file).split(sep).join('/')}:${line}`),
    )
    expect(files.length).toBeGreaterThan(100)
    expect(violations).toEqual([])
  })
})
