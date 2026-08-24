import fs from 'node:fs'
import path from 'node:path'
import {
  extractAllModuleFacts,
  isExactSourceFilePath,
  renderModuleFactsDirectory,
  renderModuleFactsJson,
} from '../module-facts'
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
const DIRECTORY_MARKDOWN_LINK_TARGET = /\]\(\.\.\/\.\.\/\.\.\/\.\.\/([^)#]+)(?:#L\d+)?\)/g
const MAX_ANCHORED_SECTION_BYTES = 32 * 1024

function collectLinkTargets(markdown: string): string[] {
  return [...markdown.matchAll(MARKDOWN_LINK_TARGET)].map((match) => match[1])
}

function expectAnchoredLeafCap(markdown: string): void {
  const lines = markdown.split('\n')
  const subheadings = lines.flatMap((line, index) => line.startsWith('### ') ? [index] : [])
  if (Buffer.byteLength(markdown) > MAX_ANCHORED_SECTION_BYTES) expect(subheadings.length).toBeGreaterThan(0)
  for (let index = 0; index < subheadings.length; index += 1) {
    const start = subheadings[index]
    const end = subheadings[index + 1] ?? lines.length
    expect(Buffer.byteLength(lines.slice(start, end).join('\n'))).toBeLessThanOrEqual(MAX_ANCHORED_SECTION_BYTES)
  }
}

describe('module-facts BC resolve guard (T2)', () => {
  const repoRoot = findRepoRoot()
  const sources = discoverPackageModuleSources(createResolver(repoRoot))
  const extractionStartedAt = process.cpuUsage()
  const { factsByModule, markdownByModule, directoryByModule, frameworkMarkdown } = extractAllModuleFacts({ sources })
  const legacyFactsByModule = extractAllModuleFacts({ sources, factsContractVersion: 1 }).factsByModule
  const extractionCpuUsage = process.cpuUsage(extractionStartedAt)
  const extractionCpuDurationMs = (extractionCpuUsage.user + extractionCpuUsage.system) / 1_000

  it('emits complete, deterministic extension catalogs for every resolved module', () => {
    const repeated = extractAllModuleFacts({ sources })
    expect(renderModuleFactsJson(repeated.factsByModule)).toBe(renderModuleFactsJson(factsByModule))
    expect(repeated.markdownByModule).toEqual(markdownByModule)
    expect(repeated.directoryByModule).toEqual(directoryByModule)
    expect(repeated.frameworkMarkdown).toBe(frameworkMarkdown)
    for (const facts of Object.values(factsByModule)) {
      expect(facts.extensionSurfaces).toBeDefined()
      expect(facts.extensionSurfaces?.unresolved).toEqual([])
    }
  })

  it('preserves stable v1 extension arrays while exposing corrected v2 facts separately', () => {
    const legacySecurity = legacyFactsByModule.security.extensionSurfaces?.contributions.find(
      (contribution) => contribution.id.includes('section:auth.login.form'),
    )
    const v2Security = factsByModule.security.extensionSurfaces?.contributions.find(
      (contribution) => contribution.id.includes('section:auth.login.form'),
    )
    expect(legacySecurity?.kind === 'component-override' ? legacySecurity.details.mode : null).toBe('replace')
    expect(v2Security?.kind === 'component-override' ? v2Security.details.mode : null).toBe('wrapper')

    const recoveredContribution = 'catalog.injection.product-bulk-delete@data-table:catalog.products.list:bulk-actions'
    expect(legacyFactsByModule.catalog.extensionSurfaces?.contributions.map((entry) => entry.id))
      .not.toContain(recoveredContribution)
    expect(factsByModule.catalog.extensionSurfaces?.contributions.map((entry) => entry.id))
      .toContain(recoveredContribution)
  })

  it('keeps generated extension facts within bounded build-time and context budgets', () => {
    const completeJson = renderModuleFactsJson(factsByModule)
    const legacyJson = renderModuleFactsJson(Object.fromEntries(
      Object.entries(factsByModule).map(([moduleId, facts]) => [moduleId, { ...facts, extensionSurfaces: undefined }]),
    ))
    const markdownBytes = Object.values(markdownByModule)
      .reduce((total, markdown) => total + Buffer.byteLength(markdown), Buffer.byteLength(frameworkMarkdown))
    const directoryMarkdownBytes = Object.values(directoryByModule).reduce(
      (total, directory) => total
        + Buffer.byteLength(directory.index)
        + directory.sections.reduce((sectionTotal, section) => sectionTotal + Buffer.byteLength(section.markdown), 0),
      Buffer.byteLength(frameworkMarkdown),
    )

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
    //
    // The CPU bound is a blow-up detector, not a performance target. It measures CPU
    // time for a whole-repo extraction, and CPU time for fixed work varies with the
    // machine: the same extraction measures ~7.3s on a developer workstation and
    // ~30.0s on a CI runner. At the previous 30s cap CI sat exactly on the line
    // (an observed failure at 30,052.8ms), so the guard could not tell a genuine
    // pathological regression from ordinary hardware variance and failed
    // unrelated PRs at random. 90s keeps it meaningful — a real blow-up here is
    // multiplicative, not a few percent — while leaving CI roughly 3x headroom.
    //
    // JSON and markdown caps raised a fourth time by the `warranty_claims`
    // module (2026-07-03-warranty-rma-claims-desk): one large business module —
    // eight entities, fourteen events, twelve ACL features, ~36 API routes, plus
    // its search, notification, AI-tool and widget surfaces — costs ~202KB of
    // facts and provenance references and ~67KB of rendered fact-sheet, which is
    // ordinary linear growth for a module of that size rather than the
    // multiplicative blow-up this detector exists to catch. The delta cap
    // absorbed it unchanged.
    expect(extractionCpuDurationMs).toBeLessThan(90_000)
    // JSON cap raised a fourth time by the injection-table slot normalization:
    // `extractInjectionTable` previously did `if (!Array.isArray(entries)) continue`,
    // silently dropping every string and single-object slot form that
    // `ModuleInjectionTable` allows. Twelve real contributions across catalog, sales,
    // wms, staff, integrations and checkout were therefore invisible to every fact
    // consumer — `integrations` published no contributions at all. Reading them costs
    // ~28KB, which is the fix working, not drift.
    // The additive EUDR and Documents modules contribute their real routes, ACL,
    // events, entities, and extension surfaces without changing the extraction
    // shape.
    //
    // JSON cap raised a fifth time by the devices/push-notifications stack: the
    // `devices` and `push_notifications` modules plus the `channel-fcm`,
    // `channel-apns` and `channel-expo` provider packages add their own facts,
    // provenance entries and override targets to every render. The
    // `warranty_claims` module (see above) and the additive Documents module
    // land alongside it, so the cap absorbs all three additions. Both sides of
    // that merge had raised the cap independently (3_950_000 for Documents,
    // 4_000_000 for the rest); neither number covers the union, which measures
    // ~4.09MB. Keep bounded headroom over the measured size only.
    //
    // Raised again by the staff time-tracking consulting suite
    // (2026-08-12-time-tracking-consulting-suite): ten new entities, fourteen
    // events, seven ACL features, ~22 API routes plus the task/report search,
    // notification, worker and injection-widget surfaces. That module measured
    // 4,055,610 bytes on its own branch against the then-4_000_000 cap. This
    // merge is the union of BOTH growths — Documents and time-tracking — which
    // measures 4,169,548 bytes, over either side's independent number. The cap
    // is set from that measurement with bounded headroom, not from either
    // branch's guess. Ordinary linear growth for modules of that size, not the
    // multiplicative blow-up this detector exists to catch. The delta cap on
    // the next line did NOT absorb it — the union measured 1,810,803 against a
    // 1,800,000 delta, 0.6% over — so it is raised from that measurement too.
    //
    // Raised again by the staff time-tracking UMES host catalog
    // (2026-08-24-time-tracking-umes-extension-points, phase P3): the module's
    // new `extension-points.ts` declares 33 hosts, which the data-table and
    // crud-form surface tables expand into 110 emitted host facts, and its new
    // `widgets/components.ts` adds one more override-target render. That
    // measures 4,289,542 bytes against the then-4_250_000 cap, 0.9% over.
    // Linear growth in one module's declared surface, not the multiplicative
    // blow-up this detector exists to catch; the cap is set from the
    // measurement with bounded headroom.
    //
    // Raised again by phase P6 of the same spec: staff gains a search entity for
    // each of four more time-tracking tables (each one emits two query-lifecycle
    // host facts), three analytics entities, four notification types, an AI tool
    // pack of six, a portal page pair with two `portal-page` hosts, one more
    // strategy registry and a `notifications.handlers.ts` override target. That
    // measures 4,377,814 bytes against the then-4_350_000 cap, 0.6% over — again
    // linear growth in one module's declared surface.
    expect(Buffer.byteLength(completeJson)).toBeLessThan(4_450_000)
    // The v2-over-legacy delta grows with the same host facts (they exist only in
    // the v2 extension surface), measuring 1,900,068 against the 1,900,000 above —
    // 0.004% over. Raised from that measurement with the same bounded headroom.
    // P6 moves it again — the new query-lifecycle, portal-page and registry hosts
    // exist only in the v2 surface — measuring 1,951,054 against the 1,950,000
    // above, 0.05% over.
    expect(Buffer.byteLength(completeJson) - Buffer.byteLength(legacyJson)).toBeLessThan(2_000_000)
    // Markdown cap raised with the source-link contract: entities, events, ACL
    // features, DI tokens, search entities, notifications, UMES hosts and UMES
    // contributions all render a resolved Source cell, and contribution
    // resolutions render as their own source-linked section.
    expect(markdownBytes).toBeLessThan(1_750_000)
    expect(directoryMarkdownBytes).toBeLessThan(2_050_000)
  })

  it('keeps every shipped directory section resumable and every advertised subsection anchor exact', () => {
    for (const [moduleId, directory] of Object.entries(directoryByModule)) {
      expect(directory.index.trimEnd()).toMatch(
        new RegExp(`<!-- end module facts: ${moduleId} — ${directory.sections.length} sections -->$`),
      )
      const bySlug = new Map(directory.sections.map((section) => [section.slug, section]))
      for (const section of directory.sections) {
        expect(section.markdown.trimEnd()).toMatch(
          new RegExp(`<!-- end module facts section: ${moduleId}/${section.slug} -->$`),
        )
        expectAnchoredLeafCap(section.markdown)
      }
      const anchors = [...directory.index.matchAll(/^  - (.+) — ([a-z0-9-]+)\.md:L(\d+), ~\d+ KB$/gm)]
      for (const anchor of anchors) {
        const section = bySlug.get(anchor[2])
        expect(section).toBeDefined()
        const heading = section?.markdown.split('\n')[Number(anchor[3]) - 1]
        expect(heading).toBe(`### ${anchor[1].slice(anchor[1].lastIndexOf(' / ') + 3)}`)
      }
      const expectedAnchorCount = directory.sections.reduce(
        (total, section) => total + (section.markdown.match(/^### /gm) ?? []).length,
        0,
      )
      expect(anchors).toHaveLength(expectedAnchorCount)
    }
  })

  it('chunks oversized natural groups and rejects a single row larger than the read cap', () => {
    const customers = factsByModule.customers
    const routeTargets = customers.overrideTargets?.filter((target) => target.domain === 'routes') ?? []
    expect(routeTargets.length).toBeGreaterThan(0)
    const oversizedOverrides = renderModuleFactsDirectory({
      ...customers,
      overrideTargets: [
        ...(customers.overrideTargets?.filter((target) => target.domain !== 'routes') ?? []),
        ...Array.from({ length: 10 }, () => routeTargets).flat(),
      ],
    })
    const overrideSection = oversizedOverrides.sections.find((section) => section.slug === 'exact-override-targets')
    expect(overrideSection?.markdown).toMatch(/^### routes \(continued 2\)$/m)
    expectAnchoredLeafCap(overrideSection?.markdown ?? '')

    const boundHost = customers.extensionSurfaces?.hosts.find((host) => host.bound)
    if (!boundHost) throw new Error('[internal] customers must expose a bound host for the chunking guard')
    const oversizedHosts = renderModuleFactsDirectory({
      ...customers,
      extensionSurfaces: {
        ...(customers.extensionSurfaces ?? { hosts: [], contributions: [], unresolved: [] }),
        hosts: Array.from({ length: 400 }, (_, index) => ({
          ...boundHost,
          id: `${boundHost.id}:synthetic-${index}`,
        })),
      },
    })
    const hostSection = oversizedHosts.sections.find((section) => section.slug === 'umes-hosts')
    expect(hostSection?.markdown).toMatch(/\(continued 2\)/)
    expectAnchoredLeafCap(hostSection?.markdown ?? '')

    const routeTarget = routeTargets[0]
    if (!routeTarget) throw new Error('[internal] customers must expose a route target for the chunking guard')
    const oversizedRow = {
      ...routeTarget,
      path: ['x'.repeat(MAX_ANCHORED_SECTION_BYTES)],
    }
    expect(() => renderModuleFactsDirectory({ ...customers, overrideTargets: [oversizedRow] }))
      .toThrow(/contains a row larger than the anchored read cap/)
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

  it('keeps directory source hrefs exact and resolvable at their deeper relative depth', () => {
    const packageLinkRoot = path.join(repoRoot, 'node_modules', '@open-mercato')
    const canCheckDisk = fs.existsSync(packageLinkRoot)
    const unresolvedTargets = new Set<string>()
    let checkedTargets = 0

    for (const directory of Object.values(directoryByModule)) {
      for (const section of directory.sections) {
        for (const match of section.markdown.matchAll(DIRECTORY_MARKDOWN_LINK_TARGET)) {
          checkedTargets += 1
          const target = match[1]
          if (canCheckDisk && (!fs.existsSync(path.join(repoRoot, target)) || !fs.statSync(path.join(repoRoot, target)).isFile())) {
            unresolvedTargets.add(target)
          }
        }
      }
    }

    expect(checkedTargets).toBeGreaterThan(1_000)
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
