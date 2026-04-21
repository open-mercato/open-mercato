import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveSpawnCommand } from '../dev-spawn-utils.mjs'

test('resolveSpawnCommand keeps non-Windows commands unchanged', () => {
  const result = resolveSpawnCommand('yarn', ['--version'], { platform: 'linux' })

  assert.equal(result.command, 'yarn')
  assert.deepEqual(result.args, ['--version'])
  assert.deepEqual(result.spawnOptions, {})
})

test('resolveSpawnCommand keeps Windows cmd shims as direct executable invocations for cross-spawn', () => {
  const result = resolveSpawnCommand('yarn.cmd', ['turbo', 'run', 'build', '--filter=./packages/*'], {
    platform: 'win32',
  })

  assert.equal(result.command, 'yarn.cmd')
  assert.deepEqual(result.args, ['turbo', 'run', 'build', '--filter=./packages/*'])
  assert.deepEqual(result.spawnOptions, {})
})

test('resolveSpawnCommand keeps Windows cmd arguments unchanged so cross-spawn can quote them', () => {
  const result = resolveSpawnCommand('tool.cmd', ['value with spaces', 'say "hello"'], {
    platform: 'win32',
  })

  assert.equal(result.command, 'tool.cmd')
  assert.deepEqual(result.args, ['value with spaces', 'say "hello"'])
  assert.deepEqual(result.spawnOptions, {})
})

test('resolveSpawnCommand rejects unsafe Windows cmd arguments', () => {
  assert.throws(
    () => resolveSpawnCommand('tool.cmd', ['%TEMP%'], { platform: 'win32' }),
    /unsupported characters/,
  )
})
