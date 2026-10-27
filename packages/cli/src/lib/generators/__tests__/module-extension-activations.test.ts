import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  assertNoUnresolvedExtensionTargets,
  correlateIncomingExtensions,
  correlateModuleExtensionFacts,
  extractActivationTargetOwners,
  extractModuleExtensionFacts,
  withModuleExtensionFactExtractionCache,
  ALL_ACTIVATION_KINDS,
  type ApiRouteInterceptorBridge,
} from '../module-extension-facts'
import { renderModuleFactsMarkdown, type ModuleFacts } from '../module-facts'
import type {
  ModuleExtensionSurfaceFacts,
  ModuleExtensionContributionFact,
} from '@open-mercato/shared/modules/widgets/extension-points'

function write(root: string, relativePath: string, source: string): void {
  const filePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, source)
}

type ModuleSpec = {
  id: string
  entities?: Array<{ id: string }>
  events?: Array<{ id: string; clientBroadcast?: boolean; portalBroadcast?: boolean }>
  apiRoutes?: Array<{ path: string; methods: string[] }>
  searchEntities?: string[]
  notifications?: string[]
}

function runPipeline(
  roots: Record<string, string>,
  modules: ModuleSpec[],
): Record<string, ModuleExtensionSurfaceFacts> {
  return withModuleExtensionFactExtractionCache(() => {
    const surfacesByModule: Record<string, ModuleExtensionSurfaceFacts> = {}
    const entityIds = new Set<string>()
    const eventIds = new Set<string>()
    const apiRoutes = new Set<string>()
    const commandIds = new Set<string>()
    for (const module of modules) {
      const sourceRoot = `node_modules/pkg/src/modules/${module.id}`
      surfacesByModule[module.id] = extractModuleExtensionFacts({
        moduleId: module.id,
        moduleRoot: roots[module.id],
        sourceRoot,
        entities: module.entities ?? [],
        events: module.events ?? [],
        apiRoutes: module.apiRoutes ?? [],
        searchEntities: module.searchEntities ?? [],
        notifications: module.notifications,
      })
      for (const entity of module.entities ?? []) entityIds.add(entity.id)
      for (const event of module.events ?? []) eventIds.add(event.id)
      for (const route of module.apiRoutes ?? []) apiRoutes.add(route.path)
    }
    const apiRouteOwners = new Map<string, {
      moduleId: string
      source: { sourcePath: string }
      bridges: ApiRouteInterceptorBridge[]
    }>()
    const commandOwners = new Map<string, { moduleId: string; source: { sourcePath: string } }>()
    for (const module of modules) {
      const sourceRoot = `node_modules/pkg/src/modules/${module.id}`
      const owners = extractActivationTargetOwners({ moduleId: module.id, moduleRoot: roots[module.id], sourceRoot })
      for (const route of owners.apiRoutes) {
        apiRoutes.add(`/${route.id}`)
        if (!apiRouteOwners.has(route.id)) {
          apiRouteOwners.set(route.id, { moduleId: module.id, source: route.source, bridges: route.bridges })
        }
      }
      for (const command of owners.commands) {
        commandIds.add(command.id)
        if (!commandOwners.has(command.id)) commandOwners.set(command.id, { moduleId: module.id, source: command.source })
      }
    }
    const correlated = correlateModuleExtensionFacts({ surfacesByModule, entityIds, eventIds, apiRoutes, commandIds })
    assertNoUnresolvedExtensionTargets(correlated)
    return correlateIncomingExtensions({ surfacesByModule: correlated, apiRouteOwners, commandOwners })
  })
}

describe('module extension activations and incoming index', () => {
  let workspace: string
  const roots: Record<string, string> = {}

  const moduleRoot = (id: string): string => {
    if (!roots[id]) {
      roots[id] = path.join(workspace, id)
      fs.mkdirSync(roots[id], { recursive: true })
    }
    return roots[id]
  }

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'module-activations-'))
    for (const key of Object.keys(roots)) delete roots[key]
  })

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  it('binds only the CRUD response enricher from the factory option, never the query stage', () => {
    write(moduleRoot('host'), 'api/records/route.ts', `
      import { makeCrudRoute } from 'x'
      export const crud = makeCrudRoute({
        orm: { entity: Rec },
        enrichers: { entityId: 'host:record' },
      })
      export const GET = crud.GET
    `)
    write(moduleRoot('ext'), 'data/enrichers.ts', `
      export const enrichers = [{ id: 'ext.record-badge', targetEntity: 'host:record', async enrichOne(r) { return r } }]
    `)

    const result = runPipeline(roots, [
      { id: 'host', entities: [{ id: 'host:record' }], apiRoutes: [{ path: '/host/records', methods: ['GET'] }] },
      { id: 'ext' },
    ])

    // `enrichers: { entityId }` runs `applyResponseEnrichers` only; the query-engine
    // enricher stage needs a query call that passes `extensions`.
    const enricherActivations = (result.host.activations ?? []).filter((a) => a.host.id === 'host:record')
    expect(enricherActivations.map((a) => a.kind)).toEqual(['crud-response-enricher'])
    expect(enricherActivations[0].source.sourcePath).toBe('node_modules/pkg/src/modules/host/api/records/route.ts')
    expect(enricherActivations[0].source.line).toBeGreaterThan(0)
    expect(enricherActivations[0].host).toEqual({ kind: 'entity', id: 'host:record', moduleId: 'host' })

    const incoming = (result.host.incoming ?? []).filter((entry) => entry.contributionId === 'ext.record-badge')
    expect(incoming).toHaveLength(1)
    expect(incoming[0].resolution).toBe('bound')
    expect(incoming[0].contributorModuleId).toBe('ext')
    expect(incoming[0].activationId).toBe('entity:host:record:crud-response-enricher')

    const resolutions = (result.ext.contributionResolutions ?? []).filter((r) => r.contributionId === 'ext.record-badge')
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0].resolution).toBe('bound')
    expect(resolutions[0].activationIds).toEqual(['entity:host:record:crud-response-enricher'])
    expect(resolutions[0].target).toEqual({ kind: 'entity', id: 'host:record', moduleId: 'host' })
  })

  it('binds the query-enricher stage from a query call site that passes extensions', () => {
    write(moduleRoot('host'), 'api/records/route.ts', `
      import { makeCrudRoute } from 'x'
      export const crud = makeCrudRoute({
        orm: { entity: Rec },
        enrichers: { entityId: 'host:record' },
      })
      export async function GET(req) {
        const queryEngine = resolve('queryEngine')
        return queryEngine.query('host:record', { tenantId: 't', extensions: { userId: 'u' } })
      }
    `)
    write(moduleRoot('ext'), 'data/enrichers.ts', `
      export const enrichers = [{ id: 'ext.record-badge', targetEntity: 'host:record', queryEngine: { enabled: true }, async enrichOne(r) { return r } }]
    `)

    const result = runPipeline(roots, [
      { id: 'host', entities: [{ id: 'host:record' }], apiRoutes: [{ path: '/host/records', methods: ['GET'] }] },
      { id: 'ext' },
    ])

    const kinds = (result.host.activations ?? [])
      .filter((a) => a.host.id === 'host:record')
      .map((a) => a.kind)
      .sort()
    expect(kinds).toEqual(['crud-response-enricher', 'query-enricher'])
  })

  it('treats an enricher with queryEngine.enabled false as response-only', () => {
    write(moduleRoot('ext'), 'data/enrichers.ts', `
      export const enrichers = [
        { id: 'ext.disabled', targetEntity: 'host:record', queryEngine: { enabled: false, engines: ['json'] }, async enrichOne(r) { return r } },
        { id: 'ext.enabled', targetEntity: 'host:record', queryEngine: { enabled: true, engines: ['json'] }, async enrichOne(r) { return r } },
        { id: 'ext.plain', targetEntity: 'host:record', async enrichOne(r) { return r } },
      ]
    `)

    write(moduleRoot('host'), 'api/records/route.ts', `
      import { makeCrudRoute } from 'x'
      export const crud = makeCrudRoute({ orm: { entity: Rec } })
      export const GET = crud.GET
    `)

    const result = runPipeline(roots, [
      { id: 'host', entities: [{ id: 'host:record' }] },
      { id: 'ext' },
    ])

    const byId = new Map((result.ext.contributions ?? []).map((contribution) => [contribution.id, contribution]))
    const disabled = byId.get('ext.disabled')
    const enabled = byId.get('ext.enabled')
    const plain = byId.get('ext.plain')
    expect(disabled?.details).not.toHaveProperty('queryEngine')
    expect(disabled?.activation).toBe('host-opt-in')
    expect(plain?.details).not.toHaveProperty('queryEngine')
    expect(enabled?.details).toHaveProperty('queryEngine')
    expect(enabled?.activation).toBe('caller-opt-in')
  })

  it('classifies an enricher targeting an entity WITHOUT the factory option as capability-only, never bound', () => {
    write(moduleRoot('host'), 'api/records/route.ts', `
      import { makeCrudRoute } from 'x'
      export const crud = makeCrudRoute({ orm: { entity: Rec } })
      export const GET = crud.GET
    `)
    write(moduleRoot('ext'), 'data/enrichers.ts', `
      export const enrichers = [{ id: 'ext.record-badge', targetEntity: 'host:record', async enrichOne(r) { return r } }]
    `)

    const result = runPipeline(roots, [
      { id: 'host', entities: [{ id: 'host:record' }], apiRoutes: [{ path: '/host/records', methods: ['GET'] }] },
      { id: 'ext' },
    ])

    expect((result.host.activations ?? []).some((a) => a.kind === 'crud-response-enricher')).toBe(false)
    const incoming = (result.host.incoming ?? []).filter((entry) => entry.contributionId === 'ext.record-badge')
    expect(incoming).toHaveLength(1)
    expect(incoming[0].resolution).toBe('capability-only')
    expect(incoming[0].activationId).toBeUndefined()

    const resolution = (result.ext.contributionResolutions ?? []).find((r) => r.contributionId === 'ext.record-badge')
    expect(resolution?.resolution).toBe('capability-only')
    expect(resolution?.activationIds).toEqual([])
  })

  it('binds a mutation guard only when the bridge is called, not from data/guards.ts alone', () => {
    write(moduleRoot('host'), 'api/records/route.ts', `
      import { validateCrudMutationGuard } from 'x'
      export async function POST(req, ctx) {
        const guardResult = await validateCrudMutationGuard(ctx.container, {
          resourceKind: 'host:record', operation: 'update', requestMethod: 'POST',
        })
        return guardResult
      }
    `)
    write(moduleRoot('guard-only'), 'data/guards.ts', `
      export const guards = [{ id: 'guard-only.rec', targetEntity: 'guard-only:record', operations: ['update'], async validate() {} }]
    `)
    write(moduleRoot('ext'), 'data/guards.ts', `
      export const guards = [{ id: 'ext.rec-guard', targetEntity: 'host:record', operations: ['update'], async validate() {} }]
    `)

    const result = runPipeline(roots, [
      { id: 'host', entities: [{ id: 'host:record' }], apiRoutes: [{ path: '/host/records', methods: ['POST'] }] },
      { id: 'guard-only', entities: [{ id: 'guard-only:record' }] },
      { id: 'ext' },
    ])

    // Bridge call site produced a mutation-guard activation on the host.
    expect((result.host.activations ?? []).some((a) => a.kind === 'mutation-guard' && a.host.id === 'host:record')).toBe(true)
    // data/guards.ts existence alone does NOT create an activation for its own entity.
    expect((result['guard-only'].activations ?? [])).toEqual([])

    const boundGuard = (result.host.incoming ?? []).find((entry) => entry.contributionId === 'ext.rec-guard')
    expect(boundGuard?.resolution).toBe('bound')
    expect(boundGuard?.activationId).toBe('entity:host:record:mutation-guard')

    const guardOnlyResolution = (result['guard-only'].contributionResolutions ?? []).find((r) => r.contributionId === 'guard-only.rec')
    // Same-module guard whose entity has no bridge activation is capability-only.
    expect(guardOnlyResolution?.resolution).toBe('capability-only')
  })

  it('binds api and command interceptor contributions to exact host identities across modules', () => {
    write(moduleRoot('host'), 'api/records/route.ts', `
      import { makeCrudRoute } from 'x'
      export const { POST } = makeCrudRoute({ orm: { entity: Rec } })
    `)
    write(moduleRoot('host'), 'commands/update.ts', `
      const updateCommand = { id: 'host.records.update', async execute() {} }
      registerCommand(updateCommand)
    `)
    write(moduleRoot('ext'), 'api/interceptors.ts', `
      export const interceptors = [{ id: 'ext.records.interceptor', targetRoute: 'host/records', methods: ['POST'], async before() {}, async after() {} }]
    `)
    write(moduleRoot('ext'), 'commands/interceptors.ts', `
      export const interceptors = [{ id: 'ext.records.command', targetCommand: 'host.records.update', async beforeExecute() {} }]
    `)

    const result = runPipeline(roots, [
      { id: 'host', apiRoutes: [{ path: '/host/records', methods: ['POST'] }] },
      { id: 'ext' },
    ])

    const apiIncoming = (result.host.incoming ?? []).find((entry) => entry.contributionId === 'ext.records.interceptor')
    expect(apiIncoming?.resolution).toBe('bound')
    expect(apiIncoming?.target).toEqual(expect.objectContaining({ kind: 'api-route', id: 'host/records', moduleId: 'host' }))
    // The activation identity carries the bridged method the interceptor matched.
    expect(apiIncoming?.activationId).toBe('api-route:host/records:POST:api-interceptor-bridge')
    const apiActivation = (result.host.activations ?? []).find((a) => a.id === 'api-route:host/records:POST:api-interceptor-bridge')
    expect(apiActivation?.phases).toEqual(['after', 'before'])
    expect(apiActivation?.host.method).toBe('POST')
    expect(apiActivation?.source.sourcePath).toContain('host/api/records/route.ts')

    const commandIncoming = (result.host.incoming ?? []).find((entry) => entry.contributionId === 'ext.records.command')
    expect(commandIncoming?.resolution).toBe('bound')
    expect(commandIncoming?.target).toEqual(expect.objectContaining({ kind: 'command', id: 'host.records.update', moduleId: 'host' }))
    expect(commandIncoming?.activationId).toBe('command:host.records.update:command-interceptor-bridge')
    const commandActivation = (result.host.activations ?? [])
      .find((activation) => activation.id === 'command:host.records.update:command-interceptor-bridge')
    expect(commandActivation?.bridge).toEqual({
      factSection: 'ownedContracts.command',
      factKey: 'host.records.update',
    })
  })

  it('binds widget-spot and replaceable-component consumption to the declared host', () => {
    write(moduleRoot('host'), 'extension-points.ts', `
      import { defineModuleExtensionPoints, dataTableExtensionHost, componentExtensionHost } from 'x'
      export const extensionPoints = defineModuleExtensionPoints({
        moduleId: 'host',
        hosts: {
          records: dataTableExtensionHost({ tableId: 'host.records', source: 'Records.tsx' }),
          detail: componentExtensionHost({ componentId: 'page:host.detail', source: 'Detail.tsx' }),
        },
      })
    `)
    write(moduleRoot('host'), 'Records.tsx', 'export const tableId = extensionPoints.hosts.records.tableId')
    write(moduleRoot('host'), 'Detail.tsx', 'export const id = extensionPoints.hosts.detail.componentId')
    write(moduleRoot('ext'), 'widgets/injection-table.ts', `
      export const injectionTable = {
        'data-table:host.records:columns': [{ widgetId: 'ext.column' }],
      }
    `)
    write(moduleRoot('ext'), 'widgets/components.ts', `
      export const componentOverrides = [{ target: { componentId: 'page:host.detail' }, wrapper: true }]
    `)

    const result = runPipeline(roots, [
      { id: 'host', entities: [{ id: 'host:record' }] },
      { id: 'ext' },
    ])

    const columnIncoming = (result.host.incoming ?? []).find((entry) => entry.contributionKind === 'data-table')
    expect(columnIncoming?.resolution).toBe('bound')
    expect(columnIncoming?.target).toEqual(expect.objectContaining({ kind: 'widget-spot', id: 'data-table:host.records:columns', moduleId: 'host' }))
    const columnActivation = (result.host.activations ?? []).find((a) => a.kind === 'widget-injection-consumer')
    expect(columnActivation?.source.sourcePath).toContain('host/extension-points.ts')

    const componentIncoming = (result.host.incoming ?? []).find((entry) => entry.contributionKind === 'component-override')
    expect(componentIncoming?.resolution).toBe('bound')
    expect(componentIncoming?.target).toEqual(expect.objectContaining({ kind: 'component', id: 'page:host.detail', moduleId: 'host' }))
    expect((result.host.activations ?? []).some((a) => a.kind === 'component-extension-consumer')).toBe(true)
  })

  it('records optional-missing and wildcard resolutions without incoming rows and without failing the build', () => {
    write(moduleRoot('ext'), 'data/enrichers.ts', `
      export const enrichers = [{ id: 'ext.optional', targetEntity: 'absent:thing', async enrichOne(r) { return r } }]
    `)
    write(moduleRoot('ext'), 'api/interceptors.ts', `
      export const interceptors = [{ id: 'ext.wildcard', targetRoute: '*', methods: ['POST'], async before() {} }]
    `)

    const result = runPipeline(roots, [{ id: 'ext' }])

    const optional = (result.ext.contributionResolutions ?? []).find((r) => r.contributionId === 'ext.optional')
    expect(optional?.resolution).toBe('optional-target-missing')
    expect(optional?.activationIds).toEqual([])

    const wildcard = (result.ext.contributionResolutions ?? []).find((r) => r.contributionId === 'ext.wildcard')
    expect(wildcard?.resolution).toBe('wildcard')
    expect(wildcard?.target.kind).toBe('wildcard')

    // Neither optional-missing nor wildcard owns a concrete target, so no incoming rows exist anywhere.
    for (const surface of Object.values(result)) {
      expect((surface.incoming ?? []).length).toBe(0)
    }
  })

  it('emits one incoming row per duplicate provider targeting the same host activation', () => {
    write(moduleRoot('host'), 'api/records/route.ts', `
      import { makeCrudRoute } from 'x'
      export const crud = makeCrudRoute({ orm: { entity: Rec }, enrichers: { entityId: 'host:record' } })
      export const GET = crud.GET
    `)
    write(moduleRoot('ext-a'), 'data/enrichers.ts', `
      export const enrichers = [{ id: 'ext-a.badge', targetEntity: 'host:record', async enrichOne(r) { return r } }]
    `)
    write(moduleRoot('ext-b'), 'data/enrichers.ts', `
      export const enrichers = [{ id: 'ext-b.badge', targetEntity: 'host:record', async enrichOne(r) { return r } }]
    `)

    const result = runPipeline(roots, [
      { id: 'host', entities: [{ id: 'host:record' }], apiRoutes: [{ path: '/host/records', methods: ['GET'] }] },
      { id: 'ext-a' },
      { id: 'ext-b' },
    ])

    const contributors = new Set((result.host.incoming ?? []).map((entry) => entry.contributorModuleId))
    expect(contributors).toEqual(new Set(['ext-a', 'ext-b']))
    // The route activates response enrichment only, so each contributor matches one activation.
    expect((result.host.incoming ?? []).filter((e) => e.contributorModuleId === 'ext-a')).toHaveLength(1)
    expect((result.host.incoming ?? []).filter((e) => e.contributorModuleId === 'ext-b')).toHaveLength(1)
  })

  it('marks a genuinely unresolved concrete target distinctly from optional-missing', () => {
    const contribution: ModuleExtensionContributionFact = {
      id: 'ext.broken',
      kind: 'response-enricher',
      targets: [{ id: 'host:missing', resolution: 'unresolved' }],
      scopeContract: 'tenant-and-organization',
      source: { path: 'data/enrichers.ts', symbol: 'ext.broken' },
      details: {
        targetEntity: 'host:missing', surfaces: ['detail'], timeoutMs: 2000,
        fallback: 'none', critical: false, cachePosture: 'rerun-on-list-cache-hit',
      },
    }
    const result = correlateIncomingExtensions({
      surfacesByModule: {
        ext: { hosts: [], contributions: [contribution], unresolved: [], activations: [] },
      },
    })
    const resolution = (result.ext.contributionResolutions ?? [])[0]
    expect(resolution.resolution).toBe('unresolved')
    expect((result.ext.incoming ?? [])).toEqual([])
  })

  it('leaves the existing hosts and contributions arrays untouched by the additive topology fields', () => {
    write(moduleRoot('host'), 'api/records/route.ts', `
      import { makeCrudRoute } from 'x'
      export const crud = makeCrudRoute({ orm: { entity: Rec }, enrichers: { entityId: 'host:record' } })
      export const GET = crud.GET
    `)
    const surface = withModuleExtensionFactExtractionCache(() => extractModuleExtensionFacts({
      moduleId: 'host',
      moduleRoot: roots.host = moduleRoot('host'),
      sourceRoot: 'node_modules/pkg/src/modules/host',
      entities: [{ id: 'host:record' }],
      events: [],
      apiRoutes: [{ path: '/host/records', methods: ['GET'] }],
      searchEntities: [],
    }))
    const correlated = correlateModuleExtensionFacts({
      surfacesByModule: { host: surface },
      entityIds: new Set(['host:record']),
      eventIds: new Set(),
      apiRoutes: new Set(['/host/records']),
      commandIds: new Set(),
    })
    const withIncoming = correlateIncomingExtensions({ surfacesByModule: correlated }).host
    expect(withIncoming.hosts).toEqual(correlated.host.hosts)
    expect(withIncoming.contributions).toEqual(correlated.host.contributions)
    expect(Array.isArray(withIncoming.activations)).toBe(true)
    expect(Array.isArray(withIncoming.incoming)).toBe(true)
    expect(Array.isArray(withIncoming.contributionResolutions)).toBe(true)
  })

  it('renders three distinct markdown sections without merging capability and bound rows', () => {
    const surface: ModuleExtensionSurfaceFacts = {
      hosts: [],
      contributions: [],
      unresolved: [],
      activations: [{
        id: 'entity:host:record:crud-response-enricher',
        kind: 'crud-response-enricher',
        host: { kind: 'entity', id: 'host:record', moduleId: 'host' },
        contributionKinds: ['response-enricher'],
        source: { sourcePath: 'node_modules/pkg/src/modules/host/api/records/route.ts', line: 5 },
        bridge: { factSection: 'apiRoutes', factKey: '/host/records' },
      }],
      incoming: [{
        contributionId: 'ext.badge',
        contributionKind: 'response-enricher',
        contributorModuleId: 'ext',
        target: { kind: 'entity', id: 'host:record', moduleId: 'host' },
        activationId: 'entity:host:record:crud-response-enricher',
        resolution: 'bound',
        source: { sourcePath: 'node_modules/pkg/src/modules/ext/data/enrichers.ts', exportName: 'ext.badge' },
      }],
      contributionResolutions: [{
        contributionId: 'ext.badge',
        target: { kind: 'entity', id: 'host:record', moduleId: 'host' },
        resolution: 'bound',
        activationIds: ['entity:host:record:crud-response-enricher'],
      }],
    }
    const facts: ModuleFacts = {
      module: 'host', title: null, description: null, coreVersion: null, sourcePackage: null,
      sourceVersion: null, sourceRoot: 'node_modules/pkg/src/modules/host', entities: [], events: [],
      aclFeatures: [], apiRoutes: [], diTokens: [], searchEntities: [],
      hostTokens: { entityIds: [], tableIds: [] }, notifications: [], cli: [],
      backendPages: [], frontendPages: [], cliCommands: [], aiTools: [], aiAgents: [],
      extensionSurfaces: surface, warnings: [],
    }
    const markdown = renderModuleFactsMarkdown(facts)
    expect(markdown).toContain('## UMES hosts')
    expect(markdown).toContain('## Active extension bindings')
    expect(markdown).toContain('## Incoming installed contributions')
    expect(markdown).toContain('crud-response-enricher')
    expect(markdown).toContain('entity:host:record @host')
    expect(markdown.indexOf('## Active extension bindings')).toBeLessThan(markdown.indexOf('## Incoming installed contributions'))

    // Activation rows are identified by the referenced activation id and bridge, not by kind alone.
    expect(markdown).toContain('| Activation | Kind | Host | Contribution kinds | Phases | Bridge | Source |')
    expect(markdown).toContain('| entity:host:record:crud-response-enricher | crud-response-enricher |')
    expect(markdown).toContain('apiRoutes:/host/records')

    // Contribution resolutions render as their own section.
    expect(markdown).toContain('## Contribution resolutions')
    expect(markdown).toContain('| Contribution | Target | Resolution | Activations | Source |')
    expect(markdown).toContain('| ext.badge | entity:host:record @host | bound | entity:host:record:crud-response-enricher |')
  })

  it('never binds an api interceptor to a route with no interceptor bridge', () => {
    write(moduleRoot('host'), 'api/custom/route.ts', `
      export async function POST(req) { return new Response('ok') }
    `)
    write(moduleRoot('ext'), 'api/interceptors.ts', `
      export const interceptors = [{ id: 'ext.custom.interceptor', targetRoute: 'host/custom', methods: ['POST'], async before() {} }]
    `)

    const result = runPipeline(roots, [
      { id: 'host', apiRoutes: [{ path: '/host/custom', methods: ['POST'] }] },
      { id: 'ext' },
    ])

    const resolution = (result.ext.contributionResolutions ?? [])
      .find((entry) => entry.contributionId === 'ext.custom.interceptor')
    expect(resolution?.resolution).toBe('capability-only')
    expect(resolution?.activationIds).toEqual([])
    expect((result.host.activations ?? []).filter((a) => a.kind === 'api-interceptor-bridge')).toEqual([])
  })

  it('binds only the phase a hand-written route actually runs', () => {
    write(moduleRoot('host'), 'api/custom/route.ts', `
      import { runApiInterceptorsAfter } from 'x'
      export async function POST(req) {
        const response = await handle(req)
        return runApiInterceptorsAfter({ routePath: '/host/custom', method: 'POST', response, context: ctx })
      }
    `)
    write(moduleRoot('ext'), 'api/interceptors.ts', `
      export const interceptors = [
        { id: 'ext.after-only', targetRoute: 'host/custom', methods: ['POST'], async after() {} },
        { id: 'ext.before-only', targetRoute: 'host/custom', methods: ['POST'], async before() {} },
      ]
    `)

    const result = runPipeline(roots, [
      { id: 'host', apiRoutes: [{ path: '/host/custom', methods: ['POST'] }] },
      { id: 'ext' },
    ])

    const byId = new Map((result.ext.contributionResolutions ?? []).map((entry) => [entry.contributionId, entry]))
    expect(byId.get('ext.after-only')?.resolution).toBe('bound')
    expect(byId.get('ext.after-only')?.activationIds).toEqual(['api-route:host/custom:POST:api-interceptor-bridge'])
    // The route never runs the before phase, so a before-only interceptor is not active.
    expect(byId.get('ext.before-only')?.resolution).toBe('capability-only')
    expect(byId.get('ext.before-only')?.activationIds).toEqual([])
  })

  it('never binds an api interceptor whose method the route does not handle', () => {
    write(moduleRoot('host'), 'api/records/route.ts', `
      import { makeCrudRoute } from 'x'
      export const crud = makeCrudRoute({ orm: { entity: Rec } })
      export const GET = crud.GET
    `)
    write(moduleRoot('ext'), 'api/interceptors.ts', `
      export const interceptors = [{ id: 'ext.delete-only', targetRoute: 'host/records', methods: ['DELETE'], async before() {} }]
    `)

    const result = runPipeline(roots, [
      { id: 'host', apiRoutes: [{ path: '/host/records', methods: ['GET'] }] },
      { id: 'ext' },
    ])

    const resolution = (result.ext.contributionResolutions ?? [])
      .find((entry) => entry.contributionId === 'ext.delete-only')
    expect(resolution?.resolution).toBe('capability-only')
    expect(resolution?.activationIds).toEqual([])
  })

  it('binds the canonical runRouteMutationGuards shape declared in a lib wrapper', () => {
    write(moduleRoot('host'), 'lib/route-mutation-guard.ts', `
      import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
      export async function guardRecordMutation(container, req, auth) {
        return runRouteMutationGuards({
          container,
          req,
          auth,
          input: { resourceKind: 'host:record', operation: 'delete' },
        })
      }
    `)
    write(moduleRoot('ext'), 'data/guards.ts', `
      export const guards = [{ id: 'ext.rec-delete', targetEntity: 'host:record', operations: ['delete'], async validate() {} }]
    `)

    const result = runPipeline(roots, [
      { id: 'host', entities: [{ id: 'host:record' }] },
      { id: 'ext' },
    ])

    const activation = (result.host.activations ?? []).find((entry) => entry.kind === 'mutation-guard')
    expect(activation?.host).toEqual({ kind: 'entity', id: 'host:record', moduleId: 'host' })
    expect(activation?.operations).toEqual(['delete'])
    expect(activation?.source.sourcePath).toContain('host/lib/route-mutation-guard.ts')

    const resolution = (result.ext.contributionResolutions ?? [])
      .find((entry) => entry.contributionId === 'ext.rec-delete')
    expect(resolution?.resolution).toBe('bound')
    expect(resolution?.activationIds).toEqual(['entity:host:record:mutation-guard'])
  })

  it('does not bind a guard whose operations the call site never guards', () => {
    write(moduleRoot('host'), 'lib/route-mutation-guard.ts', `
      import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
      export async function guardRecordDelete(container, req, auth) {
        return runRouteMutationGuards({ container, req, auth, input: { resourceKind: 'host:record', operation: 'delete' } })
      }
    `)
    write(moduleRoot('ext'), 'data/guards.ts', `
      export const guards = [{ id: 'ext.rec-create', targetEntity: 'host:record', operations: ['create'], async validate() {} }]
    `)

    const result = runPipeline(roots, [
      { id: 'host', entities: [{ id: 'host:record' }] },
      { id: 'ext' },
    ])

    const resolution = (result.ext.contributionResolutions ?? [])
      .find((entry) => entry.contributionId === 'ext.rec-create')
    expect(resolution?.resolution).toBe('capability-only')
    expect(resolution?.activationIds).toEqual([])
  })

  it('unions operations from multiple mutation-guard bridges for the same entity', () => {
    write(moduleRoot('host'), 'api/records/route.ts', `
      import { validateCrudMutationGuard } from 'x'
      export async function POST(container) {
        return validateCrudMutationGuard(container, { resourceKind: 'host:record', operation: 'create' })
      }
      export async function DELETE(container) {
        return validateCrudMutationGuard(container, { resourceKind: 'host:record', operation: 'delete' })
      }
    `)
    write(moduleRoot('ext'), 'data/guards.ts', `
      export const guards = [
        { id: 'ext.rec-create', targetEntity: 'host:record', operations: ['create'], async validate() {} },
        { id: 'ext.rec-delete', targetEntity: 'host:record', operations: ['delete'], async validate() {} },
      ]
    `)

    const result = runPipeline(roots, [
      { id: 'host', entities: [{ id: 'host:record' }] },
      { id: 'ext' },
    ])

    const activation = (result.host.activations ?? []).find((entry) => entry.kind === 'mutation-guard')
    expect(activation?.operations).toEqual(['create', 'delete'])
    const resolutions = new Map(
      (result.ext.contributionResolutions ?? []).map((entry) => [entry.contributionId, entry]),
    )
    expect(resolutions.get('ext.rec-create')?.resolution).toBe('bound')
    expect(resolutions.get('ext.rec-delete')?.resolution).toBe('bound')
  })

  it('maps a custom action endpoint onto the update registry operation', () => {
    write(moduleRoot('host'), 'api/records/archive/route.ts', `
      import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
      export async function POST(req) {
        return runRouteMutationGuards({ container, req, auth, input: { resourceKind: 'host:record', operation: 'custom' } })
      }
    `)
    write(moduleRoot('ext'), 'data/guards.ts', `
      export const guards = [{ id: 'ext.rec-update', targetEntity: 'host:record', operations: ['update'], async validate() {} }]
    `)

    const result = runPipeline(roots, [
      { id: 'host', entities: [{ id: 'host:record' }] },
      { id: 'ext' },
    ])

    const activation = (result.host.activations ?? []).find((entry) => entry.kind === 'mutation-guard')
    expect(activation?.operations).toEqual(['update'])
    const resolution = (result.ext.contributionResolutions ?? [])
      .find((entry) => entry.contributionId === 'ext.rec-update')
    expect(resolution?.resolution).toBe('bound')
  })

  it('executes every activation adapter: each kind produces a bound activation', () => {
    write(moduleRoot('host'), 'extension-points.ts', `
      import { defineModuleExtensionPoints, dataTableExtensionHost, componentExtensionHost } from 'x'
      export const extensionPoints = defineModuleExtensionPoints({
        moduleId: 'host',
        hosts: {
          records: dataTableExtensionHost({ tableId: 'host.records', source: 'Records.tsx' }),
          detail: componentExtensionHost({ componentId: 'page:host.detail', source: 'Detail.tsx' }),
        },
      })
    `)
    write(moduleRoot('host'), 'Records.tsx', 'export const tableId = extensionPoints.hosts.records.tableId')
    write(moduleRoot('host'), 'Detail.tsx', 'export const id = extensionPoints.hosts.detail.componentId')
    write(moduleRoot('host'), 'api/records/route.ts', `
      import { makeCrudRoute } from 'x'
      import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
      export const crud = makeCrudRoute({ orm: { entity: Rec }, enrichers: { entityId: 'host:record' } })
      export const POST = crud.POST
      export async function GET(req) {
        await runRouteMutationGuards({ container, req, auth, input: { resourceKind: 'host:record' } })
        return queryEngine.query('host:record', { tenantId: 't', extensions: { userId: 'u' } })
      }
    `)
    write(moduleRoot('host'), 'commands/update.ts', `
      const updateCommand = { id: 'host.records.update', async execute() {} }
      registerCommand(updateCommand)
    `)
    write(moduleRoot('ext'), 'data/enrichers.ts', `
      export const enrichers = [{ id: 'ext.badge', targetEntity: 'host:record', async enrichOne(r) { return r } }]
    `)
    write(moduleRoot('ext'), 'data/guards.ts', `
      export const guards = [{ id: 'ext.guard', targetEntity: 'host:record', operations: ['update'], async validate() {} }]
    `)
    write(moduleRoot('ext'), 'api/interceptors.ts', `
      export const interceptors = [{ id: 'ext.interceptor', targetRoute: 'host/records', methods: ['POST'], async before() {} }]
    `)
    write(moduleRoot('ext'), 'commands/interceptors.ts', `
      export const interceptors = [{ id: 'ext.command', targetCommand: 'host.records.update', async beforeExecute() {} }]
    `)
    write(moduleRoot('ext'), 'widgets/injection-table.ts', `
      export const injectionTable = {
        'data-table:host.records:columns': [{ widgetId: 'ext.column' }],
      }
    `)
    write(moduleRoot('ext'), 'widgets/components.ts', `
      export const componentOverrides = [{ target: { componentId: 'page:host.detail' }, wrapper: true }]
    `)
    write(moduleRoot('ext'), 'widgets/dashboard/stats/widget.ts', `
      export const widget = { metadata: { id: 'ext.stats', title: 'Stats' } }
      export default widget
    `)

    const result = runPipeline(roots, [
      { id: 'host', entities: [{ id: 'host:record' }], apiRoutes: [{ path: '/host/records', methods: ['GET', 'POST'] }] },
      { id: 'ext' },
    ])

    const activationKinds = new Set(
      Object.values(result).flatMap((surface) => (surface.activations ?? []).map((activation) => activation.kind)),
    )
    expect([...activationKinds].sort()).toEqual([...ALL_ACTIVATION_KINDS].sort())

    // Dashboard contributions bind to the framework `dashboard:*` host, which owns no
    // module surface — the activation is recorded on the contributor with a traceable
    // framework source, and no incoming row is emitted.
    const dashboardActivation = (result.ext.activations ?? [])
      .find((activation) => activation.kind === 'dashboard-host-consumer')
    expect(dashboardActivation?.source.sourcePath).toBe('packages/ui/src')
    expect(dashboardActivation?.bridge).toEqual({ factSection: 'hosts', factKey: 'framework.dashboard' })
    expect((result.ext.incoming ?? []).some((entry) => entry.contributionKind === 'widget'
      && entry.target.id.startsWith('dashboard:'))).toBe(false)

    const dashboardResolution = (result.ext.contributionResolutions ?? [])
      .find((entry) => entry.target.id.startsWith('dashboard:'))
    expect(dashboardResolution?.resolution).toBe('bound')
  })
})
