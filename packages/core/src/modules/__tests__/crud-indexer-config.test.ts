import * as fs from 'fs'
import * as path from 'path'

type CrudCall = {
  start: number
  body: string
}

const repoRoot = path.resolve(__dirname, '../../../../..')
const scanRoots = ['packages', 'apps'].map((segment) => path.join(repoRoot, segment))
const ignoredDirs = new Set([
  '.git',
  '.next',
  '.turbo',
  '.mercato',
  'coverage',
  'dist',
  'generated',
  'node_modules',
])

function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        files.push(...listSourceFiles(fullPath))
      }
      continue
    }
    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(fullPath)
    }
  }

  return files
}

function findMakeCrudRouteCalls(source: string): CrudCall[] {
  const calls: CrudCall[] = []
  let searchFrom = 0

  while (true) {
    const start = source.indexOf('makeCrudRoute', searchFrom)
    if (start === -1) break
    const openParen = source.indexOf('(', start)
    if (openParen === -1) break

    let depth = 0
    let end = -1
    let stringQuote: string | null = null
    let escaped = false
    let lineComment = false
    let blockComment = false

    for (let i = openParen; i < source.length; i += 1) {
      const char = source[i]
      const next = source[i + 1]

      if (lineComment) {
        if (char === '\n') lineComment = false
        continue
      }
      if (blockComment) {
        if (char === '*' && next === '/') {
          blockComment = false
          i += 1
        }
        continue
      }
      if (stringQuote) {
        if (escaped) {
          escaped = false
          continue
        }
        if (char === '\\') {
          escaped = true
          continue
        }
        if (char === stringQuote) stringQuote = null
        continue
      }

      if (char === '/' && next === '/') {
        lineComment = true
        i += 1
        continue
      }
      if (char === '/' && next === '*') {
        blockComment = true
        i += 1
        continue
      }
      if (char === '"' || char === "'" || char === '`') {
        stringQuote = char
        continue
      }
      if (char === '(') depth += 1
      if (char === ')') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }

    if (end > openParen) {
      calls.push({ start, body: source.slice(openParen + 1, end) })
      searchFrom = end + 1
    } else {
      searchFrom = start + 'makeCrudRoute'.length
    }
  }

  return calls
}

describe('CRUD route indexing configuration', () => {
  it('sets an indexer whenever makeCrudRoute uses list.entityId', () => {
    const missing = scanRoots
      .flatMap(listSourceFiles)
      .flatMap((file) => {
        const source = fs.readFileSync(file, 'utf8')
        return findMakeCrudRouteCalls(source)
          .filter((call) => /list\s*:\s*{[\s\S]*?entityId\s*:/.test(call.body))
          .filter((call) => !/indexer\s*:/.test(call.body))
          .map((call) => {
            const line = source.slice(0, call.start).split('\n').length
            return `${path.relative(repoRoot, file)}:${line}`
          })
      })

    expect(missing).toEqual([])
  })
})
