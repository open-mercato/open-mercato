import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildRegistryConfig } from '../index.ts'

const templatePackageManager = readFileSync(
  fileURLToPath(new URL('../../template/package.json.template', import.meta.url)),
  'utf8',
).match(/"packageManager":\s*"([^"]+)"/)?.[1]

test('custom registries exempt exact Open Mercato packages from the release age quarantine', () => {
  const config = buildRegistryConfig('http://localhost:4874')

  assert.match(config, /npmScopes:\n  open-mercato:\n    npmRegistryServer: "http:\/\/localhost:4874"\n    npmMinimalAgeGate: 0/)
  assert.match(config, /unsafeHttpWhitelist:\n  - "localhost"\n  - "host\.docker\.internal"/)
})

test('custom registry config is accepted by the scaffolded Yarn version', () => {
  assert.ok(templatePackageManager, 'template package.json.template must pin a packageManager')
  const root = mkdtempSync(join(tmpdir(), 'create-mercato-app-registry-config-'))
  try {
    writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'registry-config-fixture', packageManager: templatePackageManager }, null, 2)}\n`)
    writeFileSync(join(root, '.yarnrc.yml'), `nodeLinker: node-modules\n${buildRegistryConfig('http://localhost:4874')}\n`)
    const output = execFileSync(process.platform === 'win32' ? 'yarn.cmd' : 'yarn', ['config', 'get', 'npmScopes', '--json'], {
      cwd: root,
      encoding: 'utf8',
    })
    const scopes = JSON.parse(output) as Record<string, { npmMinimalAgeGate?: number, npmRegistryServer?: string }>
    assert.equal(scopes['open-mercato']?.npmRegistryServer, 'http://localhost:4874')
    assert.equal(scopes['open-mercato']?.npmMinimalAgeGate, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
