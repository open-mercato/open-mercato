import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  NONEXISTENT_COMMAND,
  collectExecutableTasks,
  parseTurboDryRun,
} from '../check-turbo-task-graph.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function collectWorkspaceManifests() {
  const workspaceRoots = [path.join(repoRoot, 'apps'), path.join(repoRoot, 'packages')]
  const manifests = []

  for (const workspaceRoot of workspaceRoots) {
    if (!fs.existsSync(workspaceRoot)) continue

    for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue

      const manifestPath = path.join(workspaceRoot, entry.name, 'package.json')
      if (fs.existsSync(manifestPath)) {
        manifests.push({ manifestPath, manifest: readJson(manifestPath) })
      }
    }
  }

  return manifests
}

test('collectExecutableTasks ignores workspaces without the script', () => {
  const dryRun = {
    tasks: [
      { taskId: '@open-mercato/core#lint', command: NONEXISTENT_COMMAND },
      { taskId: '@open-mercato/ui#lint', command: '   ' },
      { taskId: '@open-mercato/app#lint', command: 'eslint .' },
    ],
  }

  assert.deepEqual(
    collectExecutableTasks(dryRun).map((task) => task.taskId),
    ['@open-mercato/app#lint'],
  )
})

test('collectExecutableTasks reports an empty graph as zero commands', () => {
  const dryRun = { tasks: [{ taskId: '@open-mercato/core#lint', command: NONEXISTENT_COMMAND }] }

  assert.equal(collectExecutableTasks(dryRun).length, 0)
  assert.equal(collectExecutableTasks({}).length, 0)
  assert.equal(collectExecutableTasks(null).length, 0)
})

test('parseTurboDryRun tolerates output preceding the JSON payload', () => {
  const parsed = parseTurboDryRun('turbo 2.10.5\n{"tasks":[{"taskId":"a#lint","command":"eslint ."}]}\n')

  assert.equal(parsed.tasks[0].command, 'eslint .')
  assert.throws(() => parseTurboDryRun('no json here'), /no JSON output/)
})

test('at least one workspace defines a lint script', () => {
  const linted = collectWorkspaceManifests()
    .filter(({ manifest }) => typeof manifest?.scripts?.lint === 'string')
    .map(({ manifestPath }) => path.relative(repoRoot, manifestPath))

  assert.ok(
    linted.length > 0,
    'No workspace defines a `lint` script, so `turbo run lint` would run nothing.',
  )
})

test('the root lint script fans out to every workspace lint script', () => {
  const rootManifest = readJson(path.join(repoRoot, 'package.json'))

  assert.equal(rootManifest.scripts.lint, 'turbo run lint')
  assert.equal(rootManifest.scripts['lint:check-graph'], 'node scripts/check-turbo-task-graph.mjs lint')
})

test('the CI lint job lints instead of filtering every lint script away', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8')

  assert.match(workflow, /^\s+run: yarn lint:check-graph$/m)
  assert.match(workflow, /^\s+run: yarn lint$/m)
  assert.doesNotMatch(workflow, /turbo run lint[^\n]*--filter/)
})
