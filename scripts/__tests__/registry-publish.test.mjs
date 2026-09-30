import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { resolveNodeBundledCli, resolveYarnInvocation } from '../lib/spawn-cli.mjs'
import { listPublishablePackages, registryAuthKey } from '../registry/publish.mjs'

const tempRoots = []

after(() => {
  for (const rootDir of tempRoots) rmSync(rootDir, { recursive: true, force: true })
})

describe('registryAuthKey', () => {
  it('strips the protocol and normalizes the trailing slash', () => {
    assert.equal(registryAuthKey('http://localhost:4873'), 'localhost:4873/')
    assert.equal(registryAuthKey('https://registry.example.com/'), 'registry.example.com/')
  })
})

describe('listPublishablePackages', () => {
  it('lists non-private packages with a manifest, sorted by folder name', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'om-registry-'))
    tempRoots.push(rootDir)
    const writeManifest = (folder, manifest) => {
      mkdirSync(join(rootDir, 'packages', folder), { recursive: true })
      writeFileSync(join(rootDir, 'packages', folder, 'package.json'), JSON.stringify(manifest))
    }
    writeManifest('ui', { name: '@open-mercato/ui', version: '1.0.0' })
    writeManifest('core', { name: '@open-mercato/core', version: '1.0.0' })
    writeManifest('internal', { name: '@open-mercato/internal', version: '1.0.0', private: true })
    mkdirSync(join(rootDir, 'packages', 'no-manifest'), { recursive: true })

    const packages = listPublishablePackages(rootDir)
    assert.deepEqual(
      packages.map(({ name }) => name),
      ['@open-mercato/core', '@open-mercato/ui'],
    )
    assert.ok(packages.every(({ version }) => version === '1.0.0'))
  })
})

describe('spawn-cli', () => {
  it('resolves npm and npx JS entries next to the running Node executable', () => {
    for (const tool of ['npm', 'npx']) {
      const invocation = resolveNodeBundledCli(tool)
      assert.ok(invocation, `${tool} invocation resolved`)
      if (invocation.prefixArgs.length > 0) {
        assert.equal(invocation.command, process.execPath)
        assert.match(invocation.prefixArgs[0], new RegExp(`${tool}-cli\\.js$`))
      } else {
        assert.notEqual(process.platform, 'win32', 'PATH fallback is POSIX-only')
      }
    }
  })

  it('prefers the yarn JS bundle from npm_execpath and rejects .cmd shims', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'om-yarn-'))
    tempRoots.push(rootDir)
    const yarnBundle = join(rootDir, 'yarn.cjs')
    writeFileSync(yarnBundle, '')
    const resolved = resolveYarnInvocation({ env: { npm_execpath: yarnBundle } })
    assert.deepEqual(resolved, { command: process.execPath, prefixArgs: [yarnBundle] })

    const cmdShim = resolveYarnInvocation({ env: { npm_execpath: join(rootDir, 'yarn.cmd') }, platform: 'win32' })
    assert.equal(cmdShim, null, 'a .cmd npm_execpath must never be spawned on win32')
  })
})
