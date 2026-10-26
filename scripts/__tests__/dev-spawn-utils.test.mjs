import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveMercatoInvocation, resolveProjectBinary, resolveSpawnCommand } from '../dev-spawn-utils.mjs'

test('resolveProjectBinary prefers node_modules/.bin executables in the current project', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-project-binary-'))
  const binDir = path.join(root, 'node_modules', '.bin')
  const binaryPath = path.join(binDir, 'mercato')

  try {
    fs.mkdirSync(binDir, { recursive: true })
    fs.writeFileSync(binaryPath, '')

    assert.equal(
      resolveProjectBinary('mercato', { cwd: root, platform: 'linux' }),
      binaryPath,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveProjectBinary leaves commands unchanged when no local executable exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-project-binary-miss-'))

  try {
    assert.equal(
      resolveProjectBinary('mercato', { cwd: root, platform: 'linux' }),
      'mercato',
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveMercatoInvocation runs the CLI entry with the current Node executable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-mercato-invocation-'))
  const entryPath = path.join(root, 'node_modules', '@open-mercato', 'cli', 'bin', 'mercato')

  try {
    fs.mkdirSync(path.dirname(entryPath), { recursive: true })
    fs.writeFileSync(entryPath, '')

    const invocation = resolveMercatoInvocation({ cwd: root, platform: 'win32' })

    assert.equal(invocation.command, process.execPath)
    assert.deepEqual(invocation.args, [entryPath])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveMercatoInvocation walks up to an ancestor install (monorepo app workspace)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-mercato-ancestor-'))
  const appDir = path.join(root, 'apps', 'mercato')
  const entryPath = path.join(root, 'node_modules', '@open-mercato', 'cli', 'bin', 'mercato')

  try {
    fs.mkdirSync(appDir, { recursive: true })
    fs.mkdirSync(path.dirname(entryPath), { recursive: true })
    fs.writeFileSync(entryPath, '')

    const invocation = resolveMercatoInvocation({ cwd: appDir, platform: 'win32' })

    assert.equal(invocation.command, process.execPath)
    assert.deepEqual(invocation.args, [entryPath])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveMercatoInvocation falls back to the platform binary when no CLI entry exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-mercato-fallback-'))

  try {
    const windowsInvocation = resolveMercatoInvocation({ cwd: root, platform: 'win32' })
    assert.equal(windowsInvocation.command, 'mercato.cmd')
    assert.deepEqual(windowsInvocation.args, [])

    const posixInvocation = resolveMercatoInvocation({ cwd: root, platform: 'linux' })
    assert.equal(posixInvocation.command, 'mercato')
    assert.deepEqual(posixInvocation.args, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

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
