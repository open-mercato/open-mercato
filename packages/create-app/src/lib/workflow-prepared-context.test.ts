import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const frameworkScript = path.join(packageRoot, 'agentic/shared/scripts/framework-context.mjs')
const required = [
  'AGENTS.md',
  '.ai/guides/ai-workflows.md',
  '.ai/skills/om-build-workflow/SKILL.md',
  '.ai/guides/modules/workflows/index.md',
  '.ai/skills/om-build-workflow/references/activity-contracts.md',
]
const frameworkBranch = [
  '.ai/guides/framework-contracts.md',
  '.ai/skills/om-framework-context/SKILL.md',
  '.ai/skills/om-framework-context/references/resolver-procedure.md',
]
type Request = { module?: string; package?: string; query: string }
type Instruction = { kind: string; materializedPath?: string }
type PreparedContext = {
  package: { name: string; version: string }
  module: string | null
  installedPackages: {
    cohort: Array<{ name: string; version: string }>
    duplicates: Array<{ name: string; installations: Array<{ version: string }> }>
  }
  instructions: Instruction[]
  manifest: string
  searchResult: string
  materializedSource: string
  boundedSearch: { status: string; truncated: boolean }
}
type WorkflowCase = {
  id: string
  context: { required: string[]; allowedExtra: string[] }
  requiredSkills: string[]
  frameworkContext: Request[]
  maxContextFiles: number
  maxInitialContextBytes: number
  maxTotalContextBytes: number
  requiredDecisions: string[]
  allowedWrites: string[]
  oracle: { expectedArtifacts: string[] }
}
const records = JSON.parse(fs.readFileSync(path.join(packageRoot, 'agentic/shared/ai/harness/cases.json'), 'utf8')) as WorkflowCase[]
const record = records.find(record => record.id === 'OMH-054')
assert.ok(record)

function copy(source: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
}

function matchingPublishedSources(directory: string, query: string): string[] {
  const matches: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['__tests__', '__integration__'].includes(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue
    const source = path.join(directory, entry.name)
    if (entry.isDirectory()) matches.push(...matchingPublishedSources(source, query))
    else if (entry.isFile() && fs.readFileSync(source).includes(Buffer.from(query))) matches.push(source)
  }
  return matches.sort()
}

function installSourceFixtures(fixture: string): void {
  const packages = path.join(repositoryRoot, 'packages')
  const appManifest = JSON.parse(fs.readFileSync(path.join(fixture, 'package.json'), 'utf8'))
  const installedNames = new Set(Object.keys({ ...appManifest.dependencies, ...appManifest.devDependencies, ...appManifest.optionalDependencies }))
  for (const entry of fs.readdirSync(packages, { withFileTypes: true })) {
    const manifestPath = path.join(packages, entry.name, 'package.json')
    if (!entry.isDirectory() || !fs.existsSync(manifestPath)) continue
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { name?: string; version?: string }
    if (!manifest.name?.startsWith('@open-mercato/') || !installedNames.has(manifest.name)) continue
    const installed = path.join(fixture, 'node_modules', manifest.name)
    fs.mkdirSync(installed, { recursive: true })
    fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ name: manifest.name, version: manifest.version, main: './index.js' }))
    fs.writeFileSync(path.join(installed, 'index.js'), '')
  }
  for (const [name, sourceDirectory, query] of [
    ['core', 'src/modules/workflows', 'CodeWorkflowDefinition'],
    ['shared', 'src', 'interface CodeWorkflowDefinition'],
  ]) {
    const sourcePackage = path.join(packages, name)
    const sourceRoot = path.join(sourcePackage, sourceDirectory)
    const installed = path.join(fixture, 'node_modules/@open-mercato', name)
    for (const source of matchingPublishedSources(sourceRoot, query)) copy(source, path.join(installed, path.relative(sourcePackage, source)))
    let cursor = sourceRoot
    while (cursor.startsWith(sourcePackage)) {
      const instruction = path.join(cursor, 'AGENTS.md')
      if (fs.existsSync(instruction)) copy(instruction, path.join(installed, path.relative(sourcePackage, instruction)))
      if (cursor === sourcePackage) break
      cursor = path.dirname(cursor)
    }
  }
}

function prepareEvidence(fixture: string, request: Request) {
  const selector = request.module ? ['--module', request.module] : ['--package', request.package as string]
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'PATHEXT', 'ComSpec']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  const result = spawnSync(process.execPath, [frameworkScript, ...selector, '--query', request.query, '--json'], {
    cwd: fixture,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  })
  assert.equal(result.status, 0, result.stderr)
  const prepared = JSON.parse(result.stdout) as PreparedContext
  assert.equal(prepared.boundedSearch.status, 'matched')
  assert.equal(prepared.boundedSearch.truncated, false)
  const instructions = prepared.instructions.flatMap(instruction => instruction.materializedPath
    ? [{ kind: instruction.kind, materializedPath: instruction.materializedPath }]
    : [])
  const manifest = {
    package: { name: prepared.package.name, version: prepared.package.version },
    module: prepared.module,
    installedPackages: {
      cohort: prepared.installedPackages.cohort.map(({ name, version }) => ({ name, version })),
      duplicates: prepared.installedPackages.duplicates.map(({ name, installations }) => ({ name, installations: installations.map(({ version }) => ({ version })) })),
    },
    materializedSource: prepared.materializedSource,
    instructions,
    boundedSearch: prepared.boundedSearch,
    searchResult: prepared.searchResult,
  }
  fs.writeFileSync(path.join(fixture, prepared.manifest), `${JSON.stringify(manifest, null, 2)}\n`)
  const searchPath = path.join(fixture, prepared.searchResult)
  const search = fs.readFileSync(searchPath, 'utf8').replaceAll(`${fs.realpathSync(fixture)}${path.sep}`, '').replaceAll(path.sep, '/')
  fs.writeFileSync(searchPath, search)
  const sourceFiles = [...new Set(search.split(/\r?\n/).flatMap(line => {
    const match = /^(.+?):\d+:/.exec(line)
    return match ? [match[1]] : []
  }))].sort()
  assert.ok(sourceFiles.length > 0)
  for (const source of sourceFiles) assert.ok(source.startsWith(`${prepared.materializedSource}/`))
  return { instructions, paths: [prepared.manifest, prepared.searchResult, ...instructions.map(instruction => instruction.materializedPath), ...sourceFiles], sourceFiles }
}

function initialContext(file: string): boolean {
  return !file.includes('/references/')
    && !['.ai/framework-context/', '.ai/guides/modules/', '.ai/guides/reference-modules/', '.ai/guides/upstream/', '.agents/skills/'].some(prefix => file.startsWith(prefix))
}

test('classic workflow evidence fits a universal three-root bound without assuming inactive-preset availability', (context) => {
  const sources = discoverPackageModuleSources(createResolver(repositoryRoot))
  const available = new Set(sources.map(source => source.moduleId))
  const coreVersion = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'packages/core/package.json'), 'utf8')).version as string
  const { directoryByModule } = extractAllModuleFacts({ sources, registryPath: null, coreVersion })
  const preset = 'classic'
  const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-workflow-prepared-')))
  try {
    fs.mkdirSync(path.join(fixture, '.mercato'))
    copy(path.join(packageRoot, 'template/src/modules.ts'), path.join(fixture, 'src/modules.ts'))
    applyStarterPreset(preset, fixture)
    const modules = readEnabledModuleIds(path.join(fixture, 'src/modules.ts')).filter(id => available.has(id))
    const config = { targetDir: fixture, projectName: preset }
    generateShared(config)
    injectModuleGuides(path.join(fixture, 'AGENTS.md'), modules)
    generateCodex(config)
    enforceRootInstructionBudget(path.join(fixture, 'AGENTS.md'), modules)
    const appManifest = fs.readFileSync(path.join(packageRoot, 'template/package.json.template'), 'utf8').replaceAll('{{APP_NAME}}', preset).replaceAll('{{PACKAGE_VERSION}}', coreVersion)
    fs.writeFileSync(path.join(fixture, 'package.json'), appManifest)
    copy(path.join(repositoryRoot, 'AGENTS.md'), path.join(fixture, '.ai/guides/upstream/AGENTS.md'))
    copy(path.join(repositoryRoot, 'BACKWARD_COMPATIBILITY.md'), path.join(fixture, '.ai/guides/upstream/BACKWARD_COMPATIBILITY.md'))
    const workflowFact = path.join(fixture, '.ai/guides/modules/workflows/index.md')
    fs.mkdirSync(path.dirname(workflowFact), { recursive: true })
    fs.writeFileSync(workflowFact, directoryByModule.workflows.index)
    installSourceFixtures(fixture)
    const evidence = record.frameworkContext.map(request => prepareEvidence(fixture, request))
    const instructions = evidence.flatMap(entry => entry.instructions)
    assert.equal(instructions.length, 9)
    assert.equal(evidence.flatMap(entry => entry.sourceFiles).length, 6)
    const bytes = (files: string[]) => files.reduce((sum, file) => sum + fs.statSync(path.join(fixture, file)).size, 0)
    const chainBytes = bytes(instructions.map(instruction => instruction.materializedPath))
    assert.ok(chainBytes > 131_072, 'the mandatory prepared instruction chains alone exceed the old total cap')
    const full = [...new Set([...required, ...frameworkBranch, ...evidence.flatMap(entry => entry.paths)])]
    const totalBytes = bytes(full)
    assert.ok(totalBytes <= record.maxTotalContextBytes, `${preset} mandatory prepared closure uses ${totalBytes}/${record.maxTotalContextBytes} bytes`)
    const rootBytes = bytes(['AGENTS.md'])
    const rootCopies = 1 + instructions.filter(instruction => instruction.kind === 'standalone-root').length
    const worst = totalBytes + rootCopies * (STANDALONE_ROOT_TARGET_BYTES - rootBytes)
    assert.ok(record.maxTotalContextBytes - worst >= 2_048)
    assert.equal(record.maxTotalContextBytes, Math.ceil((worst + 2_048) / 2_048) * 2_048)
    for (const branch of [
      [...new Set([...required, ...record.context.allowedExtra])],
      [...required, ...frameworkBranch],
    ]) {
      const initial = branch.filter(initialContext)
      assert.ok(initial.length <= record.maxContextFiles)
      assert.ok(bytes(initial) - rootBytes + STANDALONE_ROOT_TARGET_BYTES <= record.maxInitialContextBytes)
    }
    context.diagnostic(`${preset}: ${totalBytes} total bytes; ${chainBytes} instruction bytes; ${full.length} files; root bound ${worst}`)
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
  assert.deepEqual([...record.context.required].sort(), [...required].sort())
  assert.ok(record.context.allowedExtra.includes('.ai/guides/framework-contracts.md'))
  assert.deepEqual(record.requiredSkills, ['om-build-workflow'])
  assert.deepEqual(record.frameworkContext, [{ module: 'workflows', query: 'CodeWorkflowDefinition' }, { package: '@open-mercato/shared', query: 'interface CodeWorkflowDefinition' }])
  assert.deepEqual(record.requiredDecisions, ['idempotency-outside-rollback', 'call-api'])
  assert.deepEqual(record.allowedWrites, ['src/modules/automation/**'])
  assert.deepEqual(record.oracle.expectedArtifacts, ['src/modules/automation/workflows/call-api.ts'])
  assert.equal(record.maxContextFiles, 5)
  assert.equal(record.maxInitialContextBytes, 40_960)
})
