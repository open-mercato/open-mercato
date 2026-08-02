import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const sharedRoot = fileURLToPath(new URL('../../agentic/shared/', import.meta.url))
const sourceHarness = path.join(sharedRoot, 'ai', 'harness')
const sourceFixturePreparer = path.join(sharedRoot, 'scripts', 'prepare-agent-harness-fixture.mjs')
const linkType = process.platform === 'win32' ? 'junction' : 'dir'

function stageController(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-fixture-controller-')))
  fs.cpSync(sourceHarness, path.join(root, '.ai', 'harness'), { recursive: true })
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.copyFileSync(sourceFixturePreparer, path.join(root, 'scripts', 'prepare-agent-harness-fixture.mjs'))
  return root
}

function stageTarget(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-fixture-target-')))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.cpSync(sourceHarness, path.join(root, '.ai', 'harness'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture-target"}\n')
  fs.writeFileSync(path.join(root, 'src', 'modules.ts'), 'export default []\n')
  return root
}

function prepare(controller: string, target: string) {
  return spawnSync(process.execPath, [
    path.join(controller, 'scripts', 'prepare-agent-harness-fixture.mjs'),
    '--case', 'OMH-009',
    '--target', target,
    '--acknowledge-writes',
  ], { cwd: controller, encoding: 'utf8' })
}

test('fixture preparation rejects symlinked seed parents without outside mutation', () => {
  const controller = stageController()
  try {
    for (const parent of ['src/modules/library', 'src/modules']) {
      const target = stageTarget()
      const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-fixture-outside-')))
      const redirected = path.join(outside, 'redirected')
      const sentinel = path.join(outside, 'sentinel.txt')
      fs.mkdirSync(redirected)
      fs.writeFileSync(sentinel, 'untouched\n')
      try {
        const linkedParent = path.join(target, parent)
        fs.rmSync(linkedParent, { recursive: true, force: true })
        fs.mkdirSync(path.dirname(linkedParent), { recursive: true })
        fs.symlinkSync(redirected, linkedParent, linkType)

        const result = prepare(controller, target)
        assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
        assert.match(result.stderr, /symbolic link/)
        assert.equal(fs.readFileSync(sentinel, 'utf8'), 'untouched\n')
        assert.deepEqual(fs.readdirSync(redirected), [])
        assert.equal(fs.existsSync(path.join(target, '.ai', 'harness', 'DISPOSABLE')), false)
      } finally {
        fs.rmSync(target, { recursive: true, force: true })
        fs.rmSync(outside, { recursive: true, force: true })
      }
    }
  } finally {
    fs.rmSync(controller, { recursive: true, force: true })
  }
})

test('fixture preparation rejects symlinked .ai ancestors without outside mutation', () => {
  const controller = stageController()
  try {
    for (const parent of ['.ai', '.ai/harness']) {
      const target = stageTarget()
      const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-fixture-outside-')))
      const redirected = path.join(outside, 'redirected')
      const sentinel = path.join(outside, 'sentinel.txt')
      fs.writeFileSync(sentinel, 'untouched\n')
      if (parent === '.ai') {
        fs.mkdirSync(redirected)
        fs.cpSync(sourceHarness, path.join(redirected, 'harness'), { recursive: true })
      } else {
        fs.cpSync(sourceHarness, redirected, { recursive: true })
      }
      try {
        const linkedParent = path.join(target, parent)
        fs.rmSync(linkedParent, { recursive: true, force: true })
        fs.mkdirSync(path.dirname(linkedParent), { recursive: true })
        fs.symlinkSync(redirected, linkedParent, linkType)

        const result = prepare(controller, target)
        assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
        assert.match(result.stderr, /unsafe|symbolic link/)
        assert.equal(fs.readFileSync(sentinel, 'utf8'), 'untouched\n')
        assert.equal(fs.existsSync(path.join(redirected, 'DISPOSABLE')), false)
        assert.equal(fs.existsSync(path.join(redirected, 'harness', 'DISPOSABLE')), false)
      } finally {
        fs.rmSync(target, { recursive: true, force: true })
        fs.rmSync(outside, { recursive: true, force: true })
      }
    }
  } finally {
    fs.rmSync(controller, { recursive: true, force: true })
  }
})

test('fixture preparation rejects a symlink target root', () => {
  const controller = stageController()
  const target = stageTarget()
  const targetLink = `${target}-link`
  fs.symlinkSync(target, targetLink, linkType)
  try {
    const result = prepare(controller, targetLink)
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /target must be a regular directory, not a symbolic link/)
    assert.equal(fs.existsSync(path.join(target, '.ai', 'harness', 'DISPOSABLE')), false)
  } finally {
    fs.rmSync(targetLink, { recursive: true, force: true })
    fs.rmSync(target, { recursive: true, force: true })
    fs.rmSync(controller, { recursive: true, force: true })
  }
})
