import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const scanRoots = ['scripts', 'apps', 'packages']
const sourceExtensions = new Set(['.js', '.mjs', '.ts'])
const excludedPathSegments = new Set([
  'build',
  'dist',
  'node_modules',
  '.mercato',
  '.next',
  '.turbo',
  'coverage',
])
const excludedFileSuffixes = [
  '.test.ts',
  '.test.mjs',
  '.spec.ts',
  '.spec.mjs',
]

function shouldSkipEntry(entryPath) {
  const normalized = entryPath.split(path.sep)
  return normalized.some((segment) => excludedPathSegments.has(segment))
}

function shouldScanFile(filePath) {
  const extension = path.extname(filePath)
  if (!sourceExtensions.has(extension)) {
    return false
  }

  return !excludedFileSuffixes.some((suffix) => filePath.endsWith(suffix))
}

function collectSourceFiles(rootDir) {
  const files = []
  const queue = [rootDir]

  while (queue.length > 0) {
    const currentDir = queue.pop()
    if (!currentDir || shouldSkipEntry(currentDir)) {
      continue
    }

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name)
      if (shouldSkipEntry(entryPath)) {
        continue
      }

      if (entry.isDirectory()) {
        queue.push(entryPath)
        continue
      }

      if (entry.isFile() && shouldScanFile(entryPath)) {
        files.push(entryPath)
      }
    }
  }

  return files
}

function normalizeForRegex(source) {
  return source.replace(/\r\n/g, '\n')
}

function usesSpawnWithWindowsWrapper(source) {
  const normalized = normalizeForRegex(source)

  if (!normalized.includes('spawn(')) {
    return false
  }

  return normalized.includes('.cmd') || normalized.includes('.bat')
}

function usesWindowsSpawnGuard(source) {
  return normalizeForRegex(source).includes('resolveSpawnCommand(')
}

test('Windows wrapper spawns go through resolveSpawnCommand', () => {
  const sourceFiles = scanRoots.flatMap((root) => collectSourceFiles(path.join(repoRoot, root)))
  const violations = []

  for (const filePath of sourceFiles) {
    const source = fs.readFileSync(filePath, 'utf8')
    if (!usesSpawnWithWindowsWrapper(source)) {
      continue
    }

    if (usesWindowsSpawnGuard(source)) {
      continue
    }

    violations.push(path.relative(repoRoot, filePath))
  }

  assert.deepEqual(
    violations,
    [],
    `Files with Windows .cmd/.bat spawn paths must use resolveSpawnCommand:\n${violations.join('\n')}`,
  )
})
