import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildRegistryConfig } from '../index.ts'

const template = fs.readFileSync(new URL('../../template/.yarnrc.yml.template', import.meta.url), 'utf8')
const release = await import(new URL('../../agentic/shared/scripts/run-agent-harness-release.mjs', import.meta.url).href) as {
  prepareWritableTargets: (input: { root: string; prepareRoot: string; caseIds: string[] }) => { targets: Record<string, string> }
}

function generatedConfig(registry?: string): string {
  return template.replaceAll('{{REGISTRY_CONFIG}}', registry ? buildRegistryConfig(registry) : '')
}

function withController(config: string, run: (controller: string, prepareRoot: string) => void): void {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-generated-yarn-preparation-')))
  const controller = path.join(root, 'controller')
  const prepareRoot = path.join(root, 'targets')
  fs.mkdirSync(path.join(controller, 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(controller, 'package.json'), '{"name":"generated-yarn-config-fixture","private":true}\n')
  fs.writeFileSync(path.join(controller, '.yarnrc.yml'), config)
  try { run(controller, prepareRoot) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

for (const registry of [undefined, 'http://127.0.0.1:63255', 'https://registry.example.com/npm']) {
  test(`canonical target preparation preserves current generated Yarn policy (${registry ?? 'default registry'})`, () => {
    const config = generatedConfig(registry)
    assert.match(config, /^npmMinimalAgeGate: 5d$/m)
    assert.match(config, /^npmPreapprovedPackages:\n  - "@open-mercato\/\*"$/m)
    withController(config, (controller, prepareRoot) => {
      const manifest = release.prepareWritableTargets({ root: controller, prepareRoot, caseIds: ['OMH-009'] })
      const target = manifest.targets['OMH-009']
      assert.equal(fs.readFileSync(path.join(target, '.yarnrc.yml'), 'utf8'), config)
      assert.equal(fs.readFileSync(path.join(controller, '.yarnrc.yml'), 'utf8'), config)
      assert.equal(fs.realpathSync(path.join(target, 'node_modules')), path.join(controller, 'node_modules'))
    })
  })
}

test('canonical target preparation rejects modified policy and executable, unknown, credential or environment-driven Yarn settings', () => {
  const config = generatedConfig('https://registry.example.com/npm')
  const unsafe = [
    config.replace('npmMinimalAgeGate: 5d', 'npmMinimalAgeGate: 0'),
    config.replace('npmMinimalAgeGate: 5d', 'npmMinimalAgeGate: 1d'),
    config.replace('  - "@open-mercato/*"', '  - "*"'),
    config.replace('  - "@open-mercato/*"', '  - "@open-mercato/*"\n  - "third-party/*"'),
    config.replace('  - "@open-mercato/*"', '  - "${PREAPPROVED_PACKAGES}"'),
    config.replace('nodeLinker: node-modules', 'nodeLinker: pnp'),
    config.replace('npmMinimalAgeGate: 5d', 'npmMinimalAgeGate: 5d\nnpmMinimalAgeGate: 0'),
    config.replace('npmMinimalAgeGate: 5d', 'npmMinimalAgeGate: &age 5d'),
    config.replace('npmMinimalAgeGate: 5d', 'npmMinimalAgeGate: !!str 5d'),
    config.replace('npmMinimalAgeGate: 5d', 'npmMinimalAgeGate: 5d # altered value'),
    `${config}\nenableScripts: true\n`,
    `${config}\nyarnPath: "./untrusted-yarn.cjs"\n`,
    `${config}\nplugins:\n  - path: "./plugin.cjs"\n`,
    `${config}\nunknownSetting: true\n`,
    `${config}\nnpmAuthToken: "fixture-auth-token"\n`,
    config.replace('https://registry.example.com/npm', 'https://fixture-user:fixture-auth-token@registry.example.com/npm'),
    config.replace('https://registry.example.com/npm', 'https://registry.example.com/npm?token=fixture-auth-token'),
    config.replace('https://registry.example.com/npm', 'https://registry.example.com/npm#fixture-auth-token'),
    config.replace('https://registry.example.com/npm', 'https://registry.example.com/${REGISTRY_PATH}'),
    config.replace('https://registry.example.com/npm', '${REGISTRY_URL}'),
    config.replace('https://registry.example.com/npm', 'https://${REGISTRY_HOST}/npm'),
    config.replace('    npmMinimalAgeGate: 0', '    npmMinimalAgeGate: 0\n  other-scope:\n    npmRegistryServer: "https://registry.example.com/npm"'),
    `${config}\nunsafeHttpWhitelist:\n  - "*"\n`,
    `${generatedConfig('http://127.0.0.1:63255')}\nunsafeHttpWhitelist:\n  - "unapproved.example.com"\n`,
    `${config}\0`,
    `${config}\n# ${'x'.repeat(16_384)}\n`,
  ]
  for (const candidate of unsafe) {
    withController(candidate, (controller, prepareRoot) => {
      assert.throws(() => release.prepareWritableTargets({ root: controller, prepareRoot, caseIds: ['OMH-009'] }), /unsafe Yarn registry configuration/)
      assert.equal(fs.existsSync(prepareRoot), false)
      assert.equal(fs.readFileSync(path.join(controller, '.yarnrc.yml'), 'utf8'), candidate)
    })
  }
})
