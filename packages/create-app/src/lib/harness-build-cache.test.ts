import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const turbo = path.join(path.dirname(require.resolve('turbo/package.json')), 'bin/turbo')
const configuration = fileURLToPath(new URL('../../../../turbo.json', import.meta.url))
const harnessSource = 'packages/create-app/agentic/shared/ai/harness/writable-ast-oracles.mjs'
const copiedSources = [
  harnessSource,
  'AGENTS.md',
  'BACKWARD_COMPATIBILITY.md',
  'packages/core/src/modules/customers/agentic/standalone-guide.md',
  'packages/create-app/template/src/modules/example/backend/books/page.tsx',
]
const taskPackages = { '@open-mercato/cli#build': 'cli', 'create-mercato-app#build': 'create-app' }

type TaskSummary = { taskId: string; hash: string; cache: { status: string } }

function write(root: string, relative: string, value: string) {
  const destination = path.join(root, relative)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, value)
}

function fixture(run: (root: string) => void) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-build-cache-')))
  write(root, 'package.json', JSON.stringify({ name: 'harness-cache-fixture', private: true, packageManager: 'npm@10.0.0', workspaces: ['packages/*'] }))
  write(root, '.gitignore', 'node_modules/\n.turbo/\n.turbo-cache/\npackages/*/dist/\n')
  fs.copyFileSync(configuration, path.join(root, 'turbo.json'))
  const lockPackages: Record<string, unknown> = { '': { name: 'harness-cache-fixture', workspaces: ['packages/*'] } }
  for (const [taskId, directory] of Object.entries(taskPackages)) {
    const name = taskId.slice(0, -'#build'.length)
    const dependencies = directory === 'create-app' ? { '@open-mercato/cli': '*' } : {}
    const manifest = { name, version: '1.0.0', scripts: { build: 'node build.cjs' }, dependencies }
    write(root, `packages/${directory}/package.json`, JSON.stringify(manifest))
    lockPackages[`packages/${directory}`] = manifest
    lockPackages[`node_modules/${name}`] = { resolved: `packages/${directory}`, link: true }
    write(root, `packages/${directory}/build.cjs`, `const fs = require('node:fs'); const path = require('node:path'); const root = path.resolve('../..'); const sources = ${JSON.stringify(copiedSources)}; fs.mkdirSync('dist', { recursive: true }); fs.writeFileSync('dist/delivery.json', JSON.stringify(Object.fromEntries(sources.map(source => [source, fs.readFileSync(path.join(root, source), 'utf8')]))));\n`)
  }
  write(root, 'package-lock.json', JSON.stringify({ name: 'harness-cache-fixture', lockfileVersion: 3, packages: lockPackages }))
  for (const source of copiedSources) write(root, source, 'initial authoritative bytes\n')
  const initialized = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' })
  assert.equal(initialized.status, 0, initialized.stderr)
  const staged = spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' })
  assert.equal(staged.status, 0, staged.stderr)
  try { run(root) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

function build(root: string): TaskSummary[] {
  for (const directory of Object.values(taskPackages)) fs.rmSync(path.join(root, 'packages', directory, 'dist'), { recursive: true, force: true })
  const summaries = path.join(root, '.turbo/runs')
  const previous = new Set(fs.existsSync(summaries) ? fs.readdirSync(summaries) : [])
  const execution = spawnSync(process.execPath, [turbo, 'run', 'build', '--filter=@open-mercato/cli', '--filter=create-mercato-app', '--cache=local:rw', '--cache-dir=.turbo-cache', '--summarize'], {
    cwd: root,
    env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1', TURBO_DAEMON: 'false' },
    encoding: 'utf8', timeout: 30_000,
  })
  assert.equal(execution.status, 0, `${execution.stdout}\n${execution.stderr}`)
  const created = fs.readdirSync(summaries).filter(name => !previous.has(name) && name.endsWith('.json'))
  assert.equal(created.length, 1)
  return (JSON.parse(fs.readFileSync(path.join(summaries, created[0]), 'utf8')) as { tasks: TaskSummary[] }).tasks
}

function task(tasks: TaskSummary[], taskId: string) {
  const result = tasks.find(entry => entry.taskId === taskId)
  assert.ok(result, `${taskId} must execute in the real Turbo graph`)
  return result
}

function delivered(root: string, directory: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(root, 'packages', directory, 'dist/delivery.json'), 'utf8'))
}

test('Turbo restores unchanged harness delivery from cache and invalidates copied sibling harness changes', () => fixture(root => {
  const initial = build(root)
  const unchanged = build(root)
  for (const taskId of Object.keys(taskPackages)) {
    assert.equal(task(initial, taskId).cache.status, 'MISS')
    assert.equal(task(unchanged, taskId).cache.status, 'HIT')
    assert.equal(task(unchanged, taskId).hash, task(initial, taskId).hash)
  }
  write(root, harnessSource, 'corrected oracle bytes\n')
  const changed = build(root)
  assert.equal(delivered(root, 'cli')[harnessSource], 'corrected oracle bytes\n', 'CLI must not restore a stale harness after its source changes')
  assert.notEqual(task(changed, '@open-mercato/cli#build').hash, task(initial, '@open-mercato/cli#build').hash, 'CLI hash must include its copied sibling harness')
  for (const [taskId, directory] of Object.entries(taskPackages)) {
    assert.equal(task(changed, taskId).cache.status, 'MISS')
    assert.equal(delivered(root, directory)[harnessSource], 'corrected oracle bytes\n', `${directory} must not restore stale copied harness output`)
  }
}))

test('Turbo invalidates both delivery builders for copied upstream rules, guides and reference examples', () => fixture(root => {
  let previous = build(root)
  for (const source of copiedSources.filter(source => source !== harnessSource)) {
    write(root, source, `updated authoritative bytes for ${source}\n`)
    const changed = build(root)
    for (const [taskId, directory] of Object.entries(taskPackages)) {
      assert.equal(delivered(root, directory)[source], `updated authoritative bytes for ${source}\n`, `${directory} must not restore stale copied authority ${source}`)
      assert.notEqual(task(changed, taskId).hash, task(previous, taskId).hash, `${taskId} must hash copied authority ${source}`)
      assert.equal(task(changed, taskId).cache.status, 'MISS')
    }
    previous = changed
  }
}))
