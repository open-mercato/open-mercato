import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildRegistryConfig } from '../index.ts'

const releaseScript = fileURLToPath(new URL('../../agentic/shared/scripts/run-agent-harness-release.mjs', import.meta.url))
const release = await import(pathToFileURL(releaseScript).href) as {
  prepareWritableTargets: (input: { root: string; prepareRoot: string; caseIds: string[] }) => { targets: Record<string, string> }
}
const template = fs.readFileSync(new URL('../../template/.yarnrc.yml.template', import.meta.url), 'utf8')

function withConfig(config: string, check: (controller: string, targets: string) => void): void {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-generated-yarn-')))
  const controller = path.join(parent, 'controller')
  fs.mkdirSync(path.join(controller, 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(controller, 'package.json'), '{}\n')
  fs.writeFileSync(path.join(controller, '.yarnrc.yml'), config)
  try {
    check(controller, path.join(parent, 'targets'))
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
}

test('release target preparation preserves the real generated cooldown and registry policy byte-for-byte', () => {
  for (const registry of ['', 'http://localhost:4874', 'https://registry.example.com/npm']) {
    const config = template.replace('{{REGISTRY_CONFIG}}', registry ? buildRegistryConfig(registry) : '')
    for (const rendered of [config, config.replaceAll('\n', '\r\n')]) {
      withConfig(rendered, (controller, targets) => {
        const manifest = release.prepareWritableTargets({ root: controller, prepareRoot: targets, caseIds: ['OMH-002'] })
        assert.equal(fs.readFileSync(path.join(manifest.targets['OMH-002'], '.yarnrc.yml'), 'utf8'), rendered)
      })
    }
  }
})

test('release target preparation rejects altered generated policy and auth-bearing registry suffixes', () => {
  const generated = template.replace('{{REGISTRY_CONFIG}}', '')
  const unsafeConfigs = [
    `${generated}npmAuthToken: "secret"\n`,
    generated.replace('npmMinimalAgeGate: 5d', 'npmMinimalAgeGate: 0'),
    generated.replace('  - "@open-mercato/*"', '  - "*"'),
    `${generated}${buildRegistryConfig('https://user:secret@registry.example.com')}\n`,
    `${generated}${buildRegistryConfig('https://registry.example.com?token=secret')}\n`,
  ]
  for (const config of unsafeConfigs) {
    withConfig(config, (controller, targets) => {
      assert.throws(() => release.prepareWritableTargets({ root: controller, prepareRoot: targets, caseIds: ['OMH-002'] }), /unsafe Yarn registry configuration/)
      assert.equal(fs.existsSync(targets), false)
    })
  }
})
