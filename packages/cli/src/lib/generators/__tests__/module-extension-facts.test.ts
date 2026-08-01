import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  assertNoUnresolvedExtensionTargets,
  correlateModuleExtensionFacts,
  extractModuleExtensionFacts,
  getFrameworkExtensionHosts,
  renderFrameworkExtensionPointsMarkdown,
} from '../module-extension-facts'
import type { ModuleFactsJsonEntry } from '../module-facts'

function write(root: string, relativePath: string, source: string): void {
  const filePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, source)
}

describe('module extension facts', () => {
  let moduleRoot: string

  beforeEach(() => {
    moduleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'module-extension-facts-'))
  })

  afterEach(() => {
    fs.rmSync(moduleRoot, { recursive: true, force: true })
  })

  it('expands declared host families and preserves fact references and browser transports', () => {
    write(moduleRoot, 'extension-points.ts', `
      import { defineModuleExtensionPoints, dataTableExtensionHost, crudFormExtensionHost, injectionExtensionHost } from 'x'
      export const extensionPoints = defineModuleExtensionPoints({
        moduleId: 'alpha',
        hosts: {
          records: dataTableExtensionHost({ tableId: 'alpha.records.list', baseSpotId: 'data-table:alpha.records', source: 'Records.tsx' }),
          editor: crudFormExtensionHost({ entityId: 'alpha.record', source: 'Edit.tsx' }),
          detail: injectionExtensionHost({
            family: 'detail', pattern: 'detail:alpha.record:{recordId}',
            parameters: { recordId: { source: 'record.id', pattern: '^[a-z]+$' } },
            supported: ['render-widget'], source: 'Detail.tsx', fallbacks: ['detail:alpha.record'],
          }),
        },
      })
    `)
    write(moduleRoot, 'Records.tsx', 'export const tableId = extensionPoints.hosts.records.tableId')
    write(moduleRoot, 'Edit.tsx', 'export const entityId = extensionPoints.hosts.editor.entityId')
    write(moduleRoot, 'Detail.tsx', 'export const spotId = extensionPoints.hosts.detail.pattern')

    const facts = extractModuleExtensionFacts({
      moduleId: 'alpha',
      moduleRoot,
      sourceRoot: 'node_modules/pkg/src/modules/alpha',
      entities: [{ id: 'alpha:record' }],
      events: [{ id: 'alpha.record.updated', clientBroadcast: true, portalBroadcast: true }],
      apiRoutes: [{ path: '/alpha/records', methods: ['GET', 'POST'] }],
      searchEntities: ['alpha:record'],
    })

    expect(facts.hosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'data-table:alpha.records:header', bound: true }),
      expect.objectContaining({ id: 'data-table:alpha.records.list:columns', capabilities: ['column-widget'] }),
      expect.objectContaining({ id: 'data-table:alpha.records:empty-state', bound: false }),
      expect.objectContaining({ id: 'crud-form:alpha.record:fields', capabilities: ['field-widget'] }),
      expect.objectContaining({ id: 'detail:alpha.record:{recordId}', resolution: 'pattern' }),
      expect.objectContaining({ id: 'alpha:record', resolution: 'fact-ref' }),
      expect.objectContaining({
        id: 'alpha.record.updated',
        capabilities: ['async-subscriber', 'sync-subscriber', 'browser-client', 'browser-portal'],
      }),
      expect.objectContaining({ id: 'alpha.record.querying', activation: 'caller-opt-in' }),
      expect.objectContaining({ id: 'alpha.record.queried', phases: ['result-transform', 'scope-reapply'] }),
    ]))
    expect(facts.unresolved).toEqual([])
  })

  it('extracts outgoing mechanisms with kind-specific contracts and correlates targets', () => {
    write(moduleRoot, 'extension-points.ts', `
      import { defineModuleExtensionPoints, dataTableExtensionHost } from 'x'
      export const extensionPoints = defineModuleExtensionPoints({
        moduleId: 'alpha', hosts: { records: dataTableExtensionHost({ tableId: 'alpha.records', source: 'Records.tsx' }) },
      })
    `)
    write(moduleRoot, 'Records.tsx', 'export const tableId = extensionPoints.hosts.records.tableId')
    write(moduleRoot, 'widgets/injection-table.ts', `
      export const injectionTable = {
        'data-table:alpha.records:columns': [{ widgetId: 'alpha.columns', priority: 20, features: ['alpha.view'] }],
        'menu:backend.sidebar': [{ widgetId: 'alpha.menu' }],
      }
    `)
    write(moduleRoot, 'data/enrichers.ts', `
      const enricher = {
        id: 'alpha.records.enricher', targetEntity: 'alpha:record', features: ['alpha.view'], timeout: 750,
        fallback: {}, queryEngine: { engines: ['json'], applyOn: ['list'] },
        async enrichOne() {}, async enrichMany() {},
      }
      export const enrichers = [enricher]
    `)
    write(moduleRoot, 'api/interceptors.ts', `
      export const interceptors = [{
        id: 'alpha.records.interceptor', targetRoute: 'alpha/records', methods: ['POST'],
        async before() {}, async after() {},
      }]
    `)
    write(moduleRoot, 'commands/interceptors.ts', `
      export const interceptors = [{
        id: 'alpha.records.command', targetCommand: 'alpha.records.update',
        async beforeExecute() {}, async afterUndo() {},
      }]
    `)
    write(moduleRoot, 'data/guards.ts', `
      const guard = { id: 'alpha.records.guard', targetEntity: 'alpha:record', operations: ['update', 'delete'], async validate() {}, async afterSuccess() {} }
      export const guards = [guard]
    `)
    write(moduleRoot, 'data/extensions.ts', `
      export const extensions = [{ base: 'alpha:record', extension: 'beta:record_meta', join: { baseKey: 'id', extensionKey: 'record_id' } }]
    `)
    write(moduleRoot, 'subscribers/updated.ts', `
      export const metadata = { event: 'alpha.record.updated', id: 'alpha:record-updated', persistent: true, priority: 10 }
    `)

    const surface = extractModuleExtensionFacts({
      moduleId: 'alpha',
      moduleRoot,
      sourceRoot: 'node_modules/pkg/src/modules/alpha',
      entities: [{ id: 'alpha:record' }],
      events: [{ id: 'alpha.record.updated', clientBroadcast: true }],
      apiRoutes: [{ path: '/alpha/records', methods: ['POST'] }],
      searchEntities: [],
    })
    const correlated = correlateModuleExtensionFacts({
      surfacesByModule: { alpha: surface },
      entityIds: new Set(['alpha:record']),
      eventIds: new Set(['alpha.record.updated']),
      apiRoutes: new Set(['/alpha/records']),
    }).alpha

    expect(correlated.contributions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'alpha.records.enricher',
        kind: 'response-enricher',
        details: expect.objectContaining({
          targetEntity: 'alpha:record', surfaces: ['list', 'detail'], timeoutMs: 750,
          queryEngine: { engines: ['json'], applyOn: ['list'], activation: 'caller-opt-in' },
        }),
      }),
      expect.objectContaining({
        id: 'alpha.records.interceptor', kind: 'api-interceptor',
        targets: [expect.objectContaining({ resolution: 'fact-ref' })],
        details: expect.objectContaining({ phases: ['before', 'after'] }),
      }),
      expect.objectContaining({ id: 'alpha.records.command', details: expect.objectContaining({ phases: ['before-execute', 'after-undo'] }) }),
      expect.objectContaining({ id: 'alpha.records.guard', details: expect.objectContaining({ optimisticLock: 'preserved' }) }),
      expect.objectContaining({ kind: 'entity-extension', details: expect.objectContaining({ linkId: 'id:record_id' }) }),
      expect.objectContaining({ id: 'alpha:record-updated', details: expect.objectContaining({ persistent: true, sync: false, priority: 10 }) }),
      expect.objectContaining({ id: 'alpha.columns@data-table:alpha.records:columns', targets: [expect.objectContaining({ resolution: 'exact' })] }),
      expect.objectContaining({ id: 'alpha.menu@menu:backend.sidebar', targets: [expect.objectContaining({ resolution: 'framework' })] }),
      expect.objectContaining({ id: 'alpha.record.updated.browser', kind: 'browser-reaction' }),
    ]))
    expect(correlated.unresolved).toEqual([])
  })

  it('renders a deterministic separate framework catalog', () => {
    type ExtensionSurfacesAreOptional = {} extends Pick<ModuleFactsJsonEntry, 'extensionSurfaces'> ? true : false
    const extensionSurfacesAreOptional: ExtensionSurfacesAreOptional = true
    const first = renderFrameworkExtensionPointsMarkdown()
    const second = renderFrameworkExtensionPointsMarkdown()
    expect(second).toBe(first)
    expect(first).toContain('# Framework extension points (generated, do not edit)')
    expect(first).toContain('integrations.detail:{integrationId}')
    expect(first).toContain('menu:backend.sidebar')
    expect(extensionSurfacesAreOptional).toBe(true)
  })

  it('projects every wired unified override key with its supported mode', () => {
    const overrides = getFrameworkExtensionHosts()
      .filter((host) => host.family === 'module-override')
      .map((host) => [host.id, host.operations?.[0]])

    expect(overrides).toEqual([
      ['module-override:acl.features', 'disable-replace'],
      ['module-override:ai.agents', 'disable-replace'],
      ['module-override:ai.extensions', 'additive'],
      ['module-override:ai.tools', 'disable-replace'],
      ['module-override:cli', 'disable-replace'],
      ['module-override:commandInterceptors', 'disable-replace'],
      ['module-override:di', 'disable-replace'],
      ['module-override:encryption.maps', 'disable-replace'],
      ['module-override:enrichers', 'disable-replace'],
      ['module-override:events.subscribers', 'disable-replace'],
      ['module-override:guards', 'disable-replace'],
      ['module-override:interceptors', 'disable-replace'],
      ['module-override:nav.groupOrder', 'additive'],
      ['module-override:notifications.handlers', 'disable-replace'],
      ['module-override:notifications.types', 'disable-replace'],
      ['module-override:routes.api', 'disable-replace'],
      ['module-override:routes.pages', 'disable-replace'],
      ['module-override:setup', 'replace'],
      ['module-override:widgets.components', 'disable-replace'],
      ['module-override:widgets.dashboard', 'disable-replace'],
      ['module-override:widgets.injection', 'disable-replace'],
      ['module-override:workers', 'disable-replace'],
    ])
  })

  it('reports declarations whose authoritative source no longer binds the host key', () => {
    write(moduleRoot, 'extension-points.ts', `
      export const extensionPoints = defineModuleExtensionPoints({
        moduleId: 'alpha',
        hosts: { records: dataTableExtensionHost({ tableId: 'alpha.records', source: 'Records.tsx' }) },
      })
    `)
    write(moduleRoot, 'Records.tsx', "export const tableId = 'alpha.records'")

    const facts = extractModuleExtensionFacts({
      moduleId: 'alpha',
      moduleRoot,
      sourceRoot: 'node_modules/pkg/src/modules/alpha',
      entities: [],
      events: [],
      apiRoutes: [],
      searchEntities: [],
    })

    expect(facts.unresolved).toEqual([
      expect.objectContaining({ key: 'alpha.records', reason: 'unbound-declaration' }),
    ])
    expect(facts.hosts.filter((host) => host.key.startsWith('records.')).every((host) => !host.bound)).toBe(true)
  })

  it('fails closed when a correlated first-party target remains unresolved', () => {
    expect(() => assertNoUnresolvedExtensionTargets({
      alpha: {
        hosts: [],
        contributions: [],
        unresolved: [{
          key: 'alpha.widget:data-table:alpha.missing',
          source: { path: 'widgets/injection-table.ts' },
          reason: 'unresolved-first-party-target',
        }],
      },
    })).toThrow('alpha:alpha.widget:data-table:alpha.missing')
  })
})
