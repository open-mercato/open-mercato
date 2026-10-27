import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const createAppBin = path.join(packageRoot, 'dist', 'index.js')

function scaffold(rootDir: string, appName: string, extraArgs: string[] = []): string {
  execFileSync(
    process.execPath,
    [createAppBin, appName, '--agents', 'all', '--no-init-git', ...extraArgs],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        OM_SKIP_EXTERNAL_SKILLS: '1',
        OM_HARNESS_EXPERIMENTAL_HOOKS_VALIDATOR: '0',
      },
      stdio: 'pipe',
    },
  )
  return path.join(rootDir, appName)
}

const gateEvidencePaths = [
  '.claude/hooks/gate-evidence.ts',
  '.codex/hooks.json',
  '.codex/hooks/gate-evidence.mjs',
  '.cursor/hooks/gate-evidence.mjs',
]

test('create-app omits experimental hook validators by default', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-hook-validator-default-'))
  try {
    const appDir = scaffold(rootDir, 'default-app')
    for (const relativePath of gateEvidencePaths) {
      assert.equal(fs.existsSync(path.join(appDir, relativePath)), false, relativePath)
    }
    assert.doesNotMatch(fs.readFileSync(path.join(appDir, '.claude/settings.json'), 'utf8'), /gate-evidence/)
    assert.doesNotMatch(fs.readFileSync(path.join(appDir, '.cursor/hooks.json'), 'utf8'), /gate-evidence/)
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true })
  }
})

test('create-app installs experimental hook validators with the explicit setup option', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-hook-validator-enabled-'))
  try {
    const appDir = scaffold(rootDir, 'enabled-app', ['--experimental-hooks-validator'])
    for (const relativePath of gateEvidencePaths) {
      assert.equal(fs.existsSync(path.join(appDir, relativePath)), true, relativePath)
    }
    assert.match(fs.readFileSync(path.join(appDir, '.claude/settings.json'), 'utf8'), /gate-evidence/)
    assert.match(fs.readFileSync(path.join(appDir, '.cursor/hooks.json'), 'utf8'), /gate-evidence/)
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true })
  }
})
