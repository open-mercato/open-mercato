import fs from 'node:fs'
import path from 'node:path'
import { extractAllModuleFacts, renderModuleFactsJson } from '../module-facts'
import { discoverPackageModuleSources } from '../module-facts-discovery'
import { createResolver } from '../../resolver'

function findRepoRoot(): string {
  let dir = __dirname
  for (let depth = 0; depth < 10; depth += 1) {
    if (fs.existsSync(path.join(dir, 'packages', 'core', 'src', 'modules'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error('[internal] could not locate repo root from the test directory')
}

function isUnique(values: string[]): boolean {
  return values.length === new Set(values).size
}

describe('module-facts BC resolve guard (T2)', () => {
  const repoRoot = findRepoRoot()
  const sources = discoverPackageModuleSources(createResolver(repoRoot))
  const extractionStartedAt = process.cpuUsage()
  const { factsByModule, markdownByModule, frameworkMarkdown } = extractAllModuleFacts({ sources })
  const extractionCpuUsage = process.cpuUsage(extractionStartedAt)
  const extractionDurationMs = (extractionCpuUsage.user + extractionCpuUsage.system) / 1_000

  it('emits complete, deterministic extension catalogs for every resolved module', () => {
    const repeated = extractAllModuleFacts({ sources })
    expect(renderModuleFactsJson(repeated.factsByModule)).toBe(renderModuleFactsJson(factsByModule))
    expect(repeated.markdownByModule).toEqual(markdownByModule)
    expect(repeated.frameworkMarkdown).toBe(frameworkMarkdown)
    for (const facts of Object.values(factsByModule)) {
      expect(facts.extensionSurfaces).toBeDefined()
      expect(facts.extensionSurfaces?.unresolved).toEqual([])
    }
  })

  it('keeps generated extension facts within bounded build-time and context budgets', () => {
    const completeJson = renderModuleFactsJson(factsByModule)
    const legacyJson = renderModuleFactsJson(Object.fromEntries(
      Object.entries(factsByModule).map(([moduleId, facts]) => [moduleId, { ...facts, extensionSurfaces: undefined }]),
    ))
    const markdownBytes = Object.values(markdownByModule)
      .reduce((total, markdown) => total + Buffer.byteLength(markdown), Buffer.byteLength(frameworkMarkdown))

    expect(extractionDurationMs).toBeLessThan(30_000)
    expect(Buffer.byteLength(completeJson)).toBeLessThan(2_000_000)
    expect(Buffer.byteLength(completeJson) - Buffer.byteLength(legacyJson)).toBeLessThan(1_500_000)
    expect(markdownBytes).toBeLessThan(1_000_000)
  })

  it('discovers a superset of the historical core modules', () => {
    const discovered = new Set(Object.keys(factsByModule))
    for (const moduleId of ['auth', 'catalog', 'customers', 'sales', 'workflows']) {
      expect(discovered.has(moduleId)).toBe(true)
    }
    expect(discovered.size).toBeGreaterThan(9)
  })

  it('keeps factory-built and generated-registry enricher contributions visible', () => {
    expect(factsByModule.sales.extensionSurfaces?.contributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sales.catalog-image:sales:sales_quote_line', kind: 'response-enricher' }),
      expect.objectContaining({ id: 'sales.catalog-image:sales:sales_order_line', kind: 'response-enricher' }),
    ]))
    expect(factsByModule.wms.extensionSurfaces?.contributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'wms.sales-order-inventory', kind: 'response-enricher' }),
    ]))
  })

  for (const source of sources) {
    const moduleId = source.moduleId
    describe(`${moduleId}`, () => {
      const facts = factsByModule[moduleId]

      it('stamps the exact providing package and version without removing coreVersion', () => {
        expect(facts.sourcePackage).toBe(source.from ?? null)
        expect(facts.sourceVersion).toBe(source.packageVersion ?? null)
        expect(facts).toHaveProperty('coreVersion')
      })

      // Entity / search / host ids are colon-namespaced under the module by construction
      // and convention; drift here means the builder or a module's data model broke.
      it('colon-namespaces entity / search / host ids under the module and keeps ids unique', () => {
        const entityIds = facts.entities.map((entity) => entity.id)
        expect(entityIds.every((id) => id.startsWith(`${moduleId}:`))).toBe(true)
        expect(isUnique(entityIds)).toBe(true)
        expect(facts.searchEntities.every((id) => id.startsWith(`${moduleId}:`))).toBe(true)
        expect(isUnique(facts.searchEntities)).toBe(true)
        expect(facts.hostTokens.entityIds.every((id) => id.startsWith(`${moduleId}:`))).toBe(true)
      })

      // Event / ACL / notification ids must be unique, but are NOT asserted to be
      // dot-prefixed by the module id: some modules intentionally use a different
      // namespace (e.g. ai_assistant -> `ai.*`, dashboards -> `analytics.*`,
      // storage_s3 -> `storage_providers.*`). The meaningful invariant is uniqueness,
      // not folder-name prefixing (spec 2026-07-06 R1).
      it('keeps event / acl / notification ids unique', () => {
        expect(isUnique(facts.events.map((event) => event.id))).toBe(true)
        expect(isUnique(facts.aclFeatures)).toBe(true)
        expect(isUnique(facts.notifications)).toBe(true)
      })

      it('resolves host-token entity ids against the module entity set', () => {
        const entityIds = new Set(facts.entities.map((entity) => entity.id))
        for (const hostEntityId of facts.hostTokens.entityIds) {
          expect(entityIds.has(hostEntityId)).toBe(true)
          expect(hostEntityId.endsWith('_entity')).toBe(true)
        }
      })
    })
  }
})
