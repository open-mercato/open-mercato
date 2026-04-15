import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveSpawnCommand } from '../dev-spawn-utils.mjs'

test('resolveSpawnCommand keeps non-Windows commands unchanged', () => {
  const result = resolveSpawnCommand('yarn', ['--version'], { platform: 'linux' })

  assert.equal(result.command, 'yarn')
  assert.deepEqual(result.args, ['--version'])
  assert.deepEqual(result.spawnOptions, {})
})

test('resolveSpawnCommand wraps Windows cmd shims in a shell command', () => {
  const result = resolveSpawnCommand('yarn.cmd', ['turbo', 'run', 'build', '--filter=./packages/*'], {
    platform: 'win32',
  })

  assert.equal(result.command, 'yarn.cmd turbo run build --filter=./packages/*')
  assert.deepEqual(result.args, [])
  assert.deepEqual(result.spawnOptions, { shell: true })
})

test('resolveSpawnCommand quotes Windows cmd arguments that need shell escaping', () => {
  const result = resolveSpawnCommand('tool.cmd', ['value with spaces', 'say "hello"'], {
    platform: 'win32',
  })

  assert.equal(result.command, 'tool.cmd "value with spaces" "say ""hello"""')
  assert.deepEqual(result.args, [])
  assert.deepEqual(result.spawnOptions, { shell: true })
})

