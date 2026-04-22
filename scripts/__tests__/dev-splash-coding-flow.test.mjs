import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  assertShellSafePath,
  detectSplashCodingTools,
  isCodingFlowEnabled,
  isShellSafePathString,
  sanitizeLaunchDirectory,
} from '../dev-splash-coding-flow.mjs'

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

test('coding flow defaults to enabled', () => {
  assert.equal(isCodingFlowEnabled(undefined), true)
  assert.equal(isCodingFlowEnabled(''), true)
  assert.equal(isCodingFlowEnabled('false'), false)
  assert.equal(isCodingFlowEnabled('off'), false)
})

test('detectSplashCodingTools marks setup-capable tools as unconfigured until files exist', () => {
  const tempDir = makeTempDir('dev-splash-coding-flow-')
  const binDir = path.join(tempDir, 'bin')
  const appDir = path.join(tempDir, 'app')
  fs.mkdirSync(binDir, { recursive: true })
  fs.mkdirSync(appDir, { recursive: true })
  fs.writeFileSync(path.join(binDir, 'cursor'), '#!/bin/sh\n')

  try {
    const beforeSetup = detectSplashCodingTools({
      env: { PATH: binDir },
      platform: 'darwin',
      agenticSetupDir: appDir,
    })
    const cursorBeforeSetup = beforeSetup.find((tool) => tool.id === 'cursor')

    assert.ok(cursorBeforeSetup)
    assert.equal(cursorBeforeSetup.configured, false)
    assert.equal(cursorBeforeSetup.requiresSetup, true)

    fs.mkdirSync(path.join(appDir, '.cursor'), { recursive: true })
    fs.writeFileSync(path.join(appDir, '.cursor', 'hooks.json'), '{}\n')

    const afterSetup = detectSplashCodingTools({
      env: { PATH: binDir },
      platform: 'darwin',
      agenticSetupDir: appDir,
    })
    const cursorAfterSetup = afterSetup.find((tool) => tool.id === 'cursor')

    assert.ok(cursorAfterSetup)
    assert.equal(cursorAfterSetup.configured, true)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('detectSplashCodingTools supports Windows Path and PATHEXT resolution', () => {
  const tempDir = makeTempDir('dev-splash-coding-flow-win-path-')
  const binDir = path.join(tempDir, 'bin')
  fs.mkdirSync(binDir, { recursive: true })
  fs.writeFileSync(path.join(binDir, 'codex.cmd'), '@echo off\r\n')

  try {
    const tools = detectSplashCodingTools({
      env: {
        Path: binDir,
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
      },
      platform: 'win32',
    })
    const codex = tools.find((tool) => tool.id === 'codex')

    assert.ok(codex)
    assert.match(codex.executablePath, /codex\.cmd$/i)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('detectSplashCodingTools supports explicit executable overrides', () => {
  const tempDir = makeTempDir('dev-splash-coding-flow-env-override-')
  const customCodexPath = path.join(tempDir, 'custom-codex')
  fs.writeFileSync(customCodexPath, '#!/bin/sh\n')

  try {
    const tools = detectSplashCodingTools({
      env: {
        PATH: '',
        OM_DEV_SPLASH_CODEX_PATH: customCodexPath,
      },
      platform: 'linux',
    })
    const codex = tools.find((tool) => tool.id === 'codex')

    assert.ok(codex)
    assert.equal(codex.executablePath, customCodexPath)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('detectSplashCodingTools finds Windows editor installs outside PATH', () => {
  const tempDir = makeTempDir('dev-splash-coding-flow-win-install-')
  const localAppData = path.join(tempDir, 'LocalAppData')
  const vscodeExecutable = path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe')
  fs.mkdirSync(path.dirname(vscodeExecutable), { recursive: true })
  fs.writeFileSync(vscodeExecutable, '')

  try {
    const tools = detectSplashCodingTools({
      env: {
        PATH: '',
        LOCALAPPDATA: localAppData,
      },
      platform: 'win32',
    })
    const vscode = tools.find((tool) => tool.id === 'vscode')

    assert.ok(vscode)
    assert.equal(vscode.executablePath, vscodeExecutable)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('detectSplashCodingTools finds Linux fallback binaries outside PATH', () => {
  const tempDir = makeTempDir('dev-splash-coding-flow-linux-install-')
  const localBinDir = path.join(tempDir, '.local', 'bin')
  const claudePath = path.join(localBinDir, 'claude')
  fs.mkdirSync(localBinDir, { recursive: true })
  fs.writeFileSync(claudePath, '#!/bin/sh\n')

  try {
    const tools = detectSplashCodingTools({
      env: {
        PATH: '',
        HOME: tempDir,
      },
      platform: 'linux',
    })
    const claude = tools.find((tool) => tool.id === 'claude-code')

    assert.ok(claude)
    assert.equal(claude.executablePath, claudePath)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('isShellSafePathString rejects non-strings, empty strings, and control characters', () => {
  // Valid shell-safe paths
  assert.equal(isShellSafePathString('/Users/dev/projects/my-app'), true)
  assert.equal(isShellSafePathString('C:\\Users\\dev\\my app'), true)
  assert.equal(isShellSafePathString('relative/path/with spaces and-dashes_and.dots'), true)
  assert.equal(isShellSafePathString("/path/with'single-quote"), true)
  assert.equal(isShellSafePathString('/path/with"double-quote'), true)
  assert.equal(isShellSafePathString('/path/with`subshell'), false)
  assert.equal(isShellSafePathString('/path/with$variable'), false)
  // Non-strings
  assert.equal(isShellSafePathString(undefined), false)
  assert.equal(isShellSafePathString(null), false)
  assert.equal(isShellSafePathString(42), false)
  assert.equal(isShellSafePathString({}), false)
  // Empty strings
  assert.equal(isShellSafePathString(''), false)
  // Control characters and NUL bytes
  assert.equal(isShellSafePathString('/path/with\x00nul'), false)
  assert.equal(isShellSafePathString('/path/with\nnewline'), false)
  assert.equal(isShellSafePathString('/path/with\rreturn'), false)
  assert.equal(isShellSafePathString('/path/with\ttab'), false)
  assert.equal(isShellSafePathString('/path/with\x1bescape'), false)
  assert.equal(isShellSafePathString('/path/with\x7fdelete'), false)
})

test('assertShellSafePath returns the value on success and throws with the label on failure', () => {
  assert.equal(assertShellSafePath('/safe/path', 'Launch directory'), '/safe/path')

  assert.throws(
    () => assertShellSafePath('/path/with\x00nul', 'Launch directory'),
    /Launch directory contains invalid or unsafe characters\./,
  )

  assert.throws(
    () => assertShellSafePath(undefined, 'Coding tool executable path'),
    /Coding tool executable path contains invalid or unsafe characters\./,
  )

  assert.throws(
    () => assertShellSafePath('', 'Agentic setup directory'),
    /Agentic setup directory contains invalid or unsafe characters\./,
  )

  assert.throws(
    () => assertShellSafePath(42, 'Coding tool id'),
    /Coding tool id contains invalid or unsafe characters\./,
  )
})

test('sanitizeLaunchDirectory falls back to cwd for invalid input but accepts safe directories', () => {
  const tempDir = makeTempDir('dev-splash-sanitize-')
  try {
    // Valid directory passes through (resolved to absolute)
    const resolved = sanitizeLaunchDirectory(tempDir)
    assert.equal(resolved, path.resolve(tempDir))

    // Non-strings fall back to cwd
    assert.equal(sanitizeLaunchDirectory(undefined), process.cwd())
    assert.equal(sanitizeLaunchDirectory(null), process.cwd())
    assert.equal(sanitizeLaunchDirectory(42), process.cwd())

    // Empty / whitespace strings fall back to cwd
    assert.equal(sanitizeLaunchDirectory(''), process.cwd())
    assert.equal(sanitizeLaunchDirectory('   '), process.cwd())

    // Control-character poisoned strings fall back to cwd (not throw)
    assert.equal(sanitizeLaunchDirectory('/tmp/with\x00nul'), process.cwd())
    assert.equal(sanitizeLaunchDirectory('/tmp/with\nnewline'), process.cwd())

    // Non-existent paths fall back to cwd
    assert.equal(sanitizeLaunchDirectory(path.join(tempDir, 'does-not-exist')), process.cwd())

    // Files (not directories) fall back to cwd
    const filePath = path.join(tempDir, 'file.txt')
    fs.writeFileSync(filePath, 'data')
    assert.equal(sanitizeLaunchDirectory(filePath), process.cwd())
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
