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

function runMonorepoDevWrapper(override) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-module-resource-usage-dir-'))
  const binDir = path.join(tempDir, 'bin')
  const yarnPath = path.join(binDir, 'yarn')
  fs.mkdirSync(binDir, { recursive: true })
  fs.writeFileSync(yarnPath, [
    '#!/usr/bin/env node',
    `console.log('${outputPrefix}' + JSON.stringify(process.env.OM_MODULE_RESOURCE_USAGE_DIR ?? null))`,
  ].join('\n'))
  fs.chmodSync(yarnPath, 0o755)

  const env = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    OM_DEV_AUTO_MIGRATE: '0',
    OM_DEV_AUTO_OPEN: '0',
    OM_DEV_LOG_TEE: '0',
    OM_DEV_SPLASH_PORT: 'off',
  }
  delete env.OM_MODULE_RESOURCE_USAGE_DIR
  if (override !== undefined) {
    env.OM_MODULE_RESOURCE_USAGE_DIR = override
  }

  try {
    const result = spawnSync(
      process.execPath,
      [devScriptPath, '--app-only', '--classic'],
      {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
        timeout: 15_000,
      },
    )
    assert.notEqual(result.error?.code, 'ETIMEDOUT', result.error?.message)
    const outputLine = result.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith(outputPrefix))
    assert.ok(outputLine, `expected managed app child environment in output:\n${result.stdout}\n${result.stderr}`)
    return JSON.parse(outputLine.slice(outputPrefix.length))
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

test('monorepo dev wrapper defaults module resource snapshots below the app Next distDir', () => {
  assert.equal(
    runMonorepoDevWrapper(),
    path.join(repoRoot, 'apps', 'mercato', '.mercato', 'next', 'module-resource-usage'),
  )
})

test('monorepo dev wrapper preserves an explicit module resource snapshot directory', () => {
  const override = './custom-module-resource-usage'
  assert.equal(runMonorepoDevWrapper(override), override)
})
