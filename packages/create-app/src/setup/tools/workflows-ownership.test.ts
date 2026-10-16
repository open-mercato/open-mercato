import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../../..', import.meta.url))
const createAppBin = path.join(packageRoot, 'dist', 'index.js')
const APP_NAME = 'workflows-app'

function scaffold(rootDir: string, agents: string): string {
  execFileSync(
    process.execPath,
    [createAppBin, APP_NAME, '--agents', agents, '--no-init-git'],
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
  return path.join(rootDir, APP_NAME)
}

function readWorkflows(appDir: string): Map<string, string> {
  const workflowsDir = path.join(appDir, '.github', 'workflows')
  const files = new Map<string, string>()
  for (const fileName of fs.readdirSync(workflowsDir).sort()) {
    files.set(fileName, fs.readFileSync(path.join(workflowsDir, fileName), 'utf8'))
  }
  return files
}

test('agentic setup for every tool leaves the scaffolded CI workflows byte-identical', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-workflows-ownership-'))
  try {
    const baselineDir = path.join(rootDir, 'baseline')
    const agenticDir = path.join(rootDir, 'agentic')
    fs.mkdirSync(baselineDir)
    fs.mkdirSync(agenticDir)

    const baselineWorkflows = readWorkflows(scaffold(baselineDir, 'none'))
    assert.ok(baselineWorkflows.has('ci.yml'), 'baseline scaffold must ship ci.yml')

    const appDir = scaffold(agenticDir, 'all')
    assert.deepEqual(readWorkflows(appDir), baselineWorkflows)

    assert.ok(fs.statSync(path.join(appDir, '.github', 'copilot-instructions.md')).isFile())
    assert.ok(fs.statSync(path.join(appDir, '.github', 'instructions')).isDirectory())

    const manifest = JSON.parse(
      fs.readFileSync(path.join(appDir, '.ai', 'harness', 'manifest.json'), 'utf8'),
    ) as { files: Array<{ path: string }> }
    assert.ok(manifest.files.length > 0)
    assert.deepEqual(
      manifest.files.filter((entry) => entry.path.startsWith('.github/workflows')),
      [],
    )
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true })
  }
})
