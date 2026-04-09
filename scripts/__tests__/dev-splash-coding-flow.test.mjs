import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  detectSplashCodingTools,
  isCodingFlowEnabled,
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
