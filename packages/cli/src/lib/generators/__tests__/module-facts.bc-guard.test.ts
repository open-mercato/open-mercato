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
    // This is a blow-up detector, not a performance target. It measures CPU time
    // for a whole-repo extraction, and CPU time for fixed work varies with the
    // machine: the same extraction measures ~7.3s on a developer workstation and
    // ~30.0s on a CI runner. At the previous 30s cap CI sat exactly on the line
    // (an observed failure at 30,052.8ms), so the guard could not tell a genuine
    // pathological regression from ordinary hardware variance and failed
    // unrelated PRs at random. 90s keeps it meaningful — a real blow-up here is
    // multiplicative, not a few percent — while leaving CI roughly 3x headroom.
    //
    // JSON cap raised a fourth time when the agent-orchestrator branch was
    // integrated. This guard is develop-only — it does not exist on that branch
    // — so its cap had never measured that branch's modules. The extraction now
    // covers 57 modules at a ~67KB mean with a smooth distribution (largest:
    // `customers` 255KB, a long-standing core module; `agent_orchestrator`
    // 170KB, third), i.e. linear growth from describing more modules rather
    // than a per-module blow-up, which is what this detector is for. Headroom is
    // deliberately modest so a genuine multiplicative regression still trips it.
    expect(extractionCpuDurationMs).toBeLessThan(90_000)
    expect(Buffer.byteLength(completeJson)).toBeLessThan(4_200_000)
    // Per-module mean pins the invariant the absolute cap only approximates:
    // adding modules is expected, inflating every module's facts is not. This
    // is what keeps the absolute cap from being raised on autopilot.
    expect(Buffer.byteLength(completeJson) / Object.keys(factsByModule).length).toBeLessThan(90_000)
    expect(Buffer.byteLength(completeJson) - Buffer.byteLength(legacyJson)).toBeLessThan(1_800_000)
    // Markdown cap raised with the source-link contract: entities, events, ACL
    // features, DI tokens, search entities, notifications, UMES hosts and UMES
    // contributions all render a resolved Source cell, and contribution
    // resolutions render as their own source-linked section.
    //
    // Raised again alongside the JSON cap above, for the same reason and on the
    // same evidence: this develop-only guard now renders fact-sheets for the
    // agent-orchestrator branch's modules too. Growth is one more sheet per
    // module, not fatter sheets — which the per-module mean below pins.
    expect(markdownBytes).toBeLessThan(1_900_000)
    expect(markdownBytes / Object.keys(markdownByModule).length).toBeLessThan(40_000)
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
