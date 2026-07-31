import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(testDir, '..', '..')
const devScriptPath = path.join(repoRoot, 'scripts', 'dev.mjs')
const outputPrefix = '__OM_MODULE_RESOURCE_USAGE_DIR__'

function runMonorepoDevWrapper({ envFiles = {}, shellOverride } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-module-resource-usage-dir-'))
  const binDir = path.join(tempDir, 'bin')
  const appDir = path.join(tempDir, 'apps', 'mercato')
  const yarnPath = path.join(binDir, process.platform === 'win32' ? 'yarn.cmd' : 'yarn')
  fs.mkdirSync(binDir, { recursive: true })
  fs.mkdirSync(appDir, { recursive: true })
  fs.mkdirSync(path.join(tempDir, 'packages'), { recursive: true })
  fs.writeFileSync(path.join(appDir, 'package.json'), '{}\n')
  for (const [fileName, contents] of Object.entries(envFiles)) {
    fs.writeFileSync(path.join(appDir, fileName), contents)
  }
  if (process.platform === 'win32') {
    fs.writeFileSync(yarnPath, [
      '@echo off',
      `node -e "console.log('${outputPrefix}' + JSON.stringify(process.env.OM_MODULE_RESOURCE_USAGE_DIR ?? null))"`,
      'exit /b 0',
    ].join('\r\n'))
  } else {
    fs.writeFileSync(yarnPath, [
      '#!/usr/bin/env node',
      `console.log('${outputPrefix}' + JSON.stringify(process.env.OM_MODULE_RESOURCE_USAGE_DIR ?? null))`,
    ].join('\n'))
    fs.chmodSync(yarnPath, 0o755)
  }

  const env = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    OM_DEV_AUTO_MIGRATE: '0',
    OM_DEV_AUTO_OPEN: '0',
    OM_DEV_LOG_TEE: '0',
    OM_DEV_SPLASH_PORT: 'off',
  }
  delete env.OM_MODULE_RESOURCE_USAGE_DIR
  if (shellOverride !== undefined) {
    env.OM_MODULE_RESOURCE_USAGE_DIR = shellOverride
  }

  try {
    const result = spawnSync(
      process.execPath,
      [devScriptPath, '--app-only', '--classic'],
      {
        cwd: tempDir,
        env,
        encoding: 'utf8',
        timeout: 15_000,
      },
    )
    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(
      result.status,
      1,
      `the monorepo wrapper must preserve its non-zero-on-unexpected-child-exit contract:\n${result.stdout}\n${result.stderr}`,
    )
    const outputLine = result.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith(outputPrefix))
    assert.ok(outputLine, `expected managed app child environment in output:\n${result.stdout}\n${result.stderr}`)
    return {
      appDir: fs.realpathSync(appDir),
      value: JSON.parse(outputLine.slice(outputPrefix.length)),
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

test('monorepo dev wrapper defaults module resource snapshots below the app Next distDir', () => {
  const result = runMonorepoDevWrapper()
  assert.equal(
    result.value,
    path.join(result.appDir, '.mercato', 'next', 'module-resource-usage'),
  )
})

test('monorepo dev wrapper uses the highest-priority non-empty app env-file value', () => {
  const result = runMonorepoDevWrapper({
    envFiles: {
      '.env': 'OM_MODULE_RESOURCE_USAGE_DIR=./from-env\n',
      '.env.development': 'OM_MODULE_RESOURCE_USAGE_DIR=./from-development\n',
      '.env.local': 'OM_MODULE_RESOURCE_USAGE_DIR=./from-local\n',
      '.env.development.local': 'OM_MODULE_RESOURCE_USAGE_DIR="./from-development-local with spaces" # keep parsed value\n',
    },
  })
  assert.equal(result.value, './from-development-local with spaces')
})

test('monorepo dev wrapper preserves a non-empty shell value over app env files', () => {
  const shellOverride = ' ./from-shell with spaces '
  const result = runMonorepoDevWrapper({
    envFiles: {
      '.env.development.local': 'OM_MODULE_RESOURCE_USAGE_DIR=./from-app-env\n',
    },
    shellOverride,
  })
  assert.equal(result.value, shellOverride)
})
