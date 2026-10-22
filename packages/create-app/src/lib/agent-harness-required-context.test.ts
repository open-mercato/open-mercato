import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createResolver } from '../../../cli/src/lib/resolver.js'
import { discoverLocalReferenceModuleSource, discoverPackageModuleSources } from '../../../cli/src/lib/generators/module-facts-discovery.js'
import { extractLocalReferenceModuleFacts } from '../../../cli/src/lib/generators/module-facts.js'
import { renderFrameworkExtensionPointsMarkdown } from '../../../cli/src/lib/generators/module-extension-facts.js'
import { applyStarterPreset } from './apply-starter-preset.js'
import { generateCodex } from '../setup/tools/codex.js'
import { enforceRootInstructionBudget, generateShared, injectModuleGuides, readEnabledModuleIds, STANDALONE_ROOT_TARGET_BYTES } from '../setup/tools/shared.js'

type HarnessCase = {
  id: string
  context: { required: string[]; allowedExtra?: string[] }
  requiredSkills: string[]
  maxContextFiles: number
  maxInitialContextBytes: number
  maxTotalContextBytes: number
  expectedRouter?: { required: string[]; allowedExtra?: string[] }
}

test('portal sidebar and notification work includes its actual framework-host facts within measured initial capacity', (context) => {
  const records = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url), 'utf8')) as HarnessCase[]
  const record = records.find(record => record.id === 'OMH-081')
  assert.ok(record)
  const frameworkPath = '.ai/guides/framework-extension-points.md'
  assert.ok(record.context.required.includes(frameworkPath))
  const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
  const available = new Set(discoverPackageModuleSources(createResolver(repositoryRoot)).map(source => source.moduleId))
  const violations: string[] = []
  for (const preset of ['classic', 'crm', 'empty', 'wms']) {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-portal-host-context-'))
    try {
      fs.mkdirSync(path.join(fixture, 'src'))
      fs.mkdirSync(path.join(fixture, '.mercato'))
      fs.copyFileSync(new URL('../../template/src/modules.ts', import.meta.url), path.join(fixture, 'src/modules.ts'))
      applyStarterPreset(preset, fixture)
      const modules = readEnabledModuleIds(path.join(fixture, 'src/modules.ts')).filter(id => available.has(id))
      const config = { targetDir: fixture, projectName: preset }
      generateShared(config)
      injectModuleGuides(path.join(fixture, 'AGENTS.md'), modules)
      generateCodex(config)
      enforceRootInstructionBudget(path.join(fixture, 'AGENTS.md'), modules)
      fs.writeFileSync(path.join(fixture, frameworkPath), renderFrameworkExtensionPointsMarkdown())
      const initial = record.context.required.filter(file => !file.includes('/references/') && !file.startsWith('.ai/guides/modules/'))
      const bytes = initial.reduce((total, file) => total + fs.statSync(path.join(fixture, file)).size, 0)
      const rootBytes = fs.statSync(path.join(fixture, 'AGENTS.md')).size
      const rootBound = bytes - rootBytes + STANDALONE_ROOT_TARGET_BYTES
      assert.ok(initial.length <= record.maxContextFiles)
      if (bytes > record.maxInitialContextBytes || rootBound > record.maxInitialContextBytes) violations.push(`${preset}: ${bytes} initial / ${rootBound} root-bound / ${record.maxInitialContextBytes} ceiling`)
      context.diagnostic(`${preset}: ${bytes} initial bytes; 12KiB root bound ${rootBound}`)
    } finally { fs.rmSync(fixture, { recursive: true, force: true }) }
  }
  assert.deepEqual(violations, [])
  assert.equal(record.maxInitialContextBytes, 57_344)
  assert.equal(record.maxTotalContextBytes, 397_312)
})

test('built-in onboarding keeps its real mandatory initial context within the original ceiling for every preset', (context) => {
  const records = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url), 'utf8')) as HarnessCase[]
  const record = records.find(record => record.id === 'OMH-097')
  assert.ok(record)
  assert.equal(record.maxInitialContextBytes, 66_560)
  assert.equal(record.maxContextFiles, 12)
  assert.equal(record.maxTotalContextBytes, 548_864)
  assert.deepEqual(record.requiredSkills, ['om-module-scaffold', 'om-backend-ui-design', 'om-system-extension', 'om-build-workflow'])
  assert.ok(![...record.requiredSkills, ...record.context.required].some(value => value.includes('om-data-model-design') || value.includes('om-integration-builder')))
  assert.ok(![...(record.expectedRouter?.required ?? []), ...(record.expectedRouter?.allowedExtra ?? [])].includes('integration'))
  const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
  const available = new Set(discoverPackageModuleSources(createResolver(repositoryRoot)).map(source => source.moduleId))
  for (const preset of ['classic', 'crm', 'empty', 'wms']) {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-onboarding-context-'))
    try {
      fs.mkdirSync(path.join(fixture, 'src'))
      fs.mkdirSync(path.join(fixture, '.mercato'))
      fs.copyFileSync(new URL('../../template/src/modules.ts', import.meta.url), path.join(fixture, 'src/modules.ts'))
      applyStarterPreset(preset, fixture)
      const modules = readEnabledModuleIds(path.join(fixture, 'src/modules.ts')).filter(id => available.has(id))
      const config = { targetDir: fixture, projectName: preset }
      generateShared(config)
      injectModuleGuides(path.join(fixture, 'AGENTS.md'), modules)
      generateCodex(config)
      enforceRootInstructionBudget(path.join(fixture, 'AGENTS.md'), modules)
      const initial = record.context.required.filter(file => !file.includes('/references/') && !file.startsWith('.ai/guides/modules/'))
      const bytes = initial.reduce((total, file) => total + fs.statSync(path.join(fixture, file)).size, 0)
      const rootBytes = fs.statSync(path.join(fixture, 'AGENTS.md')).size
      assert.ok(initial.length <= record.maxContextFiles)
      assert.ok(bytes <= record.maxInitialContextBytes)
      assert.ok(rootBytes <= STANDALONE_ROOT_TARGET_BYTES)
      assert.ok(bytes - rootBytes + STANDALONE_ROOT_TARGET_BYTES <= record.maxInitialContextBytes)
      context.diagnostic(`${preset}: ${bytes} initial bytes; 12KiB root bound ${bytes - rootBytes + STANDALONE_ROOT_TARGET_BYTES}`)
    } finally { fs.rmSync(fixture, { recursive: true, force: true }) }
  }
})

test('DataTable extension context includes both mandatory skills within its measured initial ceiling', () => {
  const cases = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url), 'utf8')) as HarnessCase[]
  const record = cases.find(record => record.id === 'OMH-027')
  assert.ok(record)
  const required = [
    'AGENTS.md',
    '.ai/guides/extensions.md',
    '.ai/guides/backend-ui.md',
    '.ai/skills/om-system-extension/SKILL.md',
    '.ai/skills/om-backend-ui-design/SKILL.md',
  ]
  assert.deepEqual([...record.context.required].sort(), [...required].sort())
  for (const skill of record.requiredSkills) {
    assert.ok(record.context.required.includes(`.ai/skills/${skill}/SKILL.md`))
  }
  assert.equal(record.maxContextFiles, 5)
  assert.equal(record.maxInitialContextBytes, 40_960)
  assert.equal(record.maxTotalContextBytes, 98_304)
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-required-context-'))
  try {
    const config = { targetDir: fixture, projectName: 'required-context-fixture' }
    generateShared(config)
    generateCodex(config)
    const bytes = required.reduce((total, file) => total + fs.statSync(path.join(fixture, file)).size, 0)
    const rootBytes = fs.statSync(path.join(fixture, 'AGENTS.md')).size
    assert.ok(bytes <= record.maxInitialContextBytes)
    assert.ok(record.maxInitialContextBytes - bytes <= 8_192)
    assert.ok(bytes - rootBytes + STANDALONE_ROOT_TARGET_BYTES <= record.maxInitialContextBytes)
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})

test('CLI and provider guidance changes preserve existing business-slice initial context ceilings', () => {
  const cases = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url), 'utf8')) as HarnessCase[]
  const affected = ['OMH-082', 'OMH-097', 'OMH-101', 'OMH-103', 'OMH-105', 'OMH-117', 'OMH-118', 'OMH-124', 'OMH-128', 'OMH-130', 'OMH-141', 'OMH-153', 'OMH-155', 'OMH-169']
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-business-context-'))
  try {
    const config = { targetDir: fixture, projectName: 'classic' }
    fs.mkdirSync(path.join(fixture, 'src'))
    fs.copyFileSync(new URL('../../template/src/modules.ts', import.meta.url), path.join(fixture, 'src/modules.ts'))
    const modules = readEnabledModuleIds(path.join(fixture, 'src/modules.ts')).filter(moduleId => moduleId !== 'ratelimit_probe')
    generateShared(config)
    injectModuleGuides(path.join(fixture, 'AGENTS.md'), modules)
    generateCodex(config)
    enforceRootInstructionBudget(path.join(fixture, 'AGENTS.md'), modules)
    const violations: string[] = []
    for (const id of affected) {
      const record = cases.find(record => record.id === id)
      assert.ok(record)
      const declared = [...new Set([...record.context.required, ...(record.context.allowedExtra ?? [])])]
      const initial = declared.filter(file => !file.includes('/references/')
        && !['.ai/framework-context/', '.ai/guides/modules/', '.ai/guides/reference-modules/', '.ai/guides/upstream/', '.agents/skills/'].some(prefix => file.startsWith(prefix)))
      const bytes = initial.reduce((total, file) => total + fs.statSync(path.join(fixture, file)).size, 0)
      if (bytes > record.maxInitialContextBytes) violations.push(`${id}: ${bytes}/${record.maxInitialContextBytes}`)
    }
    assert.deepEqual(violations, [])
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})

test('component replacement preserves its mandatory procedure closure within a bounded total ceiling', (context) => {
  const cases = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url), 'utf8')) as HarnessCase[]
  const record = cases.find(record => record.id === 'OMH-030')
  assert.ok(record)
  const required = [
    'AGENTS.md',
    '.ai/guides/extensions.md',
    '.ai/guides/backend-ui.md',
    '.ai/skills/om-system-extension/SKILL.md',
    '.ai/guides/upstream/BACKWARD_COMPATIBILITY.md',
    '.ai/skills/om-backend-ui-design/SKILL.md',
    '.ai/skills/om-system-extension/references/mechanism-selector.md',
    '.ai/skills/om-system-extension/references/extension-branches.md',
    '.ai/skills/om-system-extension/references/verification.md',
    '.ai/skills/om-backend-ui-design/references/quality-states.md',
  ]
  assert.deepEqual([...record.context.required].sort(), [...required].sort())
  assert.deepEqual([...record.requiredSkills].sort(), ['om-backend-ui-design', 'om-system-extension'])
  assert.deepEqual(record.context.allowedExtra, ['.ai/skills/om-framework-context/SKILL.md'])
  assert.equal(record.maxContextFiles, 6)
  assert.equal(record.maxInitialContextBytes, 49_152)
  assert.equal(record.maxTotalContextBytes, 139_264)
  const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
  const available = new Set(discoverPackageModuleSources(createResolver(repositoryRoot)).map(source => source.moduleId))
  let largestBytes = 0
  for (const preset of ['classic', 'crm', 'empty', 'wms']) {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-replacement-context-'))
    try {
      fs.mkdirSync(path.join(fixture, 'src'))
      fs.mkdirSync(path.join(fixture, '.mercato'))
      fs.copyFileSync(new URL('../../template/src/modules.ts', import.meta.url), path.join(fixture, 'src/modules.ts'))
      applyStarterPreset(preset, fixture)
      const modules = readEnabledModuleIds(path.join(fixture, 'src/modules.ts')).filter(id => available.has(id))
      const config = { targetDir: fixture, projectName: preset }
      generateShared(config)
      injectModuleGuides(path.join(fixture, 'AGENTS.md'), modules)
      generateCodex(config)
      enforceRootInstructionBudget(path.join(fixture, 'AGENTS.md'), modules)
      const upstream = path.join(fixture, '.ai/guides/upstream')
      fs.mkdirSync(upstream, { recursive: true })
      fs.copyFileSync(new URL('../../../../BACKWARD_COMPATIBILITY.md', import.meta.url), path.join(upstream, 'BACKWARD_COMPATIBILITY.md'))
      const declared = [...required, ...(record.context.allowedExtra ?? [])]
      const bytes = declared.reduce((total, file) => total + fs.statSync(path.join(fixture, file)).size, 0)
      const rootBytes = fs.statSync(path.join(fixture, 'AGENTS.md')).size
      assert.ok(record.maxTotalContextBytes - bytes >= 2_048)
      assert.ok(bytes - rootBytes + STANDALONE_ROOT_TARGET_BYTES <= record.maxTotalContextBytes - 1_024)
      largestBytes = Math.max(largestBytes, bytes)
      context.diagnostic(`${preset}: ${bytes} total bytes; 12KiB root bound ${bytes - rootBytes + STANDALONE_ROOT_TARGET_BYTES}`)
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true })
    }
  }
  assert.equal(record.maxTotalContextBytes, Math.ceil((largestBytes + 2_048) / 2_048) * 2_048)
})


test('spec-only stock-transfer authoring fits the smallest complete observable identity and design closure', context => {
  const repository = fileURLToPath(new URL('../../../../', import.meta.url))
  const template = fileURLToPath(new URL('../../template/', import.meta.url))
  const records = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url), 'utf8')) as Array<HarnessCase & {
    context: HarnessCase['context'] & { sourceReferenceIds: string[]; exampleRoots: Array<{ maxFiles: number; maxBytes: number }> }
    allowedWrites: string[]
  }>
  const record = records.find(record => record.id === 'OMH-223')
  assert.ok(record)
  const packageSources = discoverPackageModuleSources(createResolver(repository))
  const available = new Set(packageSources.map(source => source.moduleId))
  const reference = discoverLocalReferenceModuleSource({ appRoot: template, moduleId: 'example' })
  assert.ok(reference)
  const coreVersion = JSON.parse(fs.readFileSync(path.join(repository, 'packages/core/package.json'), 'utf8')).version as string
  const projection = extractLocalReferenceModuleFacts({ packageSources, reference, registryPath: null, coreVersion })
  const tiers = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/skills/tiers.json', import.meta.url), 'utf8'))
  assert.equal(tiers.external.ref, 'c6103c034571f3610323a1b53d97c81abe110b58')
  assert.equal(tiers.external.contentHashes['om-spec-writing'], 'sha256:80d5def47ff844748b1c7407cae8b8ee8588ccdfaee54022e15de885d59fa398')
  const pinnedExternalBytes = new Map([
    ['.agents/skills/om-spec-writing/SKILL.md', 10_886],
    ['.agents/skills/om-spec-writing/references/agentic-setup.md', 2_840],
    ['.agents/skills/om-spec-writing/references/rules.md', 4_385],
  ])
  const indexPath = '.ai/guides/reference-modules/example/index.md'
  const sectionPath = (slug: string) => `.ai/guides/reference-modules/example/${slug}.md`
  const canonical = ['src/modules/example/README.md', 'src/modules/example/references/surface-inventory.json']
  const sourcePaths = ['src/app/globals.css', 'node_modules/@open-mercato/core/src/modules/design_system/gallery/entries/buttons.tsx']
  const required = [...new Set([...record.context.required, '.agents/skills/om-spec-writing/SKILL.md'])]
  const minimum = [...new Set([...required, ...canonical, indexPath, sectionPath('exact-override-targets'), sourcePaths[0]])]
  const complete = [...new Set([...minimum, sourcePaths[1], sectionPath('umes-contributions'), sectionPath('active-extension-bindings'),
    '.agents/skills/om-spec-writing/references/agentic-setup.md', '.agents/skills/om-spec-writing/references/rules.md',
    '.ai/specs/SPEC-000-template.md', '.ai/skills/om-backend-ui-design/references/quality-states.md',
  ])]
  let largestWorst = 0
  for (const preset of ['classic', 'crm', 'empty', 'wms']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-spec-plan-context-'))
    try {
      fs.mkdirSync(path.join(root, 'src'))
      fs.mkdirSync(path.join(root, '.mercato'))
      fs.copyFileSync(path.join(template, 'src/modules.ts'), path.join(root, 'src/modules.ts'))
      applyStarterPreset(preset, root)
      const modules = readEnabledModuleIds(path.join(root, 'src/modules.ts')).filter(id => available.has(id))
      const config = { targetDir: root, projectName: preset }
      generateShared(config)
      injectModuleGuides(path.join(root, 'AGENTS.md'), modules)
      generateCodex(config)
      enforceRootInstructionBudget(path.join(root, 'AGENTS.md'), modules)
      const bytes = (file: string): number => {
        const external = pinnedExternalBytes.get(file)
        if (external !== undefined) return external
        if (file === indexPath) return Buffer.byteLength(projection.directory.index)
        if (file.startsWith('.ai/guides/reference-modules/example/')) {
          const section = projection.directory.sections.find(section => section.slug === path.basename(file, '.md'))
          assert.ok(section, file)
          return Buffer.byteLength(section.markdown)
        }
        if (file.startsWith('src/')) return fs.statSync(path.join(template, file)).size
        if (file.startsWith('node_modules/@open-mercato/core/')) return fs.statSync(path.join(repository, 'packages/core', file.slice('node_modules/@open-mercato/core/'.length))).size
        return fs.statSync(path.join(root, file)).size
      }
      const total = complete.reduce((sum, file) => sum + bytes(file), 0)
      const minimumBytes = minimum.reduce((sum, file) => sum + bytes(file), 0)
      const rootBytes = bytes('AGENTS.md')
      const worst = total - rootBytes + STANDALONE_ROOT_TARGET_BYTES
      assert.ok(minimumBytes > 262_144, `${preset} mandatory minimum ${minimumBytes} must expose the original intrinsic ceiling mismatch`)
      assert.ok(total <= record.maxTotalContextBytes, `${preset} complete required plan uses ${total}/${record.maxTotalContextBytes} bytes`)
      assert.ok(worst <= record.maxTotalContextBytes, `${preset} 12KiB-root plan bound uses ${worst}/${record.maxTotalContextBytes} bytes`)
      assert.ok(record.maxTotalContextBytes - worst >= 2_048)
      const initial = complete.filter(file => !file.includes('/references/') && !file.startsWith('.agents/') && !file.startsWith('.ai/guides/reference-modules/') && !file.startsWith('src/') && !file.startsWith('node_modules/'))
      assert.ok(initial.length <= record.maxContextFiles)
      assert.ok(initial.reduce((sum, file) => sum + bytes(file), 0) - rootBytes + STANDALONE_ROOT_TARGET_BYTES <= record.maxInitialContextBytes)
      assert.ok([...canonical, ...sourcePaths].reduce((sum, file) => sum + bytes(file), 0) <= record.context.exampleRoots[0].maxBytes)
      largestWorst = Math.max(largestWorst, worst)
      context.diagnostic(`${preset}: mandatory minimum ${minimumBytes}; complete ${total}; 12KiB-root bound ${worst}`)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  }
  assert.equal(record.maxTotalContextBytes, Math.ceil((largestWorst + 2_048) / 2_048) * 2_048)
  assert.equal(record.maxInitialContextBytes, 98_304)
  assert.equal(record.maxContextFiles, 16)
  assert.equal(record.context.exampleRoots[0].maxFiles, 10)
  assert.equal(record.context.exampleRoots[0].maxBytes, 245_760)
  assert.equal(record.context.sourceReferenceIds.length, 7)
  assert.deepEqual(record.allowedWrites, ['.ai/specs/**'])
  assert.ok(record.context.required.includes(indexPath))
  assert.ok(!record.context.allowedExtra?.includes(indexPath))
  const facts = projection.entry.facts
  const surfaces = facts.extensionSurfaces
  assert.ok(surfaces)
  const bulk = surfaces.contributions.find(entry => entry.kind === 'data-table' && entry.details?.tableId === 'example.todos.list')
  const workflow = surfaces.contributions.find(entry => entry.kind === 'specialized-registry' && entry.details?.registry === 'workflow')
  assert.ok(bulk && workflow)
  const resolution = surfaces.contributionResolutions.find(entry => entry.contributionId === bulk.id)
  assert.ok(resolution)
  const workers = facts.ownedContracts?.worker ?? []
  const overrides = facts.overrideTargets?.filter(target => target.factRef.factKey === bulk.id || workers.some(worker => worker.id === target.factRef.factKey)) ?? []
  assert.ok(overrides.length >= 3)
  const visible = ['umes-contributions', 'active-extension-bindings', 'exact-override-targets'].map(slug => projection.directory.sections.find(section => section.slug === slug)!.markdown).join('\n')
  for (const identity of [bulk.id, workflow.id, String(workflow.details?.specialistRoute), ...resolution.activationIds, ...workers.map(worker => worker.id), ...overrides.map(target => target.id)]) assert.ok(visible.includes(identity), identity)
  const publicInventory = JSON.parse(fs.readFileSync(path.join(template, canonical[1]), 'utf8'))
  const ownedDesign = JSON.parse(fs.readFileSync(new URL('../../scripts/design-system/design-system-inventory.json', import.meta.url), 'utf8'))
  assert.equal(publicInventory.designFoundation.auditedHeadSha, ownedDesign.inputs.foundationAuditedHeadSha)
  assert.equal(publicInventory.designFoundation.baselineSha, ownedDesign.inputs.foundationBaselineSha)
})
