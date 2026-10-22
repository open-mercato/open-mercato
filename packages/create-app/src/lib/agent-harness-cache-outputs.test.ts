import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const releaseScript = fileURLToPath(new URL('../../agentic/shared/scripts/run-agent-harness-release.mjs', import.meta.url))
const release = await import(pathToFileURL(releaseScript).href) as {
  targetContentFingerprint: (root: string) => string
  runTargetValidationSteps: (input: {
    steps: Array<{ id: string; kind: string; command: string }>
    target: string
    timeout: number
    roots: string[]
    yarnCommand: string
    allowContainedDependencies: boolean
  }) => Array<{ status: string; resultPaths: string[]; sanitizedError?: string }>
}
const sandboxAvailable = process.platform === 'darwin'
  || (process.platform === 'linux' && spawnSync('bwrap', ['--version'], { encoding: 'utf8' }).status === 0)

function validateMutation(source: string, commands: string[] = ['generate']) {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-cache-outputs-')))
  const executable = path.join(target, 'fake-yarn')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.mkdirSync(path.join(target, 'node_modules', 'example'), { recursive: true })
  fs.writeFileSync(path.join(target, 'package.json'), '{}\n')
  fs.writeFileSync(path.join(target, 'src', 'existing.ts'), 'export const existing = true\n')
  fs.writeFileSync(path.join(target, 'node_modules', 'example', 'sentinel.js'), 'original\n')
  fs.writeFileSync(executable, `#!${process.execPath}\nconst fs = require('node:fs')\n${source}\n`)
  fs.chmodSync(executable, 0o755)
  const fingerprint = release.targetContentFingerprint(target)
  try {
    const result = release.runTargetValidationSteps({
      steps: commands.map((command) => ({ id: `validation:${command}`, kind: 'validation', command: `yarn ${command}` })),
      target,
      timeout: 10_000,
      roots: [target],
      yarnCommand: executable,
      allowContainedDependencies: true,
    })
    assert.equal(release.targetContentFingerprint(target), fingerprint)
    return result
  } finally {
    fs.rmSync(target, { recursive: true, force: true })
  }
}

test('validation accepts the default SQLite WAL artifacts and their cleanup during generation and build', { skip: !sandboxAvailable }, () => {
  const results = validateMutation(`
const { DatabaseSync } = require('node:sqlite')
fs.mkdirSync('.mercato/cache', { recursive: true })
const database = new DatabaseSync('.mercato/cache/cache.db')
database.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS cache_entries (key TEXT PRIMARY KEY, value TEXT); INSERT OR REPLACE INTO cache_entries VALUES ('structural', 'current')")
if (process.argv[2] === 'generate') {
  if (!fs.existsSync('.mercato/cache/cache.db-wal') || !fs.existsSync('.mercato/cache/cache.db-shm')) process.exit(9)
  process.exit(0)
}
database.close()
if (fs.existsSync('.mercato/cache/cache.db-wal') || fs.existsSync('.mercato/cache/cache.db-shm')) process.exit(10)
`, ['generate', 'build'])

  assert.deepEqual(results.map((result) => result.status), ['pass', 'pass'], results.map((result) => result.sanitizedError).join('\n'))
  for (const result of results) assert.deepEqual(result.resultPaths, ['.mercato/cache/cache.db', '.mercato/cache/cache.db-shm', '.mercato/cache/cache.db-wal'])
})

const invalidOutputs = [
  { name: 'unrelated cache files', source: "fs.mkdirSync('.mercato/cache', { recursive: true }); fs.writeFileSync('.mercato/cache/cache.db', 'cache'); fs.writeFileSync('.mercato/cache/unreviewed.txt', 'unreviewed')", diagnostic: /\.mercato\/cache\/unreviewed\.txt/ },
  { name: 'unrequired rollback journals', source: "fs.mkdirSync('.mercato/cache', { recursive: true }); fs.writeFileSync('.mercato/cache/cache.db-journal', 'unreviewed')", diagnostic: /\.mercato\/cache\/cache\.db-journal/ },
  { name: 'an empty cache directory', source: "fs.mkdirSync('.mercato/cache', { recursive: true })", diagnostic: /\.mercato\/cache/ },
  { name: 'a directory at the database file path', source: "fs.mkdirSync('.mercato/cache/cache.db', { recursive: true }); fs.writeFileSync('.mercato/cache/cache.db/unreviewed.txt', 'unreviewed')", diagnostic: /\.mercato\/cache\/cache\.db/ },
  { name: 'a contained database symlink', source: "fs.mkdirSync('.mercato/cache', { recursive: true }); fs.symlinkSync('../../src/existing.ts', '.mercato/cache/cache.db')", diagnostic: /cache\.db \(symbolic link\)/ },
  { name: 'an escaping database symlink', source: "fs.mkdirSync('.mercato/cache', { recursive: true }); fs.symlinkSync('../../../../outside', '.mercato/cache/cache.db')", diagnostic: /cache\.db \(symbolic link\)/ },
  { name: 'a contained cache directory symlink', source: "fs.mkdirSync('.mercato/generated', { recursive: true }); fs.writeFileSync('.mercato/generated/cache.db', 'cache'); fs.symlinkSync('generated', '.mercato/cache')", diagnostic: /\.mercato\/cache \(symbolic link\)/ },
  { name: 'source mutations alongside supported cache output', source: "fs.mkdirSync('.mercato/cache', { recursive: true }); fs.writeFileSync('.mercato/cache/cache.db', 'cache'); fs.writeFileSync('src/existing.ts', 'unreviewed')", diagnostic: /src\/existing\.ts/ },
]

for (const scenario of invalidOutputs) {
  test(`validation rejects ${scenario.name}`, { skip: !sandboxAvailable }, () => {
    const [result] = validateMutation(scenario.source)
    assert.equal(result.status, 'fail')
    assert.match(result.sanitizedError ?? '', scenario.diagnostic)
  })
}

for (const command of ['lint', 'typecheck']) {
  test(`${command} does not gain permission to write the SQLite cache`, { skip: !sandboxAvailable }, () => {
    const [result] = validateMutation("fs.mkdirSync('.mercato/cache', { recursive: true }); fs.writeFileSync('.mercato/cache/cache.db', 'cache')", [command])
    assert.equal(result.status, 'fail')
    assert.match(result.sanitizedError ?? '', /\.mercato\/cache/)
  })
}

test('validation keeps installed dependencies protected alongside supported cache output', { skip: !sandboxAvailable }, () => {
  const [result] = validateMutation("fs.mkdirSync('.mercato/cache', { recursive: true }); fs.writeFileSync('.mercato/cache/cache.db', 'cache'); fs.writeFileSync('node_modules/example/sentinel.js', 'unreviewed')")
  assert.equal(result.status, 'fail')
  assert.match(result.sanitizedError ?? '', /EPERM|EACCES|EROFS|read.only|node_modules/i)
})
