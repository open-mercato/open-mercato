import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildRegistryConfig } from '../index.ts'

test('custom registries exempt exact Open Mercato packages from the release age quarantine', () => {
  const config = buildRegistryConfig('http://localhost:4874')

  assert.match(config, /npmScopes:\n  open-mercato:\n    npmRegistryServer: "http:\/\/localhost:4874"\n    npmMinimalAgeGate: 0/)
  assert.match(config, /unsafeHttpWhitelist:\n  - "localhost"\n  - "host\.docker\.internal"/)
})

test('custom registry config is accepted by the scaffolded Yarn version', () => {
  const root = mkdtempSync(join(tmpdir(), 'create-mercato-app-registry-config-'))
  try {
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
