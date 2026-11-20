import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CrudFormSectionServerModule } from '@open-mercato/shared/modules/form-sections'
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { registerCrudFormSectionClientRegistry, type CrudFormSectionClientRegistry } from '@open-mercato/shared/lib/crud/form-sections/client-registry'
import { computeCrudFormSectionClientFingerprint, crudFormSectionHostKey } from '@open-mercato/shared/lib/crud/form-sections/composition'
import { buildCrudFormSectionManifest } from '@open-mercato/shared/lib/crud/form-sections/manifest'
import { encodeCurrentCrudFormSectionPolicyToken } from '@open-mercato/shared/lib/crud/form-sections/policy-token'
import { loadCrudFormSectionComposition, selectCrudFormSectionComposition } from '../../../../../ui/src/backend/injection/crud-form-section-composition'
import { projectCrudFormSectionCustomFields } from '../../../../../ui/src/backend/injection/crud-form-section-custom-fields'
import { projectCrudFormSectionSubmission } from '../../../../../ui/src/backend/injection/crud-form-section-submission'
import { fixtureGuards } from '../../../../../../.ai/qa/fixtures/crudform-section-policy/parity/parity-authority'
import type { ModuleEntry, PackageResolver } from '../../resolver'
import { generateModuleRegistries, generateModuleRegistryApp } from '../module-registry'
import { generatedDerivedCrudRouteIndex, readDerivedCrudFormSectionRouteIndex } from '../form-sections'

jest.mock('@open-mercato/ui/backend/crud-form-extensions', () =>
  jest.requireActual('../../../../../ui/src/backend/crud-form-extensions'), { virtual: true })
jest.mock('@open-mercato/ui/backend/crud-form-field-granular', () =>
  jest.requireActual('../../../../../ui/src/backend/crud-form-field-granular'), { virtual: true })
jest.mock('@open-mercato/ui/backend/injection/crud-form-section-runtime', () =>
  jest.requireActual('../../../../../ui/src/backend/injection/crud-form-section-runtime'), { virtual: true })

let root: string

function write(relativePath: string, source: string): void {
  const target = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, source)
}

function resolver(enabled: ModuleEntry[], standalone = false): PackageResolver {
  const packageRoot = path.join(root, 'package')
  const appRoot = path.join(root, 'app')
  const output = path.join(appRoot, '.mercato', 'generated')
  return {
    isMonorepo: () => !standalone,
    getRootDir: () => root,
    getAppDir: () => appRoot,
    getOutputDir: () => output,
    getModulesConfigPath: () => path.join(appRoot, 'src', 'modules.ts'),
    discoverPackages: () => [],
    loadEnabledModules: () => enabled,
    getModulePaths: ({ id }) => ({
      appBase: path.join(appRoot, 'src', 'modules', id),
      pkgBase: path.join(packageRoot, standalone ? 'dist' : 'src', 'modules', id),
    }),
    getModuleImportBase: ({ id }) => ({
      appBase: `@/modules/${id}`,
      pkgBase: `@open-mercato/core/modules/${id}`,
    }),
    getPackageOutputDir: () => output,
    getPackageRoot: () => packageRoot,
  }
}

function generated(kind: 'facts' | 'runtime'): string {
  return fs.readFileSync(path.join(root, 'app/.mercato/generated', `crud-form-section-${kind}.generated.ts`), 'utf8')
}

function identity(id: string, version = 1): string {
  return JSON.stringify({ id, roundTripId: `${id}@v${version}` })
}

function declaration(
  id: string,
  options: {
    kind?: 'hostFacts' | 'contributionFacts'
    version?: number
    loaderVersion?: number
    loader?: string
    noLoader?: true
    noFact?: true
  } = {},
): string {
  const { kind = 'contributionFacts', version = 1, loaderVersion = version } = options
  const descriptor = { id, roundTripId: `${id}@v${version}` }
  const fact = options.noFact ? '' : JSON.stringify(kind === 'hostFacts' ? descriptor : {
    ...descriptor,
    address: { hostId: 'example.product', formVariant: 'default', formOperation: 'update', sectionId: 'notes' },
    operation: 'add',
    requiredCapabilities: [],
  })
  const loaderIdentity = identity(id, loaderVersion).slice(1, -1)
  const loadExpression = options.loader ?? "lazyCrudFormSectionRuntime(() => import('./descriptor.client'))"
  const loader = options.noLoader ? '' : `{ ${loaderIdentity}, load: ${loadExpression} }`
  return `
import { defineCrudFormSections, lazyCrudFormSectionRuntime } from '@open-mercato/shared/modules/form-sections'
export const crudFormSections = defineCrudFormSections({
  ${kind}: [${fact}],
  runtimes: [${loader}],
})
`
}

function runtime(id: string, version = 1): string {
  return `export const crudFormSectionRuntime = ${identity(id, version)}`
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'crud-form-sections-'))
})

afterEach(() => {
  registerMutationGuards([])
  fs.rmSync(root, { recursive: true, force: true })
})

describe('CrudForm section registry generation', () => {
  it('runs equivalent handwritten and wrapper registries through the manifest and browser projection', async () => {
    const testRoot = root
    const fixtureSource = path.resolve(__dirname, '../../../../../../.ai/qa/fixtures/crudform-section-policy')
    const moduleId = 'form_policy_fixture'
    const address = { hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update' } as const
    const host = { hostResourceKind: 'form_policy_fixture.record', hostResourceId: 'fixture-record' }
    const identity = { ...address, resourceId: host.hostResourceId }
    const policyKey = crudFormSectionHostKey(address)
    const outputDir = 'app/.mercato/generated'
    fs.symlinkSync(path.resolve(__dirname, '../../../../../../node_modules'), path.join(testRoot, 'node_modules'), 'dir')

    async function run(variant: 'wrapper' | 'handwritten') {
      root = path.join(testRoot, variant)
      const moduleDir = path.join(root, 'app/src/modules', moduleId)
      fs.cpSync(path.join(fixtureSource, 'src/modules', moduleId), moduleDir, { recursive: true })
      const alternate = path.join(fixtureSource, 'parity')
      fs.copyFileSync(path.join(alternate, `${variant}.form-sections.ts`), path.join(moduleDir, 'form-sections.ts'))
      fs.copyFileSync(path.join(alternate, 'parity-authority.ts'), path.join(moduleDir, 'parity-authority.ts'))
      for (const part of ['details', 'display', 'hide']) {
        const filename = `parity-${part}.client.ts`
        fs.copyFileSync(path.join(alternate, filename), path.join(moduleDir, 'runtime', filename))
      }
      fs.rmSync(path.join(moduleDir, 'form-sections.runtime-revisions.json'))
      await generateModuleRegistries({ resolver: resolver([{ id: moduleId, from: '@app' }]), quiet: true })
      expect(generated('runtime')).toContain('"position": "before" as InjectionPosition')
      const server: { crudFormSectionServerModules: readonly CrudFormSectionServerModule[] } =
        require(path.join(root, outputDir, 'crud-form-section-facts.generated.ts'))
      const browser: {
        crudFormSectionClientHostFacts: CrudFormSectionClientRegistry['hostFacts']
        crudFormSectionRuntimeEntries: CrudFormSectionClientRegistry['runtimeEntries']
        crudFormSectionContributedOverrides: CrudFormSectionClientRegistry['contributedOverrides']
      } = require(path.join(root, outputDir, 'crud-form-section-runtime.generated.ts'))
      const modules = server.crudFormSectionServerModules
      registerMutationGuards([{ moduleId, guards: fixtureGuards(variant === 'handwritten') }])
      const manifest = buildCrudFormSectionManifest(modules)
      const policy = manifest.policies.get(policyKey)
      expect(policy).toBeDefined()
      if (!policy) throw new Error('[internal] Generated fixture policy was not accepted')
      const registry = {
        hostFacts: browser.crudFormSectionClientHostFacts,
        runtimeEntries: browser.crudFormSectionRuntimeEntries,
        contributedOverrides: browser.crudFormSectionContributedOverrides,
      }
      registerCrudFormSectionClientRegistry(registry)
      const composition = selectCrudFormSectionComposition(registry, identity)
      if (!composition) throw new Error('[internal] Generated fixture client composition was not selected')
      const runtime = await loadCrudFormSectionComposition<Record<string, unknown>, Record<string, unknown>>(
        composition, ['details', 'private'], undefined,
      )
      if (!runtime) throw new Error('[internal] Generated fixture client runtime was not accepted')
      const { surface } = composition
      const { descriptors, identities } = runtime
      const clientFingerprint = await computeCrudFormSectionClientFingerprint(surface, identities, composition.overrides)
      expect(clientFingerprint).toBe(policy.clientFingerprint)
      const entityId = 'form_policy_fixture:record'
      const customFields = projectCrudFormSectionCustomFields({
        surface, descriptors, entityIds: [entityId], definitionSets: { 'form_policy_fixture.region-v1': [entityId] },
        definitions: [{ key: 'region', kind: 'text', formEditable: true, entityId }],
      })
      const projection = projectCrudFormSectionSubmission({
        values: { displayName: '  replacement  ', privateCode: 'omitted', cf_region: 'north' },
        surface, descriptors, customFields, bareCustomFields: false,
      })
      const invalid = projectCrudFormSectionSubmission({
        values: { displayName: ' ', cf_region: 'north' },
        surface, descriptors, customFields, bareCustomFields: false,
      })
      return { manifest, policy, projection, invalid, descriptors, modules, surface, identities, composition }
    }

    try {
      const handwritten = await run('handwritten')
      const wrapper = await run('wrapper')
      expect(handwritten.manifest.ledger).toEqual(wrapper.manifest.ledger)
      expect(handwritten.policy.clientFingerprint).toBe(wrapper.policy.clientFingerprint)
      expect(handwritten.policy.capabilities.map(({ fact }) => fact)).toEqual(wrapper.policy.capabilities.map(({ fact }) => fact))
      expect(handwritten.policy.capabilities.map(({ source }) => source.kind)).not.toEqual(wrapper.policy.capabilities.map(({ source }) => source.kind))
      expect(handwritten.policy.requiredLeaves).toEqual(wrapper.policy.requiredLeaves)
      expect(wrapper.policy.requiredLeaves).toContainEqual(expect.objectContaining({ payloadPath: 'privateCode', mode: 'preserve-from-record' }))
      expect(handwritten.projection).toEqual(wrapper.projection)
      expect(wrapper.projection).toEqual({
        state: 'ready', payload: { name: 'replacement', customFields: { region: 'north' } },
        activeValues: { displayName: '  replacement  ', cf_region: 'north' },
      })
      expect(wrapper.invalid).toEqual(handwritten.invalid)
      expect(wrapper.invalid).toEqual({ state: 'invalid', fieldErrors: { displayName: 'form_policy_fixture.validation.name' } })
      expect(wrapper.descriptors.map(({ id }) => id)).toEqual(handwritten.descriptors.map(({ id }) => id))
      expect(wrapper.descriptors.map(({ group }) => group.id)).toEqual(['display', 'details'])
      expect(wrapper.descriptors[0].group.title).toBe(handwritten.descriptors[0].group.title)

      const scoped = buildCrudFormSectionManifest(wrapper.modules.map(({ moduleId: id, sections }) => ({
        moduleId: id, sections: {
          ...sections, hostProviders: sections.hostProviders?.map((provider) => ({
            ...provider, requireFeatures: [...provider.requireFeatures, 'form_policy_fixture.restricted'],
          })),
        },
      })))
      const scopedPolicy = scoped.policies.get(policyKey)!
      expect(scopedPolicy.requireFeatures).toContain('form_policy_fixture.restricted')
      expect(scoped.ledger.fingerprint).not.toBe(wrapper.manifest.ledger.fingerprint)
      expect(encodeCurrentCrudFormSectionPolicyToken({ address, host, policy: scopedPolicy, fingerprint: scoped.ledger.fingerprint }))
        .not.toBe(encodeCurrentCrudFormSectionPolicyToken({ address, host, policy: wrapper.policy, fingerprint: wrapper.manifest.ledger.fingerprint }))
      const routes = wrapper.surface.clientMutationSurfaces!
      const shifted = routes.map(({ guardedFacade, ...route }) => ({
        ...route, guardedFacade: { ...guardedFacade, routePattern: '/form-policy-fixture/alternate/section-policy' },
      }))
      expect(await computeCrudFormSectionClientFingerprint(
        { ...wrapper.surface, clientMutationSurfaces: shifted }, wrapper.identities, wrapper.composition.overrides,
      )).not.toBe(wrapper.policy.clientFingerprint)
    } finally {
      root = testRoot
    }
  })

  it('generates matching fact and lazy runtime registries from the reusable non-production fixture', async () => {
    const fixtureSource = path.resolve(__dirname, '../../../../../../.ai/qa/fixtures/crudform-section-policy/src/modules/form_policy_fixture')
    const fixtureDestination = path.join(root, 'app/src/modules/form_policy_fixture')
    fs.cpSync(fixtureSource, fixtureDestination, { recursive: true })
    const generatedFixture = await generateModuleRegistries({
      resolver: resolver([{ id: 'form_policy_fixture', from: '@app' }]), quiet: true,
    })
    expect(generatedFixture.flatMap(({ filesWritten }) => filesWritten).some((file) =>
      file.endsWith('form-sections.runtime-revisions.json'))).toBe(false)

    const facts = generated('facts')
    const browser = generated('runtime')
    expect(facts).toContain('form_policy_fixture/form-sections')
    expect(facts.match(/fact: sections0\.(?:hostFacts|contributionFacts)\[\d+\]/g)).toHaveLength(5)
    expect(browser.match(/load: \(\) => import\(/g)).toHaveLength(5)
    expect(browser).toContain('form_policy_fixture.hide-uncovered@v1')
    expect(browser).toContain('form_policy_fixture.record')
    expect(browser).not.toContain('form_policy_fixture/form-sections')
  })

  it('keeps server imports isolated, follows dependency order and excludes disabled modules', async () => {
    const packageModule = 'package/src/modules/shared_forms'
    const dependent = 'app/src/modules/alpha_forms'
    write(`${packageModule}/form-sections.ts`, declaration('shared.product', { kind: 'hostFacts' }))
    write(`${packageModule}/descriptor.client.tsx`, runtime('shared.product'))
    write(`${dependent}/index.ts`, "export const metadata = { requires: ['shared_forms'] }")
    write(`${dependent}/form-sections.ts`, declaration('alpha.notes'))
    write(`${dependent}/descriptor.client.ts`, runtime('alpha.notes'))
    write('app/src/modules/disabled/form-sections.ts', 'export const crudFormSections = invalid()')
    const fixture = resolver([{ id: 'alpha_forms', from: '@app' }, { id: 'shared_forms' }])
    await generateModuleRegistries({ resolver: fixture, quiet: true })

    const facts = generated('facts')
    expect(facts).toContain('from "@open-mercato/core/modules/shared_forms/form-sections"')
    expect(facts).toContain('from "../../src/modules/alpha_forms/form-sections"')
    expect(facts).toContain('fact: sections0.hostFacts[0]')
    expect(facts).toContain('fact: sections1.contributionFacts[0]')
    expect(facts).not.toMatch(/descriptor\.client|disabled/)

    const browser = generated('runtime')
    expect(browser).toContain('load: () => import("@open-mercato/core/modules/shared_forms/descriptor.client")')
    expect(browser).toContain('load: () => import("../../src/modules/alpha_forms/descriptor.client")')
    expect(browser).toContain('return runtimesById.get(id)')
    expect(browser.indexOf('id: "shared.product"')).toBeLessThan(browser.indexOf('id: "alpha.notes"'))
    expect(browser).not.toMatch(/\/form-sections"|disabled/)
    const secondRun = await generateModuleRegistries({ resolver: fixture, quiet: true })
    expect(secondRun.flatMap((result) => result.filesWritten)).toEqual([])
  })

  it('records normalized runtime semantics and requires an advancing handwritten revision for each kind of drift', async () => {
    const base = 'app/src/modules/test'
    const descriptorId = 'test.notes'
    const runtimeFile = `${base}/descriptor.client.tsx`
    const declarationFile = `${base}/form-sections.ts`
    const ledgerFile = path.join(root, base, 'form-sections.runtime-revisions.json')
    const generate = (enabled = true) => generateModuleRegistryApp({
      resolver: resolver(enabled ? [{ id: 'test', from: '@app' }] : []), quiet: true,
    })
    const baseline = `
      import { normalize } from './helper'
      export const crudFormSectionRuntime = {
        id: 'test.notes', roundTripId: 'test.notes@v1',
        group: { id: 'notes', component: ({ runSectionMutation }) => <p>Notes</p> },
        ownedFieldPaths: ['note'],
        ownedCustomFieldIds: ['extra'],
        validate: () => normalize('raw'),
        projectPayload: () => ({ note: true }),
        requiredSectionIds: ['details'],
        requiredDataContractIds: ['loader'],
        providedDataContractIds: ['summary'],
        mutationSurfaceIds: ['save'],
        compositionValidator: () => ({ success: true }),
      }
    `
    write(declarationFile, declaration(descriptorId))
    write(runtimeFile, baseline)
    write(`${base}/helper.ts`, 'export const normalize = (value) => value.trim()')
    await generate()
    const ledger = fs.readFileSync(ledgerFile, 'utf8')
    expect(JSON.parse(ledger)).toMatchObject({ [descriptorId]: { roundTripId: 'test.notes@v1' } })

    write(runtimeFile, baseline.replace("'notes', component", '"notes", /* documentation */ component')
      .replace("['note']", "[ 'note', ]").replace('}\n    ', '};\n    '))
    expect((await generate()).filesWritten).toEqual([])
    for (const [before, after] of [
      ['>Notes<', '>Notes and details<'],
      ['>Notes<', '> Notes<'],
      ["['note']", "['other']"],
      ["['extra']", "['other']"],
      ["normalize('raw')", "normalize('updated')"],
      ['note: true', 'note: false'],
      ["['details']", "['settings']"],
      ["['loader']", "['reader']"],
      ["['summary']", "['report']"],
      ["['save']", "['archive']"],
      ['success: true', 'success: false'],
    ]) {
      write(runtimeFile, baseline.replace(before, after))
      await expect(generate()).rejects.toThrow(/semantic runtime drift.*requires advancing roundTripId/)
      expect(fs.readFileSync(ledgerFile, 'utf8')).toBe(ledger)
    }
    write(runtimeFile, baseline)
    write(declarationFile, declaration(descriptorId).replace('"operation":"add"', '"operation":"replace"'))
    await expect(generate()).rejects.toThrow(/semantic runtime drift/)
    write(declarationFile, declaration(descriptorId))
    write(`${base}/helper.ts`, 'export const normalize = (value) => value.toUpperCase()')
    await expect(generate()).rejects.toThrow(/semantic runtime drift/)
    await generate(false)
    expect(fs.readFileSync(ledgerFile, 'utf8')).toBe(ledger)
    await expect(generate()).rejects.toThrow(/semantic runtime drift/)
    write(declarationFile, declaration(descriptorId, { version: 2 }))
    write(runtimeFile, baseline.replace('test.notes@v1', 'test.notes@v2'))
    await generate()
    expect(JSON.parse(fs.readFileSync(ledgerFile, 'utf8'))).toMatchObject({ [descriptorId]: { roundTripId: 'test.notes@v2' } })
    expect((await generate()).filesWritten).toEqual([])
    write(declarationFile, declaration(descriptorId))
    write(runtimeFile, baseline)
    await expect(generate()).rejects.toThrow(/requires advancing roundTripId beyond "test.notes@v2"/)
  })

  it('treats only the omitted and explicit false granular mandatory flag as revision-equivalent', async () => {
    const base = 'app/src/modules/test'
    const descriptorId = 'test.notes'
    const runtimePath = `${base}/descriptor.client.ts`
    const declarationPath = `${base}/form-sections.ts`
    const generate = () => generateModuleRegistryApp({
      resolver: resolver([{ id: 'test', from: '@app' }]), quiet: true,
    })
    const source = (version: number, flag = '', paths = "['name', 'note']", check = 'null') => `
      import { defineCrudFormFieldGranularSection } from '@open-mercato/ui/backend/crud-form-field-granular'
      export const crudFormSectionRuntime = defineCrudFormFieldGranularSection({
        id: 'test.notes', roundTripId: 'test.notes@v${version}',
        refinements: [{ id: 'filled', fieldPaths: ${paths}, ${flag} check: () => ${check} }] as const,
      })
    `
    write(declarationPath, declaration(descriptorId))
    write(runtimePath, source(1))
    await generate()
    write(runtimePath, source(1, 'mandatory: false,'))
    expect((await generate()).filesWritten).toEqual([])
    for (const changed of [
      source(1, 'mandatory: true,'),
      source(1, '', "['note', 'name']"),
      source(1, '', "['name', 'note']", "({ note: 'error.note' })"),
    ]) {
      write(runtimePath, changed)
      await expect(generate()).rejects.toThrow(/semantic runtime drift.*requires advancing roundTripId/)
    }
    write(declarationPath, declaration(descriptorId, { version: 2 }))
    write(runtimePath, source(2, 'mandatory: true,'))
    await generate()
    expect((await generate()).filesWritten).toEqual([])
  })

  it('exposes only literal host surface facts to the browser registry', async () => {
    const base = 'app/src/modules/example'
    write(`${base}/form-sections.ts`, `
      import { defineCrudFormSections, lazyCrudFormSectionRuntime } from '@open-mercato/shared/modules/form-sections'
      export const crudFormSections = defineCrudFormSections({
        hostFacts: [{
          id: 'example.host', roundTripId: 'example.host@v1', hostResourceKind: 'example.todo',
          alternatives: [{ surface: {
            id: 'example.base', hostId: 'example.todo', formVariant: 'default', formOperation: 'update',
            orderedSectionIds: ['details'], callerIds: ['example.page'], contributionIds: [],
            ownershipFacts: [], mutationSurfaceIds: [], dependencies: [],
          }, activeDataContractIds: ['server-contract'] }],
        }],
        hostProviders: [{ hostDescriptorId: 'example.host', requireFeatures: [],
          authorizeHost: async function serverAuthorization() { return null },
        }],
        runtimes: [{ id: 'example.host', roundTripId: 'example.host@v1',
          load: lazyCrudFormSectionRuntime(() => import('./descriptor.client')),
        }],
      })
    `)
    write(`${base}/descriptor.client.ts`, runtime('example.host'))
    await generateModuleRegistryApp({ resolver: resolver([{ id: 'example', from: '@app' }]), quiet: true })

    expect(generated('facts')).toContain('crudFormSectionServerModules')
    expect(generated('runtime')).toContain('crudFormSectionClientHostFacts')
    expect(generated('runtime')).toContain('"id": "example.base"')
    expect(generated('runtime')).toContain('"hostResourceKind": "example.todo"')
    expect(generated('runtime')).not.toMatch(/serverAuthorization|server-contract/)
    expect(generated('runtime')).not.toContain('/form-sections"')
  })

  it('discovers a server-only leaf default without a browser descriptor or loader', async () => {
    const onlyDefaults = `
      import { defineCrudFormSections } from '@open-mercato/shared/modules/form-sections'
      export const crudFormSections = defineCrudFormSections({
        leafDefaultProviders: [{
          fact: { id: 'example.code-default', roundTripId: 'example.code-default@v1',
            hostId: 'example.todo', formVariant: 'default', formOperation: 'create', payloadPath: 'code', readsPayloadPaths: [] },
          resolve() { return 'server-default-value' },
        }],
      })
    `
    write('app/src/modules/example/form-sections.ts', onlyDefaults)
    await generateModuleRegistryApp({ resolver: resolver([{ id: 'example', from: '@app' }]), quiet: true })
    expect(generated('facts')).toContain('{ moduleId: "example", sections: sections0 }')
    expect(generated('runtime')).not.toMatch(/code-default|server-default-value|\/form-sections"/)
    write('app/src/modules/other/form-sections.ts', onlyDefaults)
    await expect(generateModuleRegistryApp({
      resolver: resolver([{ id: 'example', from: '@app' }, { id: 'other', from: '@app' }]), quiet: true,
    })).rejects.toThrow(/Duplicate leaf default provider id/)
  })

  it('discovers sink declarations through the server registry and rejects mismatched owners', async () => {
    const sinkDeclaration = `
      export const crudFormSections = defineCrudFormSections({
        sinks: [defineCrudFormSectionSink({
          fact: { id: 'example.brand', roundTripId: 'example.brand@v1', ownerModuleId: 'example', atomicity: 'host-transaction' },
          schema: serverOnlySchema,
          persist: serverOnlyPersistence,
        })],
      })
    `
    const source = 'app/src/modules/example/form-sections.ts'
    write(source, sinkDeclaration)
    await generateModuleRegistryApp({ resolver: resolver([{ id: 'example', from: '@app' }]), quiet: true })
    expect(generated('facts')).toContain('{ moduleId: "example", sections: sections0 }')
    expect(generated('runtime')).not.toMatch(/example.brand|serverOnly|\/form-sections"/)
    write(source, sinkDeclaration.replace("ownerModuleId: 'example'", "ownerModuleId: 'other'"))
    await expect(generateModuleRegistryApp({
      resolver: resolver([{ id: 'example', from: '@app' }]), quiet: true,
    })).rejects.toThrow(/sink "example.brand" must be declared in its owning module/)
  })

  it('reads standalone npm dist .js declarations and runtime exports without a source mirror', async () => {
    const base = 'package/dist/modules/installed'
    write(`${base}/form-sections.js`, declaration('installed.notes')
      .replace('export const crudFormSections', 'const crudFormSections')
      .replace('./descriptor.client', './descriptor.client.js') + '\nexport { crudFormSections }\n')
    write(`${base}/descriptor.client.js`, runtime('installed.notes')
      .replace('export const crudFormSectionRuntime', 'const descriptor') + '\nexport { descriptor as crudFormSectionRuntime }\n')
    await generateModuleRegistryApp({ resolver: resolver([{ id: 'installed' }], true), quiet: true })
    expect(generated('facts')).toContain('"@open-mercato/core/modules/installed/form-sections"')
    expect(generated('runtime')).toContain('import("@open-mercato/core/modules/installed/descriptor.client")')
    expect(fs.existsSync(path.join(root, base, 'form-sections.runtime-revisions.json'))).toBe(false)
  })

  it('tracks package source mirror semantics while retaining the compiled loader contract', async () => {
    const source = 'package/src/modules/mirrored'
    const compiled = 'package/dist/modules/mirrored'
    const id = 'mirrored.notes'
    const fixture = resolver([{ id: 'mirrored' }], true)
    const generate = () => generateModuleRegistryApp({ resolver: fixture, quiet: true })
    write(`${source}/form-sections.ts`, declaration(id))
    write(`${source}/descriptor.client.tsx`, runtime(id))
    write(`${compiled}/form-sections.js`, declaration(id))
    write(`${compiled}/descriptor.client.js`, runtime(id))
    await generate()

    expect(fs.existsSync(path.join(root, source, 'form-sections.runtime-revisions.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, compiled, 'form-sections.runtime-revisions.json'))).toBe(false)
    expect(generated('runtime')).toContain('import("@open-mercato/core/modules/mirrored/descriptor.client")')
    write(`${compiled}/descriptor.client.js`, runtime(id, 2))
    await expect(generate()).rejects.toThrow(/loader declares "mirrored.notes@v1"/)
  })

  it.each([
    ['missing loader', { noLoader: true as const }, 1, /fact "test.notes" has no matching runtime loader/],
    ['missing fact', { noFact: true as const }, 1, /runtime loader "test.notes" has no matching fact/],
    ['fact and loader revision mismatch', { loaderVersion: 2 }, 2, /fact and runtime roundTripId differ/],
    ['loaded descriptor revision mismatch', {}, 2, /exports "test.notes@v2" but loader declares "test.notes@v1"/],
    ['non-literal import', { loader: 'lazyCrudFormSectionRuntime(() => import(runtimePath))' }, 1, /expected a non-empty literal runtime import specifier/],
  ])('rejects %s', async (_name, options, runtimeVersion, diagnostic) => {
    const base = 'app/src/modules/test'
    write(`${base}/form-sections.ts`, declaration('test.notes', options))
    write(`${base}/descriptor.client.ts`, runtime('test.notes', runtimeVersion))
    await expect(generateModuleRegistryApp({ resolver: resolver([{ id: 'test', from: '@app' }]), quiet: true })).rejects.toThrow(diagnostic)
  })

  it('extracts named runtime helper identities without importing the client module', async () => {
    write('app/src/modules/example/form-sections.ts', declaration('example.notes'))
    write('app/src/modules/example/descriptor.client.ts', `
      import { defineCrudFormSectionRuntime } from '@open-mercato/ui/backend/injection/crud-form-section-runtime'
      export const crudFormSectionRuntime = defineCrudFormSectionRuntime({
        id: 'example.notes', roundTripId: 'example.notes@v1', group: createClientOnlyGroup(),
      })
    `)
    await generateModuleRegistries({ resolver: resolver([{ id: 'example', from: '@app' }]), quiet: true })
    expect(generated('runtime')).toContain('load: () => import("../../src/modules/example/descriptor.client")')
  })

  it('rejects descriptor ids repeated across enabled modules', async () => {
    for (const moduleId of ['alpha', 'beta']) {
      write(`app/src/modules/${moduleId}/form-sections.ts`, declaration('test.notes'))
      write(`app/src/modules/${moduleId}/descriptor.client.ts`, runtime('test.notes'))
    }
    await expect(generateModuleRegistryApp({
      resolver: resolver([{ id: 'alpha', from: '@app' }, { id: 'beta', from: '@app' }]),
      quiet: true,
    })).rejects.toThrow(/Duplicate form-sections descriptor id "test.notes" in "alpha" and "beta"/)
  })
})

const plainDerivedRoute = `
  import { z } from 'zod'
  import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
  export const crudRoute = makeCrudRoute({
    metadata: {
      POST: { requireAuth: true, requireFeatures: ['example.manage'] },
      PUT: { requireAuth: true },
      DELETE: { requireAuth: true, requireFeatures: ['example.manage'] },
    },
    orm: { entity: ExampleRecord },
    actions: {
      create: { commandId: 'example.records.create', schema: z.object({ name: z.string() }) },
      update: { commandId: 'example.records.update', mapInput: ({ parsed }) => parsed },
      delete: { commandId: 'example.records.delete' },
    },
  })
  export const { metadata, POST, PUT, DELETE } = crudRoute
`

const derivedDeclaration = `
import { defineCrudFormSections, lazyCrudFormSectionRuntime } from '@open-mercato/shared/modules/form-sections'
import { defineCrudRouteSectionHost } from '@open-mercato/shared/lib/crud/form-sections/derived-route-host'
import { crudRoute } from './api/records/route'
export const crudFormSections = defineCrudFormSections({
  hostFacts: [{
    id: 'example.edit-rec', roundTripId: 'example.edit-rec@v1', hostResourceKind: 'example.records',
    alternatives: [{ surface: {
      id: 'example.edit-base', hostId: 'example.record', formVariant: 'default', formOperation: 'update',
      orderedSectionIds: ['details'], callerIds: [], contributionIds: [],
      ownershipFacts: [], mutationSurfaceIds: [], dependencies: [],
    } }],
  }],
  derivedHosts: [defineCrudRouteSectionHost({
    hostId: 'example.record', formVariant: 'default', formOperation: 'update', hostDescriptorId: 'example.edit-rec',
    route: crudRoute, sections: [{ id: 'details', writes: 'parent' }],
    delete: { proof: { finalInput: 'transactional-final-input/v1' } },
  })],
  runtimes: [{ id: 'example.edit-rec', roundTripId: 'example.edit-rec@v1',
    load: lazyCrudFormSectionRuntime(() => import('./descriptor.client')),
  }],
})
`

function writeDerivedFixture(base: string, declarationSource = derivedDeclaration, routeSource = plainDerivedRoute, ext = 'ts'): void {
  write(`${base}/form-sections.${ext}`, declarationSource)
  write(`${base}/api/records/route.${ext}`, routeSource)
  write(`${base}/descriptor.client.${ext}`, runtime('example.edit-rec'))
}

describe('derived CRUD section route generation', () => {
  it('emits one standalone-compatible façade into the static client, runtime, shard and docs route indices', async () => {
    writeDerivedFixture('app/src/modules/example')
    const fixture = resolver([{ id: 'example', from: '@app' }])
    await generateModuleRegistries({ resolver: fixture, quiet: true })
    const [derived] = readDerivedCrudFormSectionRouteIndex(fixture.getOutputDir())
    expect(derived).toMatchObject({ moduleId: 'example', routePath: '/example/records/section-policy', methods: ['DELETE', 'PUT'] })
    const content = fs.readFileSync(path.join(fixture.getOutputDir(), derived.fileName), 'utf8')
    expect(content).toContain('export const PUT = facade.handlers.PUT!')
    expect(content).toContain('export const DELETE = facade.handlers.DELETE!')
    expect(content).not.toContain('export const POST')
    expect(content).toContain('export const openApi = facade.openApi')
    for (const fileName of ['api-routes.generated.ts', 'api-route-metadata.generated.ts', 'modules.runtime.generated.ts']) {
      expect(fs.readFileSync(path.join(fixture.getOutputDir(), fileName), 'utf8')).toContain('/example/records/section-policy')
    }
    const docsIndex = path.join(fixture.getOutputDir(), generatedDerivedCrudRouteIndex)
    expect(fs.readFileSync(docsIndex, 'utf8')).toContain('/example/records/section-policy')
    expect(generated('facts')).toContain('bindDerivedCrudRouteSectionHosts')
    expect(generated('runtime')).toContain('"example.edit-rec.update"')
    expect(generated('runtime')).toContain('"clientMutationSurfaces"')
    expect(generated('runtime')).toContain('"routePattern": "/example/records/section-policy"')
    expect(generated('runtime')).toContain('"method": "DELETE"')
    expect(generated('runtime')).not.toContain('example.records.update')
    expect(generated('runtime')).not.toContain('createDerivedCrudFormSectionFacade')
    const second = await generateModuleRegistries({ resolver: fixture, quiet: true })
    expect(second.flatMap((result) => result.filesWritten)).toEqual([])
  })

  it('recognizes the original route binding from packaged JS', async () => {
    writeDerivedFixture('package/dist/modules/example', derivedDeclaration.replace("'./api/records/route'", "'./api/records/route.js'"), plainDerivedRoute, 'js')
    const fixture = resolver([{ id: 'example' }], true)
    await generateModuleRegistries({ resolver: fixture, quiet: true })
    const [derived] = readDerivedCrudFormSectionRouteIndex(fixture.getOutputDir())
    expect(fs.readFileSync(path.join(fixture.getOutputDir(), derived.fileName), 'utf8'))
      .toContain('@open-mercato/core/modules/example/form-sections')
  })

  it.each([
    ['secondary write', derivedDeclaration.replace("writes: 'parent'", "writes: 'child'"), plainDerivedRoute, /secondary write/],
    ['unknown route factory', derivedDeclaration, plainDerivedRoute.replace('= makeCrudRoute({', '= differentFactory({'), /named original makeCrudRoute/],
    ['custom command mapper', derivedDeclaration, plainDerivedRoute.replace('=> parsed', '=> ({ body: parsed })'), /requires direct command input/],
  ])('rejects %s as a failed qualifier', async (_name, formSource, routeSource, diagnostic) => {
    writeDerivedFixture('app/src/modules/example', formSource, routeSource)
    await expect(generateModuleRegistries({
      resolver: resolver([{ id: 'example', from: '@app' }]), quiet: true,
    })).rejects.toThrow(diagnostic)
  })
})

it('projects a hand-written child façade without exposing its delegated command or binding definitions', async () => {
  const source = derivedDeclaration
    .replace("import { crudRoute } from './api/records/route'", '')
    .replace(/derivedHosts: \[defineCrudRouteSectionHost\(\{[\s\S]*?\}\)\],/, '')
    .replace('mutationSurfaceIds: [], dependencies: [],\n    } }]', `mutationSurfaceIds: ['example.offer.update'], dependencies: [],
    }, mutationSurfaces: [{
      id: 'example.offer.update', kind: 'section-action', requestOperation: 'update',
      guardedFacade: { method: 'PATCH', routePattern: '/example/records/[parentId]/offers/[offerId]' },
      hostResourceKind: 'example.records', mutationResourceKind: 'example.offer', optimisticLock: 'target-required',
      delegatedTarget: { kind: 'command', id: 'secret.server.command' }, resourceBindingIds: ['server.binding.v1'],
    }] }]`)
  write('app/src/modules/example/form-sections.ts', source)
  write('app/src/modules/example/descriptor.client.ts', runtime('example.edit-rec'))
  const fixture = resolver([{ id: 'example', from: '@app' }])
  await generateModuleRegistries({ resolver: fixture, quiet: true })
  expect(generated('runtime')).toContain('"routePattern": "/example/records/[parentId]/offers/[offerId]"')
  expect(generated('runtime')).toContain('"optimisticLock": "target-required"')
  expect(generated('runtime')).not.toMatch(/secret\.server\.command|server\.binding\.v1/)
})

describe('compiled CrudForm extensions', () => {
  const address = { hostId: 'test.record', formVariant: 'edit', formOperation: 'update' }
  const base = {
    ...address, id: 'test.edit', orderedSectionIds: ['details', 'private'], callerIds: ['test.editor'],
    contributionIds: [], dependencies: [], mutationSurfaceIds: ['test.submit'],
    ownershipFacts: [
      { sectionId: 'details', payloadPaths: ['title', 'description'], customFieldOwnership: { mode: 'ids', ids: ['region'], definitionSetId: 'test.fields' } },
      { sectionId: 'private', payloadPaths: ['code'], customFieldOwnership: { mode: 'none' } },
    ],
  }
  const submit = {
    id: 'test.submit', kind: 'parent-submit', requestOperation: 'update',
    guardedFacade: { method: 'PUT', routePattern: '/test/records/section-policy' },
    delegatedTarget: { kind: 'command', id: 'test.update' },
    hostResourceKind: 'test.record', mutationResourceKind: 'test.record', optimisticLock: 'none',
  }
  const authoredId = 'extension.patch'
  const makeExtension = (sections: string, defaults = '{}', id = authoredId, targets = "[{ formVariant: 'edit', formOperation: 'update' }]") => `
    import { defineCrudFormExtension, modify, add, hide, replace, field, store } from '@open-mercato/ui/backend/crud-form-extensions'
    const serverOnlyRule = async () => 'extension.errors.denied'
    export const crudFormExtensions = [defineCrudFormExtension({
      id: ${JSON.stringify(id)}, host: 'crud-form:test.record', targets: ${targets},
      sections: { ${sections} }, defaults: ${defaults},
    })]
  `

  function host(mandatory = false, secondTarget = false) {
    const manual = {
      id: 'test.manual', roundTripId: 'test.manual@v1', operation: 'add', address: { ...address, sectionId: 'manual' },
      requiredCapabilities: [],
    }
    const hostFacts = [{
      id: 'test.host', roundTripId: 'test.host@v1', hostResourceKind: 'test.record', customFieldSeedEntities: { 'test.fields': 'test:record' },
      alternatives: [
        { surface: base, mutationSurfaces: [submit] },
        { surface: { ...base, id: 'test.manual-edit', orderedSectionIds: ['details', 'private', 'manual'], contributionIds: [manual.id] }, mutationSurfaces: [submit] },
        ...(secondTarget ? [{ surface: { ...base, id: 'test.edit-other', formVariant: 'other' }, mutationSurfaces: [submit] }] : []),
      ],
    }]
    write('app/src/modules/host/form-sections.ts', `
      export const crudFormSections = defineCrudFormSections({
        hostFacts: ${JSON.stringify(hostFacts)}, contributionFacts: [${JSON.stringify(manual)}],
        contributedOverrides: { 'test.record/edit/update/manual': { operation: 'add', contributionId: 'test.manual' } },
        runtimes: [
          { id: 'test.host', roundTripId: 'test.host@v1', load: lazyCrudFormSectionRuntime(() => import('./host.client')) },
          { id: 'test.manual', roundTripId: 'test.manual@v1', load: lazyCrudFormSectionRuntime(() => import('./manual.client')) },
        ],
      })
    `)
    write('app/src/modules/host/host.client.ts', `
      const details = defineCrudFormFieldGranularSection({
        id: 'test.details', roundTripId: 'test.details@v1', group: { id: 'details' },
        fields: [], fieldPayloadPaths: { title: ['title'], description: ['description'] },
        fieldSchemas: {}, projectField: {},
        refinements: [{ id: 'summary', fieldPaths: ['description'], mandatory: ${mandatory}, check: () => null }],
      })
      const secret = defineCrudFormSectionRuntime({
        id: 'test.private', roundTripId: 'test.private@v1', group: { id: 'private' },
        ownedFieldPaths: ['code'], validate: () => ({ success: true, data: {} }), projectPayload: () => ({}),
      })
      export const crudFormSectionRuntime = {
        id: 'test.host', roundTripId: 'test.host@v1', sectionDescriptors: [details, secret],
      }
    `)
    write('app/src/modules/host/manual.client.ts', runtime(manual.id))
  }

  function generate(entries: ModuleEntry[] = [{ id: 'extension', from: '@app' }]) {
    return generateModuleRegistryApp({ resolver: resolver([{ id: 'host', from: '@app' }, ...entries]), quiet: true })
  }

  it('compiles mixed finite alternatives and binds browser and server implementations to the same revision', async () => {
    host()
    const definition = makeExtension(`
      details: modify({ fields: {
        title: field.patch({ labelKey: 'extension.fields.title', validate: { server: serverOnlyRule, minLength: 2, enforce: 'client-and-server', messageKey: 'extension.errors.short' } }),
        description: field.remove(),
      } }),
      private: hide(),
      extra: add({ after: 'details', titleKey: 'extension.extra', fields: { alias: field.add({ type: 'text' }) } }),
    `, "{ description: ({ payload }) => String(payload.title ?? '') }")
    write('app/src/modules/extension/form-sections.ts', definition)
    await generate()
    const dir = path.join(root, 'app/.mercato/generated')
    const browser = fs.readdirSync(dir).filter((file) => /^crud-form-section-extension-.*\.ts$/.test(file))
      .map((file) => fs.readFileSync(path.join(dir, file), 'utf8')).join('\n')
    const ledger = path.join(root, 'app/src/modules/extension/form-sections.revisions.json')
    expect(JSON.parse(fs.readFileSync(ledger, 'utf8'))).toMatchObject({
      'extension.patch.details': { n: 1, baseRoundTripId: 'test.details@v1' },
      'extension.patch.extra': { n: 1, baseRoundTripId: null },
      'extension.patch.private': { n: 1, baseRoundTripId: 'test.private@v1' },
    })
    expect(browser).toContain('deriveCrudFormFieldGranularSection')
    expect(browser).toContain('customFields.alias')
    expect(browser).toContain('extension.fields.title')
    expect(browser).not.toMatch(/serverOnlyRule|\.validate\.server|\.defaults|form-sections["']/)
    expect(generated('facts')).toContain('.validate.server')
    expect(generated('facts')).toContain('"readsPayloadPaths":["title"]')
    expect(generated('facts')).toContain('extensions0[0].defaults["description"]')
    expect(generated('runtime')).toContain('extension.patch.details@v1')
    expect(generated('runtime')).toMatch(/"contributionIds": \[\s+"extension.patch.details",\s+"extension.patch.extra",\s+"extension.patch.private",\s+"test.manual"/)
    expect((await generate()).filesWritten).toEqual([])
    const baseFile = 'app/src/modules/host/host.client.ts'
    const baseRuntime = fs.readFileSync(path.join(root, baseFile), 'utf8')
    write(baseFile, baseRuntime.replace('mandatory: false, ', ''))
    expect((await generate()).filesWritten).toEqual([])
    write('app/src/modules/extension/form-sections.ts', definition.replace('extension.errors.denied', 'extension.errors.new-deny'))
    await generate()
    expect(JSON.parse(fs.readFileSync(ledger, 'utf8'))).toMatchObject({
      'extension.patch.details': { n: 2 }, 'extension.patch.extra': { n: 1 }, 'extension.patch.private': { n: 1 },
    })
  })

  it('rejects field patches against a section without a granular field contract', async () => {
    host()
    write('app/src/modules/extension/form-sections.ts', makeExtension(
      "private: modify({ fields: { code: field.patch({ labelKey: 'extension.fields.code' }) } })",
    ))
    await expect(generate()).rejects.toThrow(/granular|component-only/i)
  })

  it('rejects removal of a mandatory refinement and replacement with different ownership', async () => {
    host(true)
    write('app/src/modules/extension/form-sections.ts', makeExtension("details: modify({ fields: { description: field.remove() } })"))
    await expect(generate()).rejects.toThrow(/mandatory refinement "summary"/)
    write('app/src/modules/extension/form-sections.ts', makeExtension("private: replace(() => import('./replace.client'))"))
    write('app/src/modules/extension/replace.client.ts', `
      export const crudFormSectionRuntime = { id: 'extension.replacement', roundTripId: 'extension.replacement@v1',
        group: { id: 'private' }, ownedFieldPaths: ['unrelated'] }
    `)
    await expect(generate()).rejects.toThrow(/replacement must preserve exact payload ownership/)
    write('app/src/modules/extension/replace.client.ts', `
      export const crudFormSectionRuntime = { id: 'extension.replacement', roundTripId: 'extension.replacement@v1',
        group: { id: 'private' }, ownedFieldPaths: ['code'] }
    `)
    await generate()
    expect(generated('runtime')).toContain('extension.patch.private@v1')
  })

  it('requires conflict resolution by exact module selector or null and retains both runtime choices', async () => {
    host()
    const patch = "details: modify({ fields: { title: field.patch({ labelKey: 'extension.fields.title' }) } })"
    write('app/src/modules/extension/form-sections.ts', makeExtension(patch))
    write('app/src/modules/secondary/form-sections.ts', makeExtension(patch, '{}', 'secondary.patch'))
    const entries = [{ id: 'extension', from: '@app' }, { id: 'secondary', from: '@app' }] satisfies ModuleEntry[]
    await expect(generate(entries)).rejects.toThrow(/extension, secondary.*exact modules.ts selector or null/)
    const key = 'test.record/edit/update/details'
    await generate([{ ...entries[0], formSectionOverrides: { [key]: null } }, entries[1]])
    expect(generated('runtime')).toContain('extension.patch.details@v1')
    expect(generated('runtime')).toContain('secondary.patch.details@v1')
    await generate([{ ...entries[0], formSectionOverrides: { [key]: { contributionId: 'secondary.patch.details', operation: 'replace' } } }, entries[1]])
    expect(generated('runtime')).toContain('secondary.patch.details@v1')
  })

  it('rejects a default that reads a masked field and permits a conflict mask for overlapping custom keys', async () => {
    host()
    const definition = makeExtension("details: modify({ fields: { title: field.remove(), description: field.remove() } })",
      "{ description: ({ payload }) => String(payload.title) }")
    write('app/src/modules/extension/form-sections.ts', definition)
    await expect(generate()).rejects.toThrow(/effective alternatives.*conflicting fields, defaults/)
    const patch = (fieldId: string) => `details: modify({ fields: { ${fieldId}: field.add({ type: 'text', store: store.customField('shared') }) } })`
    write('app/src/modules/extension/form-sections.ts', makeExtension(patch('firstField')))
    write('app/src/modules/secondary/form-sections.ts', makeExtension(patch('secondField'), '{}', 'secondary.patch'))
    const entries = [{ id: 'extension', from: '@app' }, { id: 'secondary', from: '@app' }] satisfies ModuleEntry[]
    await expect(generate(entries)).rejects.toThrow(/requires an exact modules.ts selector or null/)
    await generate([{ ...entries[0], formSectionOverrides: { 'test.record/edit/update/details': null } }, entries[1]])
    expect(generated('runtime')).not.toContain('combined-')
  })

  it('emits versioned store associations without letting storage callbacks reach browser modules', async () => {
    host()
    write('app/src/modules/extension/form-sections.ts', makeExtension(`
      erp: add({ fields: { erpSupplierRef: field.add({ type: 'text' }), erpCostCenter: field.add({ type: 'text' }) },
        store: store.external({ integrationId: 'erp', mirror: 'extension:erp_link', deliver: serverOnlyRule }) }),
    `))
    await generate()
    const facts = generated('facts')
    expect(facts).toContain('"ownerModuleId":"extension"')
    expect(facts).toContain('"payloadPaths":["extensions.extension.erpSupplierRef","extensions.extension.erpCostCenter"]')
    expect(facts).toContain('"modes":["extension-sink"]')
    expect(facts).toContain('.options.store')
    expect(facts).toContain("export { entities as crudFormSectionOrmEntities } from './entities.generated'")
    const dir = path.join(root, 'app/.mercato/generated')
    const browser = fs.readdirSync(dir).filter((file) => /^crud-form-section-extension-.*\.ts$/.test(file))
      .map((file) => fs.readFileSync(path.join(dir, file), 'utf8')).join('\n')
    expect(browser).toContain('extensions.extension.erpSupplierRef')
    expect(browser).not.toMatch(/serverOnlyRule|integrationId|erp_link|deliver|crudFormSectionOrmEntities/)
  })

  it('feeds compiled custom fields into all ordinary ce.ts seed registries and excludes masked fields', async () => {
    host()
    write('app/src/modules/extension/ce.ts', `export const entities = [
      { id: 'test:record', fields: [{ key: 'manual_ce', kind: 'text' }] },
    ]`)
    write('app/src/modules/extension/form-sections.ts', makeExtension(`
      extra: add({ fields: { brandName: field.add({ type: 'text', labelKey: 'extension.fields.brand', store: store.customField('brand_name') }) } }),
    `))
    const generateSeeds = (mask: boolean) => generateModuleRegistries({ resolver: resolver([
      { id: 'host', from: '@app' }, { id: 'extension', from: '@app',
        ...(mask ? { formSectionOverrides: { 'test.record/edit/update/extra': null } } : {}) },
    ]), quiet: true })
    const readRegistries = () => ['modules.generated.ts', 'modules.bootstrap.generated.ts', 'modules.cli.generated.ts'].map((name) =>
      fs.readFileSync(path.join(root, 'app/.mercato/generated', name), 'utf8'))
    await generateSeeds(false)
    for (const output of readRegistries()) {
      expect(output).toContain('extension/ce')
      expect(output).toContain('"brand_name"')
      expect(output).toMatch(/"entity":\s*"test:record"/)
    }
    expect(generated('facts')).toContain('"definitionSetId":"test.fields","entityId":"test:record","key":"brand_name","kind":"text"')
    expect(generated('runtime')).not.toContain('test:record')
    await generateSeeds(true)
    for (const output of readRegistries()) {
      expect(output).toContain('extension/ce')
      expect(output).not.toContain('brand_name')
    }
  })

  it('keeps target-scoped descriptor IDs and revisions stable when target order changes', async () => {
    host(false, true)
    const patch = "details: modify({ fields: { title: field.patch({ labelKey: 'extension.fields.title' }) } })"
    const target = (variant: string) => `{formVariant:${JSON.stringify(variant)},formOperation:'update'}`
    write('app/src/modules/extension/form-sections.ts', makeExtension(patch, '{}', authoredId, `[${target('edit')},${target('other')}]`))
    await generate()
    const output = generated('runtime')
    expect(output).toContain('extension.patch.edit.update.details@v1')
    expect(output).toContain('extension.patch.other.update.details@v1')
    write('app/src/modules/extension/form-sections.ts', makeExtension(patch, '{}', authoredId, `[${target('other')},${target('edit')}]`))
    expect((await generate()).filesWritten).toEqual([])
    expect(generated('runtime')).toBe(output)
  })
})
