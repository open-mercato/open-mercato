import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  assertPackageModuleFactsOnly,
  assertPortableSourceRoot,
  buildModuleFactCoverageLedger,
  computeModuleSourceFingerprint,
  computeModuleTaxonomyFingerprint,
  extractAllModuleFacts,
  extractLocalReferenceModuleFacts,
  extractModuleFacts,
  renderModuleFactsJson,
  renderReferenceModuleFactsJson,
  toModuleFactsJsonEntry,
  type ModuleFactSource,
} from '../module-facts'
import {
  appendLocalReferenceModuleSource,
  discoverLocalReferenceModuleSource,
} from '../module-facts-discovery'

function findRepoRoot(): string {
  let dir = __dirname
  for (let depth = 0; depth < 10; depth += 1) {
    if (fs.existsSync(path.join(dir, 'packages', 'core', 'src', 'modules'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error('[internal] could not locate repo root from the test directory')
}

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, contents)
}

/**
 * A package-provided module that owns an event, so an app-local contribution targeting it
 * exercises real cross-module correlation instead of a self-contained stub.
 */
function writePackageModule(moduleRoot: string): void {
  writeFile(
    path.join(moduleRoot, 'index.ts'),
    "export const metadata = { name: 'alpha', title: 'Alpha', description: 'Package module' }\n",
  )
  writeFile(
    path.join(moduleRoot, 'events.ts'),
    "export const events = [{ id: 'alpha.thing.created', label: 'Thing Created', entity: 'thing', category: 'crud' }]\n",
  )
  writeFile(
    path.join(moduleRoot, 'acl.ts'),
    "export const features = [{ id: 'alpha.view', title: 'View alpha', module: 'alpha' }]\n",
  )
}

/** An app-local module whose subscriber contributes to the package module's event. */
function writeLocalModule(moduleRoot: string): void {
  writeFile(
    path.join(moduleRoot, 'index.ts'),
    "export const metadata = { name: 'demo_local', title: 'Demo Local', description: 'App-local reference' }\n",
  )
  writeFile(
    path.join(moduleRoot, 'acl.ts'),
    "export const features = [{ id: 'demo_local.view', title: 'View demo', module: 'demo_local' }]\n",
  )
  writeFile(
    path.join(moduleRoot, 'events.ts'),
    "export const events = [{ id: 'demo_local.pinged', label: 'Pinged', entity: 'ping', category: 'crud' }]\n",
  )
  writeFile(
    path.join(moduleRoot, 'subscribers', 'on-alpha-thing.ts'),
    [
      "export const metadata = { event: 'alpha.thing.created', id: 'demo_local:on-alpha-thing', persistent: false }",
      'export default async function handler(): Promise<void> {}',
      '',
    ].join('\n'),
  )
  writeFile(
    path.join(moduleRoot, '__tests__', 'excluded.test.ts'),
    "it('is excluded from the source fingerprint', () => { expect(true).toBe(true) })\n",
  )
}

describe('local-reference module fact emission', () => {
  let tmp: string
  let appRoot: string
  let packageSources: ModuleFactSource[]
  let reference: ModuleFactSource

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'module-facts-local-reference-'))
    appRoot = path.join(tmp, 'app')
    const packageModuleRoot = path.join(appRoot, 'node_modules', '@acme', 'alpha-pkg', 'src', 'modules', 'alpha')
    writePackageModule(packageModuleRoot)
    writeLocalModule(path.join(appRoot, 'src', 'modules', 'demo_local'))
    packageSources = [{
      moduleId: 'alpha',
      moduleRoot: packageModuleRoot,
      from: '@acme/alpha-pkg',
      packageVersion: '1.2.3',
    }]
    const discovered = discoverLocalReferenceModuleSource({ appRoot, moduleId: 'demo_local' })
    if (!discovered) throw new Error('[internal] fixture local module was not discovered')
    reference = discovered
  })

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('discovers the app-local module with portable local-reference provenance', () => {
    expect(reference).toEqual({
      moduleId: 'demo_local',
      moduleRoot: path.join(appRoot, 'src', 'modules', 'demo_local'),
      portableSourceRoot: 'src/modules/demo_local',
      sourceKind: 'local-reference',
    })
    expect(discoverLocalReferenceModuleSource({ appRoot, moduleId: 'absent' })).toBeNull()
  })

  it('leaves the normal package sidecar byte-identical when the reference bundle is produced', () => {
    const before = renderModuleFactsJson(extractAllModuleFacts({ sources: packageSources }).factsByModule)
    extractLocalReferenceModuleFacts({ packageSources, reference })
    const after = renderModuleFactsJson(extractAllModuleFacts({ sources: packageSources }).factsByModule)

    expect(after).toBe(before)
    const parsed = JSON.parse(before) as Record<string, Record<string, unknown>>
    expect(Object.keys(parsed)).toEqual(['alpha'])
    expect(parsed.alpha.sourceRoot).toBe('node_modules/@acme/alpha-pkg/src/modules/alpha')
    // The emitted package entry is a STABLE generated-file contract
    // (BACKWARD_COMPATIBILITY.md §14): this slice may add keys to the reference
    // projection but must add none — including `sourceKind` — to a package entry.
    expect(Object.keys(parsed.alpha)).toEqual([
      'title',
      'description',
      'coreVersion',
      'sourcePackage',
      'sourceVersion',
      'sourceRoot',
      'entities',
      'events',
      'aclFeatures',
      'apiRoutes',
      'diTokens',
      'searchEntities',
      'hostTokens',
      'notifications',
      'cli',
      'backendPages',
      'frontendPages',
      'cliCommands',
      'aiTools',
      'aiAgents',
      'extensionSurfaces',
      'factSources',
      'ownedContracts',
      'overrideTargets',
    ])
  })

  it('resolves the local contribution inside the disposable batch without touching normal output', () => {
    const { entry } = extractLocalReferenceModuleFacts({ packageSources, reference })
    const contribution = entry.facts.extensionSurfaces?.contributions
      .find((candidate) => candidate.id === 'demo_local:on-alpha-thing')
    expect(contribution?.targets).toEqual([
      expect.objectContaining({ id: 'alpha.thing.created', resolution: 'fact-ref' }),
    ])

    const activatedAlpha = extractAllModuleFacts({
      sources: appendLocalReferenceModuleSource(packageSources, reference),
    }).factsByModule.alpha
    const activatedIncoming = activatedAlpha.extensionSurfaces?.incoming ?? []
    expect(activatedIncoming.map((incoming) => incoming.contributionId)).toContain('demo_local:on-alpha-thing')

    const normalAlpha = extractAllModuleFacts({ sources: packageSources }).factsByModule.alpha
    expect(normalAlpha.extensionSurfaces?.incoming ?? []).toEqual([])
  })

  it('matches the disabled reference projection to a fresh activated extraction', () => {
    const { entry } = extractLocalReferenceModuleFacts({ packageSources, reference })
    const activated = extractAllModuleFacts({
      sources: appendLocalReferenceModuleSource(packageSources, reference),
    }).factsByModule.demo_local

    expect(renderModuleFactsJson({ demo_local: activated }))
      .toBe(renderModuleFactsJson({ demo_local: entry.facts }))
    expect(extractAllModuleFacts({ sources: packageSources }).factsByModule.demo_local).toBeUndefined()
  })

  it('emits the reference bundle discriminators and never a node_modules path', () => {
    const { entry, markdown } = extractLocalReferenceModuleFacts({ packageSources, reference })
    expect(entry.moduleId).toBe('demo_local')
    expect(entry.projectionKind).toBe('activated-reference')
    expect(entry.sourceKind).toBe('local-reference')
    expect(entry.runtimeSelected).toBe(false)
    expect(entry.facts.sourceRoot).toBe('src/modules/demo_local')
    expect(entry.facts.sourceKind).toBe('local-reference')
    expect(entry.factCoverage).toEqual(buildModuleFactCoverageLedger())

    const serialized = renderReferenceModuleFactsJson({ demo_local: entry })
    expect(serialized.endsWith('\n')).toBe(true)
    expect(serialized).not.toContain('node_modules')
    expect(JSON.parse(serialized)).toEqual({ demo_local: entry })

    expect(markdown).not.toContain('node_modules')
    for (const target of [...markdown.matchAll(/\]\(\.\.\/\.\.\/\.\.\/([^)#]+)(?:#L\d+)?\)/g)].map((match) => match[1])) {
      expect(target.startsWith('src/modules/demo_local/')).toBe(true)
      expect(fs.existsSync(path.join(appRoot, target))).toBe(true)
    }
  })

  it('states the opt-in boundary and both fingerprints in the reference markdown header', () => {
    const { entry, markdown } = extractLocalReferenceModuleFacts({ packageSources, reference })
    const [heading, stamp, notice, sourceRootLine] = markdown.split('\n')
    expect(heading).toBe('# demo_local — module facts (generated reference projection, do not edit)')
    expect(stamp).toContain('generated from local reference src/modules/demo_local')
    expect(stamp).toContain(entry.sourceFingerprint)
    expect(stamp).toContain(entry.taxonomyFingerprint)
    expect(notice).toContain('not selected by the current runtime')
    expect(notice).toContain('only after opt-in')
    expect(sourceRootLine).toBe('Source root: src/modules/demo_local')

    const packageMarkdown = extractAllModuleFacts({ sources: packageSources }).markdownByModule.alpha
    expect(packageMarkdown.split('\n')[0]).toBe('# alpha — module facts (generated, do not edit)')
    expect(packageMarkdown).toContain('generated from @acme/alpha-pkg 1.2.3')
    expect(packageMarkdown).not.toContain('after opt-in')
  })

  it('rejects a duplicate module id before the local reference is assigned', () => {
    const collidingPackage: ModuleFactSource[] = [
      ...packageSources,
      { moduleId: 'demo_local', moduleRoot: '/somewhere/pkg/src/modules/demo_local', from: '@acme/demo-pkg' },
    ]
    expect(() => appendLocalReferenceModuleSource(collidingPackage, reference))
      .toThrow(/local reference module "demo_local" collides with the module provided by @acme\/demo-pkg/)
    expect(() => extractLocalReferenceModuleFacts({ packageSources: collidingPackage, reference }))
      .toThrow(/collides with the module provided by/)
  })

  it('refuses a reference source that is not declared portable and local', () => {
    expect(() => extractLocalReferenceModuleFacts({
      packageSources,
      reference: { ...reference, sourceKind: undefined },
    })).toThrow(/must declare sourceKind "local-reference"/)
    expect(() => extractLocalReferenceModuleFacts({
      packageSources,
      reference: { ...reference, portableSourceRoot: undefined },
    })).toThrow(/must declare portableSourceRoot/)
    for (const invalid of ['/abs/modules/demo', 'C:/modules/demo', 'src\\modules\\demo', '../modules/demo', '']) {
      expect(() => assertPortableSourceRoot('demo_local', invalid))
        .toThrow(/must be a relative POSIX app path/)
    }
  })

  it('fails the build when an app-local module reaches the normal package output', () => {
    const activated = extractAllModuleFacts({
      sources: appendLocalReferenceModuleSource(packageSources, reference),
    })
    expect(() => assertPackageModuleFactsOnly(activated.factsByModule))
      .toThrow(/must not contain app-local modules: demo_local \(src\/modules\/demo_local\)/)
    expect(() => assertPackageModuleFactsOnly({
      alpha: { ...activated.factsByModule.alpha, sourceRoot: 'src/modules/alpha' },
    })).toThrow(/must not contain app-local modules: alpha \(src\/modules\/alpha\)/)
    expect(() => assertPackageModuleFactsOnly(
      extractAllModuleFacts({ sources: packageSources }).factsByModule,
    )).not.toThrow()
  })

  it('keeps the strict unresolved-target policy for normal output and collects it for the projection', () => {
    const danglingRoot = path.join(appRoot, 'src', 'modules', 'demo_dangling')
    writeLocalModule(danglingRoot)
    writeFile(
      path.join(danglingRoot, 'subscribers', 'on-missing.ts'),
      [
        "export const metadata = { event: 'demo_dangling.never.declared', id: 'demo_dangling:on-missing', persistent: false }",
        'export default async function handler(): Promise<void> {}',
        '',
      ].join('\n'),
    )
    const dangling: ModuleFactSource = {
      moduleId: 'demo_dangling',
      moduleRoot: danglingRoot,
      portableSourceRoot: 'src/modules/demo_dangling',
      sourceKind: 'local-reference',
    }

    expect(() => extractAllModuleFacts({ sources: appendLocalReferenceModuleSource(packageSources, dangling) }))
      .toThrow(/unresolved first-party extension targets: demo_dangling:demo_dangling:on-missing:demo_dangling.never.declared/)

    const { entry, unresolvedTargets } = extractLocalReferenceModuleFacts({
      packageSources,
      reference: dangling,
    })
    expect(unresolvedTargets).toEqual([
      'demo_dangling:demo_dangling:on-missing:demo_dangling.never.declared',
    ])
    expect(entry.facts.extensionSurfaces?.unresolved.map((item) => item.key))
      .toContain('demo_dangling:on-missing:demo_dangling.never.declared')
  })

  it('fingerprints the emitted source tree and the taxonomy independently', () => {
    const first = extractLocalReferenceModuleFacts({ packageSources, reference }).entry
    expect(first.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(first.taxonomyFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(first.sourceFingerprint).not.toBe(first.taxonomyFingerprint)

    const testFilePath = path.join(reference.moduleRoot, '__tests__', 'excluded.test.ts')
    fs.writeFileSync(testFilePath, "it('still excluded', () => { expect(1).toBe(1) })\n")
    expect(computeModuleSourceFingerprint(reference.moduleRoot, 'src/modules/demo_local'))
      .toBe(first.sourceFingerprint)

    const aclPath = path.join(reference.moduleRoot, 'acl.ts')
    const originalAcl = fs.readFileSync(aclPath, 'utf8')
    try {
      fs.writeFileSync(
        aclPath,
        [
          "export const features = [",
          "  { id: 'demo_local.view', title: 'View demo', module: 'demo_local' },",
          "  { id: 'demo_local.manage', title: 'Manage demo', module: 'demo_local' },",
          ']',
          '',
        ].join('\n'),
      )
      const changed = extractLocalReferenceModuleFacts({ packageSources, reference }).entry
      expect(changed.sourceFingerprint).not.toBe(first.sourceFingerprint)
      expect(changed.taxonomyFingerprint).not.toBe(first.taxonomyFingerprint)
      expect(changed.facts.aclFeatures).toEqual(['demo_local.view', 'demo_local.manage'])
    } finally {
      fs.writeFileSync(aclPath, originalAcl)
    }

    const restored = extractLocalReferenceModuleFacts({ packageSources, reference }).entry
    expect(restored.sourceFingerprint).toBe(first.sourceFingerprint)
    expect(restored.taxonomyFingerprint).toBe(first.taxonomyFingerprint)
  })

  it('canonicalizes the taxonomy fingerprint across key and set ordering but not across values', () => {
    const { entry } = extractLocalReferenceModuleFacts({ packageSources, reference })
    const reordered = {
      ...entry.facts,
      aclFeatures: [...entry.facts.aclFeatures].reverse(),
      coreVersion: '99.99.99',
      sourceVersion: 'ignored-by-taxonomy',
    }
    expect(computeModuleTaxonomyFingerprint(reordered)).toBe(entry.taxonomyFingerprint)

    const renamed = { ...entry.facts, aclFeatures: ['demo_local.renamed'] }
    expect(computeModuleTaxonomyFingerprint(renamed)).not.toBe(entry.taxonomyFingerprint)

    const baseline = {
      ...entry.facts,
      apiRoutes: [{ path: '/demo/things', methods: ['GET', 'POST'], sourcePath: 'src/modules/demo_local/api/things/route.ts' }],
    }
    const structurallyReordered = {
      ...entry.facts,
      apiRoutes: [{ sourcePath: 'src/modules/demo_local/api/things/route.ts', methods: ['POST', 'GET'], path: '/demo/things' }],
    }
    expect(computeModuleTaxonomyFingerprint(structurallyReordered)).toBe(computeModuleTaxonomyFingerprint(baseline))
    const methodRemoved = {
      ...entry.facts,
      apiRoutes: [{ path: '/demo/things', methods: ['GET'], sourcePath: 'src/modules/demo_local/api/things/route.ts' }],
    }
    expect(computeModuleTaxonomyFingerprint(methodRemoved)).not.toBe(computeModuleTaxonomyFingerprint(baseline))

    const orderedTarget = entry.facts.overrideTargets.find((target) => target.path.length > 1)
    expect(orderedTarget).toBeDefined()
    const pathReordered = {
      ...entry.facts,
      overrideTargets: entry.facts.overrideTargets.map((target) => target === orderedTarget
        ? { ...target, path: [...target.path].reverse() }
        : target),
    }
    expect(computeModuleTaxonomyFingerprint(pathReordered)).not.toBe(entry.taxonomyFingerprint)

    const movedBetweenSets = { ...entry.facts, aclFeatures: [], notifications: [...entry.facts.aclFeatures] }
    expect(computeModuleTaxonomyFingerprint(movedBetweenSets)).not.toBe(entry.taxonomyFingerprint)
  })
})

describe('local-reference projection of the canonical example module', () => {
  const repoRoot = findRepoRoot()
  const templateRoot = path.join(repoRoot, 'packages', 'create-app', 'template')
  const authoringRoot = path.join(repoRoot, 'apps', 'mercato')

  it('emits every example fact under the portable app-local root', () => {
    const reference = discoverLocalReferenceModuleSource({ appRoot: templateRoot, moduleId: 'example' })
    expect(reference).not.toBeNull()
    const facts = extractModuleFacts({
      moduleId: 'example',
      moduleRoot: reference!.moduleRoot,
      portableSourceRoot: reference!.portableSourceRoot,
      sourceKind: reference!.sourceKind,
    })
    expect(facts.sourceRoot).toBe('src/modules/example')
    expect(facts.sourceKind).toBe('local-reference')

    const serialized = JSON.stringify(toModuleFactsJsonEntry(facts))
    expect(serialized).not.toContain('node_modules')
    for (const sourcePath of [...serialized.matchAll(/"(?:source)?[Pp]ath":"([^"]+\.tsx?)"/g)].map((m) => m[1])) {
      expect(sourcePath.startsWith('src/modules/example/')).toBe(true)
      expect(fs.existsSync(path.join(templateRoot, sourcePath))).toBe(true)
    }
  })

  it('fingerprints the authoring and template example trees identically', () => {
    const authoring = discoverLocalReferenceModuleSource({ appRoot: authoringRoot, moduleId: 'example' })
    const template = discoverLocalReferenceModuleSource({ appRoot: templateRoot, moduleId: 'example' })
    expect(authoring).not.toBeNull()
    expect(template).not.toBeNull()
    expect(computeModuleSourceFingerprint(authoring!.moduleRoot, 'src/modules/example'))
      .toBe(computeModuleSourceFingerprint(template!.moduleRoot, 'src/modules/example'))
  })
})
