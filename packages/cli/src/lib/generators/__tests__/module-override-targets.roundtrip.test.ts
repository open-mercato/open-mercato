import {
  applyApiOverridesToManifests,
  applyDiOverrides,
  applyDiOverridesToContainer,
  applyInjectionWidgetOverridesToEntries,
  applyPageGuardOverridesToEntries,
  applyPageOverridesToManifests,
  applyWorkerOverridesToDescriptors,
  resetModuleContractOverridesForTests,
} from '@open-mercato/shared/modules/overrides'
import type { ModuleFactsJsonEntry } from '../module-facts'
import { collectModuleOverrideTargets, type ModuleOverrideTarget } from '../module-override-targets'

const SOURCE_ROOT = 'node_modules/@open-mercato/core/src/modules/demo'

function facts(): ModuleFactsJsonEntry {
  return {
    title: null, description: null, coreVersion: null, sourcePackage: '@open-mercato/core',
    sourceVersion: null, sourceRoot: SOURCE_ROOT,
    entities: [], events: [], aclFeatures: ['demo.view'],
    apiRoutes: [{ path: '/demo/items', methods: ['GET', 'POST'], auth: {}, sourcePath: `${SOURCE_ROOT}/api/items/route.ts` }],
    diTokens: ['demoService'], searchEntities: [], hostTokens: { entityIds: [], tableIds: [] },
    notifications: [], cli: [], backendPages: [{ path: '/backend/demo/list', sourcePath: `${SOURCE_ROOT}/backend/demo/list/page.tsx` }],
    frontendPages: [{ path: '/demo-portal', sourcePath: `${SOURCE_ROOT}/frontend/demo-portal/page.tsx` }],
    cliCommands: [], aiTools: [], aiAgents: [],
    factSources: [{ kind: 'acl-feature', id: 'demo.view', source: { sourcePath: `${SOURCE_ROOT}/acl.ts` } }],
    ownedContracts: {
      worker: [{ kind: 'worker', id: 'demo.worker', source: { sourcePath: `${SOURCE_ROOT}/workers/demo.ts`, line: 3 }, metadata: { queue: 'demo', concurrency: 1 } }],
      'page-middleware': [{ kind: 'page-middleware', id: 'demo.guard', source: { sourcePath: `${SOURCE_ROOT}/backend/middleware.ts`, line: 2 }, metadata: { surface: 'backend' } }],
      'di-registration': [{ kind: 'di-registration', id: 'demoService', source: { sourcePath: `${SOURCE_ROOT}/di.ts`, line: 5 }, metadata: { registrationKind: 'class' } }],
    },
    extensionSurfaces: {
      hosts: [], unresolved: [],
      contributions: [
        { id: 'demo.widget@profile:demo:slot', kind: 'widget', targets: [], scopeContract: '', source: { path: `${SOURCE_ROOT}/widgets/injection-table.ts`, symbol: 'injectionTable' }, details: { payload: 'render', registryKey: 'demo.widget', executionGuard: 'host' } },
        { id: 'demo.mutation-guard', kind: 'mutation-guard', targets: [], scopeContract: '', source: { path: `${SOURCE_ROOT}/data/guards.ts`, symbol: 'demo.mutation-guard' }, details: { entityId: 'demo.entity', operations: ['create'], capabilities: ['block'], optimisticLock: 'preserved' } },
      ],
    },
  }
}

const TARGETS = collectModuleOverrideTargets(facts()).overrideTargets
function key(domain: string, pathTail: string): string {
  const target = TARGETS.find((t: ModuleOverrideTarget) => t.domain === domain && t.path[t.path.length - 1] === pathTail)
  if (!target || target.key === undefined) throw new Error(`[internal] no keyed ${domain} target for ${pathTail}`)
  return target.key
}

afterEach(() => resetModuleContractOverridesForTests())

describe('runtime resolver round-trip — positive', () => {
  it('selects the intended API route method by the generated public key', () => {
    const getKey = key('routes', 'GET /api/demo/items')
    const routes = [{ moduleId: 'demo', path: '/demo/items', methods: ['GET', 'POST'], load: async () => ({}) }]
    const result = applyApiOverridesToManifests(routes as never, { [getKey]: null })
    expect(result).toHaveLength(1)
    expect(result[0].methods).toEqual(['POST'])
  })

  it('selects the intended backend and frontend page by the generated application-route key', () => {
    const backendKey = key('routes', 'backend:/backend/demo/list')
    const frontendKey = key('routes', 'frontend:/demo-portal')
    const backend = applyPageOverridesToManifests([{ moduleId: 'demo', path: '/backend/demo/list', load: async () => ({}) }] as never, { [backendKey]: null }, 'backend')
    const frontend = applyPageOverridesToManifests([{ moduleId: 'demo', path: '/demo-portal', load: async () => ({}) }] as never, { [frontendKey]: null }, 'frontend')
    expect(backend).toHaveLength(0)
    expect(frontend).toHaveLength(0)
  })

  it('selects the intended worker / injection widget / page middleware by exact key', () => {
    const workers = applyWorkerOverridesToDescriptors(
      [{ id: 'demo.worker', queue: 'demo', concurrency: 1, handler: () => undefined }],
      { [key('workers', 'demo.worker')]: null },
    )
    expect(workers).toHaveLength(0)

    const widgets = applyInjectionWidgetOverridesToEntries(
      [{ moduleId: 'demo', key: 'demo.widget', loader: async () => ({}) }] as never,
      { [key('widgets', 'demo.widget')]: null },
    )
    expect(widgets).toHaveLength(0)

    const guards = applyPageGuardOverridesToEntries(
      [{ moduleId: 'demo', middleware: [{ id: 'demo.guard', run: async () => undefined }] }] as never,
      { [key('guards', 'demo.guard')]: null },
    )
    expect(guards[0].middleware).toHaveLength(0)
  })

  it('unregisters the exact DI token via the generated key', () => {
    const unregistered: string[] = []
    const container = {
      register: () => container,
      unregister: (name: string) => { unregistered.push(name); return container },
      registrations: { demoService: {} as unknown },
    }
    applyDiOverrides({ [key('di', 'demoService')]: null })
    applyDiOverridesToContainer(container)
    expect(unregistered).toEqual(['demoService'])
  })
})

describe('runtime resolver round-trip — negative (malformed variants do not select)', () => {
  it('a lowercased / method-less API key does not select the manifest entry', () => {
    const getKey = key('routes', 'GET /api/demo/items')
    expect(getKey).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \/api\//)
    const routes = [{ moduleId: 'demo', path: '/demo/items', methods: ['GET', 'POST'], load: async () => ({}) }]
    const lowercased = applyApiOverridesToManifests(routes as never, { 'get /api/demo/items': null })
    expect(lowercased[0].methods).toEqual(['GET', 'POST'])
    const methodless = applyApiOverridesToManifests(routes as never, { '/api/demo/items': null })
    expect(methodless[0].methods).toEqual(['GET', 'POST'])
  })

  it('a UI filesystem path does not select a page; the generated application route does', () => {
    const filesystemPath = `${SOURCE_ROOT}/backend/demo/list/page.tsx`
    const wrong = applyPageOverridesToManifests([{ moduleId: 'demo', path: '/backend/demo/list', load: async () => ({}) }] as never, { [filesystemPath]: null }, 'backend')
    expect(wrong).toHaveLength(1)
    const backendKey = key('routes', 'backend:/backend/demo/list')
    expect(backendKey).not.toContain('.tsx')
    expect(backendKey.startsWith('backend:')).toBe(true)
  })

  it('a flattened nested widget key does not select the injection entry', () => {
    const flattened = applyInjectionWidgetOverridesToEntries(
      [{ moduleId: 'demo', key: 'demo.widget', loader: async () => ({}) }] as never,
      { 'widgets.injection.demo.widget': null },
    )
    expect(flattened).toHaveLength(1)
  })

  it('a mutation-guard id under page guards does not drop the page middleware', () => {
    const guards = applyPageGuardOverridesToEntries(
      [{ moduleId: 'demo', middleware: [{ id: 'demo.guard', run: async () => undefined }] }] as never,
      { 'demo.mutation-guard': null },
    )
    expect(guards[0].middleware).toHaveLength(1)
    // the mutation guard is never emitted as a guards target
    expect(TARGETS.some((t) => t.domain === 'guards' && t.key === 'demo.mutation-guard')).toBe(false)
  })

  it('an unknown DI token is never emitted; emitted tokens correspond to real registrations', () => {
    expect(TARGETS.some((t) => t.domain === 'di' && t.key === 'nope')).toBe(false)
    expect(TARGETS.some((t) => t.domain === 'di' && t.key === 'demoService')).toBe(true)
  })

  it('framework-only nav.groupOrder is never attached to a module target', () => {
    expect(TARGETS.some((t) => t.domain === 'nav')).toBe(false)
    expect(TARGETS.some((t) => JSON.stringify(t.path) === JSON.stringify(['nav', 'groupOrder']))).toBe(false)
  })
})
