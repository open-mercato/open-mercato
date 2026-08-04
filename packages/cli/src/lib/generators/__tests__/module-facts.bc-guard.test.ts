import fs from 'node:fs'
import path from 'node:path'
import { extractAllModuleFacts, isExactSourceFilePath, renderModuleFactsJson } from '../module-facts'
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

const MARKDOWN_LINK_TARGET = /\]\(\.\.\/\.\.\/\.\.\/([^)#]+)(?:#L\d+)?\)/g

function collectLinkTargets(markdown: string): string[] {
  return [...markdown.matchAll(MARKDOWN_LINK_TARGET)].map((match) => match[1])
}

describe('module-facts BC resolve guard (T2)', () => {
  const repoRoot = findRepoRoot()
  const sources = discoverPackageModuleSources(createResolver(repoRoot))
  const extractionStartedAt = process.cpuUsage()
  const { factsByModule, markdownByModule, frameworkMarkdown } = extractAllModuleFacts({ sources })
  const extractionCpuUsage = process.cpuUsage(extractionStartedAt)
  const extractionCpuDurationMs = (extractionCpuUsage.user + extractionCpuUsage.system) / 1_000

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

    // Budget raised by the bidirectional-topology spec
    // (2026-08-02-module-facts-extension-activation-and-incoming-index): the
    // additive `activations`, cross-module `incoming`, and per-contribution
    // `contributionResolutions` layers add ~210KB of compact references (no
    // contribution payloads are duplicated). Incoming rows are cross-module only;
    // resolution rows are required one-per-contribution by the spec's acceptance
    // criteria and are the dominant term.
    //
    // JSON cap raised again by the exact-override-targets spec
    // (2026-08-02-module-facts-exact-override-targets): the additive per-module
    // `overrideTargets` project one exact key per real override entry (acl
    // features, di tokens, subscribers, pages, workers, encryption, widgets,
    // notifications, cli, setup, ai, interceptors/enrichers, page guards). These
    // are required exhaustively by the spec's acceptance criteria; targets carry
    // only compact structured path/key/factRef/source refs (no runtime values or
    // contribution payloads). The delta cap is unchanged because `overrideTargets`
    // live in both the complete and legacy renders (only `extensionSurfaces` is
    // stripped for the legacy comparison).
    //
    // JSON cap raised a third time by the uniform provenance index
    // (2026-08-02-module-facts-source-provenance-and-contract-inventory): every
    // proven `(kind, id)` now reaches `factSources` (~630KB across the repo), so a
    // consumer resolves any fact's origin through one lookup. Entries whose
    // declaration site is already serialized inline (routes, pages, CLI commands,
    // AI tools/agents, owned contracts, hosts, contributions) emit a typed
    // `factRef` pointer instead of a duplicated source ref, and `factKey` is
    // omitted when it equals the entry `id` — so the index costs references, never
    // copied provenance payloads. The cap also covers the newly reachable
    // framework-host activations (dashboard/menu/notification contributions now
    // resolve as bound instead of silently falling back to capability-only).
    expect(extractionCpuDurationMs).toBeLessThan(30_000)
    // JSON cap raised a fourth time by the injection-table slot normalization:
    // `extractInjectionTable` previously did `if (!Array.isArray(entries)) continue`,
    // silently dropping every string and single-object slot form that
    // `ModuleInjectionTable` allows. Twelve real contributions across catalog, sales,
    // wms, staff, integrations and checkout were therefore invisible to every fact
    // consumer — `integrations` published no contributions at all. Reading them costs
    // ~28KB, which is the fix working, not drift.
    expect(Buffer.byteLength(completeJson)).toBeLessThan(3_560_000)
    expect(Buffer.byteLength(completeJson) - Buffer.byteLength(legacyJson)).toBeLessThan(1_800_000)
    // Markdown cap raised with the source-link contract: entities, events, ACL
    // features, DI tokens, search entities, notifications, UMES hosts and UMES
    // contributions all render a resolved Source cell, and contribution
    // resolutions render as their own source-linked section.
    expect(markdownBytes).toBeLessThan(1_550_000)
  })

  it('links every generated fact to an exact resolvable file, never a directory', () => {
    const packageLinkRoot = path.join(repoRoot, 'node_modules', '@open-mercato')
    const canCheckDisk = fs.existsSync(packageLinkRoot)
    const nonExactTargets = new Set<string>()
    const unresolvedTargets = new Set<string>()
    let checkedTargets = 0

    for (const markdown of Object.values(markdownByModule)) {
      for (const target of collectLinkTargets(markdown)) {
        checkedTargets += 1
        if (!isExactSourceFilePath(target)) {
          nonExactTargets.add(target)
          continue
        }
        if (!canCheckDisk) continue
        const absolute = path.join(repoRoot, target)
        if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) unresolvedTargets.add(target)
      }
    }

    expect(checkedTargets).toBeGreaterThan(1_000)
    expect([...nonExactTargets]).toEqual([])
    expect([...unresolvedTargets]).toEqual([])
  })

  it('keeps directory-valued provenance readable as plain text', () => {
    const frameworkHostMarkdowns = Object.values(markdownByModule)
      .filter((markdown) => markdown.includes('packages/ui/src'))
    expect(frameworkHostMarkdowns.length).toBeGreaterThan(0)
    for (const markdown of frameworkHostMarkdowns) {
      expect(markdown).not.toContain('(../../../packages/ui/src)')
    }
    for (const [moduleId, facts] of Object.entries(factsByModule)) {
      expect(markdownByModule[moduleId]).toContain(`Source root: ${facts.sourceRoot}\n`)
      expect(markdownByModule[moduleId]).not.toContain(`(../../../${facts.sourceRoot})`)
    }
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
