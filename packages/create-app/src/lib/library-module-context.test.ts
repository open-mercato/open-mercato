import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createResolver } from '../../../cli/src/lib/resolver.js'
import { discoverPackageModuleSources } from '../../../cli/src/lib/generators/module-facts-discovery.js'
import { extractAllModuleFacts } from '../../../cli/src/lib/generators/module-facts.js'
import { applyStarterPreset } from './apply-starter-preset.js'
import { generateCodex } from '../setup/tools/codex.js'
import { enforceRootInstructionBudget, generateShared, injectModuleGuides, readEnabledModuleIds, STANDALONE_ROOT_TARGET_BYTES } from '../setup/tools/shared.js'

const repositoryRoot = new URL('../../../../', import.meta.url)
const templateRoot = new URL('../../template/', import.meta.url)
const readAgentic = (relative: string) => fs.readFileSync(new URL(`../../agentic/${relative}`, import.meta.url), 'utf8')
const capabilities = [
  'module.metadata', 'module.acl-features', 'module.setup-role-features',
  'data.entities', 'data.validators', 'data.migrations', 'data.encryption-map', 'data.custom-fields',
  'search.module-config', 'api.crud-query-engine-custom-fields', 'api.openapi',
  'commands.write', 'commands.undo-redo', 'events.crud-indexer-bridge',
  'ui.page-shell', 'ui.datatable', 'ui.form-create', 'ui.form-edit', 'umes.extension-points',
]
const required = [
  'AGENTS.md',
  '.ai/guides/contracts.md',
  '.ai/guides/backend-ui.md',
  '.ai/guides/extensions.md',
  '.ai/skills/om-module-scaffold/SKILL.md',
  '.ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md',
  '.ai/skills/om-module-scaffold/references/api-and-domain.md',
  '.ai/skills/om-module-scaffold/references/module-surfaces.md',
  '.ai/skills/om-data-model-design/SKILL.md',
  '.ai/skills/om-data-model-design/references/integrity-and-concurrency.md',
  '.ai/skills/om-data-model-design/references/sensitive-data.md',
  '.ai/skills/om-backend-ui-design/SKILL.md',
  '.ai/skills/om-backend-ui-design/references/crud-surfaces.md',
  '.ai/skills/om-backend-ui-design/references/page-and-navigation.md',
  '.ai/skills/om-module-scaffold/references/verification.md',
  '.ai/skills/om-system-extension/SKILL.md',
  '.ai/guides/upstream/BACKWARD_COMPATIBILITY.md',
  '.ai/lessons.md',
  '.ai/guides/modules/events/index.md',
  '.ai/guides/modules/query_index/index.md',
  '.ai/guides/modules/search/index.md',
  '.ai/skills/om-data-model-design/references/schema-design.md',
  '.ai/skills/om-data-model-design/references/migration-workflow.md',
  '.ai/skills/om-module-scaffold/references/data-and-migrations.md',
  '.ai/skills/om-backend-ui-design/references/quality-states.md',
  '.ai/skills/om-system-extension/references/mechanism-selector.md',
  '.ai/skills/om-system-extension/references/extension-branches.md',
  '.ai/skills/om-system-extension/references/verification.md',
  '.ai/guides/testing-debugging.md',
  '.ai/skills/om-module-scaffold/references/runtime-cache-and-queues.md',
  'node_modules/@open-mercato/shared/AGENTS.md',
  'src/modules/example/README.md',
]
type LibraryCase = {
  id: string
  context: {
    required: string[]
    allowedExtra: string[]
    forbidden: string[]
    exampleRoots?: Array<{ root: string; entrypoints: string[]; allowedCapabilityIds: string[]; maxFiles: number; maxBytes: number }>
  }
  maxContextFiles: number
  maxInitialContextBytes: number
  maxTotalContextBytes: number
  allowedWrites: string[]
}
const record = (JSON.parse(readAgentic('shared/ai/harness/cases.json')) as LibraryCase[]).find(record => record.id === 'OMH-185')
assert.ok(record)
const inventory = JSON.parse(fs.readFileSync(new URL('src/modules/example/references/surface-inventory.json', templateRoot), 'utf8')) as {
  capabilities: Array<{ capabilityId: string; readStatus: string; sourcePaths: string[] }>
}
const examplePaths = [...new Set([
  'src/modules/example/README.md',
  'src/modules/example/references/surface-inventory.json',
  ...capabilities.flatMap(id => {
    const capability = inventory.capabilities.find(capability => capability.capabilityId === id)
    assert.ok(capability, id)
    assert.equal(capability.readStatus, 'readable', id)
    return capability.sourcePaths
  }),
])].sort()
const initial = (file: string) => !examplePaths.includes(file)
  && !file.includes('/references/')
  && !['.ai/framework-context/', '.ai/guides/modules/', '.ai/guides/reference-modules/', '.ai/guides/upstream/', '.agents/skills/'].some(prefix => file.startsWith(prefix))

test('complete library context fits its real mandatory closure and pinned optional branch in every preset', (context) => {
  const validators = JSON.parse(readAgentic('shared/ai/harness/validators.json'))
  const schema = JSON.parse(readAgentic('shared/ai/harness/cases.schema.json'))
  assert.equal(validators.catalog.maxInitialContextBytes, 98_304)
  assert.equal(schema.items.properties.maxInitialContextBytes.maximum, 98_304)
  const tiers = JSON.parse(readAgentic('shared/ai/skills/tiers.json'))
  assert.equal(tiers.external.ref, 'c6103c034571f3610323a1b53d97c81abe110b58')
  assert.equal(tiers.external.contentHashes['om-integration-tests'], 'sha256:a1385dbb9fe11fe8c7a16dbe8576e44b9e03f34254e5575955d5a6ea862ee741')
  const externalSkillBytes = 13_138
  const sources = discoverPackageModuleSources(createResolver(fileURLToPath(repositoryRoot)))
  const available = new Set(sources.map(source => source.moduleId))
  const coreVersion = JSON.parse(fs.readFileSync(new URL('packages/core/package.json', repositoryRoot), 'utf8')).version as string
  const { directoryByModule } = extractAllModuleFacts({
    sources: sources.filter(source => ['events', 'query_index', 'search'].includes(source.moduleId)),
    registryPath: null,
    coreVersion,
  })
  const declared = [...new Set([...required, ...record.context.allowedExtra])]
  let largestTotalWorst = 0
  for (const preset of ['classic', 'crm', 'empty', 'wms']) {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-library-context-'))
    try {
      fs.mkdirSync(path.join(fixture, 'src'))
      fs.mkdirSync(path.join(fixture, '.mercato'))
      fs.copyFileSync(new URL('src/modules.ts', templateRoot), path.join(fixture, 'src/modules.ts'))
      applyStarterPreset(preset, fixture)
      const modules = readEnabledModuleIds(path.join(fixture, 'src/modules.ts')).filter(id => available.has(id))
      const config = { targetDir: fixture, projectName: preset }
      generateShared(config)
      injectModuleGuides(path.join(fixture, 'AGENTS.md'), modules)
      generateCodex(config)
      enforceRootInstructionBudget(path.join(fixture, 'AGENTS.md'), modules)
      for (const [file, source] of [
        ['.ai/guides/upstream/BACKWARD_COMPATIBILITY.md', new URL('../../../../BACKWARD_COMPATIBILITY.md', import.meta.url)],
        ['node_modules/@open-mercato/shared/AGENTS.md', new URL('../../../shared/AGENTS.md', import.meta.url)],
        ...examplePaths.map(file => [file, new URL(file, templateRoot)] as const),
      ] as const) {
        const destination = path.join(fixture, file)
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        fs.copyFileSync(source, destination)
      }
      for (const id of ['events', 'query_index', 'search']) {
        const destination = path.join(fixture, `.ai/guides/modules/${id}/index.md`)
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        fs.writeFileSync(destination, directoryByModule[id].index)
      }
      const bytes = (files: string[]) => files.reduce((sum, file) => sum + fs.statSync(path.join(fixture, file)).size, 0)
      const initialPaths = declared.filter(initial)
      const initialBytes = bytes(initialPaths)
      const rootBytes = bytes(['AGENTS.md'])
      const initialWorst = initialBytes - rootBytes + STANDALONE_ROOT_TARGET_BYTES
      assert.ok(initialBytes <= record.maxInitialContextBytes, `${preset} declared initial closure uses ${initialBytes}/${record.maxInitialContextBytes} bytes`)
      assert.ok(record.maxInitialContextBytes - initialWorst >= 1_024, `${preset} root-bound initial headroom is ${record.maxInitialContextBytes - initialWorst}/1024 bytes`)
      const closure = [...new Set([...declared, ...examplePaths])]
      const totalBytes = bytes(closure) + externalSkillBytes
      const totalWorst = totalBytes - rootBytes + STANDALONE_ROOT_TARGET_BYTES
      assert.ok(totalBytes <= record.maxTotalContextBytes, `${preset} full declared closure uses ${totalBytes}/${record.maxTotalContextBytes} bytes`)
      assert.ok(record.maxTotalContextBytes - totalWorst >= 2_048)
      largestTotalWorst = Math.max(largestTotalWorst, totalWorst)
      assert.ok(initialPaths.length <= record.maxContextFiles)
      assert.ok(initialPaths.includes('node_modules/@open-mercato/shared/AGENTS.md'))
      context.diagnostic(`${preset}: ${modules.length} facts; initial ${initialBytes}, total ${totalBytes}; 12KiB root bounds ${initialWorst}/${totalWorst}`)
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true })
    }
  }
  assert.deepEqual([...record.context.required].sort(), [...required].sort())
  assert.equal(record.maxTotalContextBytes, Math.ceil((largestTotalWorst + 2_048) / 2_048) * 2_048)
  assert.equal(record.maxInitialContextBytes, 98_304)
  assert.equal(record.maxContextFiles, 16)
})

test('library reference permission covers every required surface through exact readable capabilities only', () => {
  const validators = JSON.parse(readAgentic('shared/ai/harness/validators.json'))
  assert.ok(validators.catalog.compatibilityRequiredCaseIds.includes('OMH-185'))
  assert.deepEqual(record.context.allowedExtra.filter(file => required.includes(file)), [])
  assert.deepEqual(record.context.exampleRoots, [{
    root: 'src/modules/example',
    entrypoints: ['README.md'],
    allowedCapabilityIds: capabilities,
    maxFiles: 32,
    maxBytes: 262_144,
  }])
  assert.equal(examplePaths.length, 30)
  for (const file of examplePaths) {
    assert.ok(file.startsWith('src/modules/example/'))
    assert.ok(!file.includes('..') && !/[?*]/.test(file))
    assert.ok(fs.lstatSync(new URL(file, templateRoot)).isFile())
  }
  const bytes = examplePaths.reduce((sum, file) => sum + fs.statSync(new URL(file, templateRoot)).size, 0)
  assert.equal(bytes, 254_193)
  assert.ok(bytes <= 262_144)
  assert.ok(!examplePaths.includes('src/modules/example/references/surface-map.md'))
  assert.ok(!examplePaths.some(file => file.includes('/i18n/')))
  assert.deepEqual(record.allowedWrites, ['src/modules/library/**', 'src/modules.ts'])
  assert.deepEqual(record.context.forbidden, ['.env*', '.git/**', '.mercato/generated/**'])
})
