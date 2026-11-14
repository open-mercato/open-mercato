import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const repositoryRoot = path.resolve(packageRoot, '../..')
const rootManifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')) as {
  resolutions: Record<string, string>
}
const securityPackages = ['node-forge', 'sharp']

for (const preset of ['classic', 'empty', 'crm', 'wms']) {
  test(`${preset} scaffold retains the applicable monorepo security pins`, () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-security-pins-'))
    try {
      execFileSync(process.execPath, [
        path.join(packageRoot, 'dist/index.js'), 'security-app',
        '--preset', preset, '--agents', 'none', '--no-init-git',
      ], { cwd: temporaryRoot, stdio: 'pipe', timeout: 30_000 })
      const manifest = JSON.parse(fs.readFileSync(path.join(temporaryRoot, 'security-app/package.json'), 'utf8')) as {
        resolutions: Record<string, string>
      }
      for (const packageName of securityPackages) {
        const pin = rootManifest.resolutions[packageName]
        assert.ok(pin, `${packageName} must have a reviewed monorepo security pin`)
        assert.equal(manifest.resolutions[packageName], pin, `${packageName} security pin must survive scaffolding`)
      }
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
    }
  })
}

test('installed standalone scaffold passes the high-severity dependency audit', {
  skip: !process.env.OM_SCAFFOLD_AUDIT_DIR,
}, () => {
  const appDirectory = path.resolve(process.env.OM_SCAFFOLD_AUDIT_DIR!)
  const lockfile = path.join(appDirectory, 'yarn.lock')
  assert.ok(fs.existsSync(path.join(appDirectory, 'node_modules')), 'install the scaffold before auditing it')
  assert.ok(fs.statSync(lockfile).size > 1024, 'audit a resolved dependency graph')
  execFileSync(process.execPath, [path.join(repositoryRoot, 'scripts/audit-ci.mjs'), lockfile, '--severity', 'high'], {
    cwd: appDirectory,
    stdio: 'pipe',
    timeout: 90_000,
  })
})
