import type { ModuleFactsJsonEntry } from '../module-facts'
import {
  ALL_OVERRIDE_DOMAINS,
  MODULE_OVERRIDE_TARGET_ADAPTERS,
  collectModuleOverrideTargets,
  computeOverrideTargetId,
} from '../module-override-targets'

const SOURCE_ROOT = 'node_modules/@open-mercato/core/src/modules/demo'
const MODULE_ID = 'demo'

function baseFacts(overrides: Partial<ModuleFactsJsonEntry> = {}): ModuleFactsJsonEntry {
  return {
    title: 'Demo',
    description: null,
    coreVersion: null,
    sourcePackage: '@open-mercato/core',
    sourceVersion: null,
    sourceRoot: SOURCE_ROOT,
    entities: [],
    events: [],
    aclFeatures: ['demo.view'],
    apiRoutes: [
      { path: '/demo/items', methods: ['GET', 'POST'], auth: {}, sourcePath: `${SOURCE_ROOT}/api/items/route.ts` },
    ],
    diTokens: ['demoService'],
    searchEntities: [],
    hostTokens: { entityIds: [], tableIds: [] },
    notifications: ['demo.alert'],
    cli: ['demo:seed'],
    backendPages: [{ path: '/backend/demo/list', sourcePath: `${SOURCE_ROOT}/backend/demo/list/page.tsx` }],
    frontendPages: [{ path: '/demo-portal', sourcePath: `${SOURCE_ROOT}/frontend/demo-portal/page.tsx` }],
    cliCommands: [{ command: 'demo:seed', sourcePath: `${SOURCE_ROOT}/cli.ts` }],
    aiTools: [{ name: 'demo.tool', sourcePath: `${SOURCE_ROOT}/ai-tools.ts` }],
    aiAgents: [{ id: 'demo.agent', sourcePath: `${SOURCE_ROOT}/ai-agents.ts` }],
    factSources: [
      { kind: 'acl-feature', id: 'demo.view', source: { sourcePath: `${SOURCE_ROOT}/acl.ts` } },
      { kind: 'notification', id: 'demo.alert', source: { sourcePath: `${SOURCE_ROOT}/notifications.ts` } },
    ],
    ownedContracts: {
      worker: [{ kind: 'worker', id: 'demo.worker', source: { sourcePath: `${SOURCE_ROOT}/workers/demo.ts`, line: 3 } }],
      'page-middleware': [{ kind: 'page-middleware', id: 'demo.guard', source: { sourcePath: `${SOURCE_ROOT}/backend/middleware.ts`, line: 2 }, metadata: { surface: 'backend' } }],
      setup: [{ kind: 'setup', id: 'demo:setup', source: { sourcePath: `${SOURCE_ROOT}/setup.ts`, line: 1 }, metadata: { hooks: ['seedDefaults', 'seedExamples', 'onTenantCreated', 'installStuff'], roles: ['admin'] } }],
      'di-registration': [{ kind: 'di-registration', id: 'demoService', source: { sourcePath: `${SOURCE_ROOT}/di.ts`, line: 5 }, metadata: { registrationKind: 'class', lifetime: 'scoped' } }],
      encryption: [{ kind: 'encryption', id: 'demo:secret', source: { sourcePath: `${SOURCE_ROOT}/encryption.ts`, line: 2 }, metadata: { fields: ['token'] } }],
      'ai-extension': [
        { kind: 'ai-extension', id: 'agent-extension:other.agent', source: { sourcePath: `${SOURCE_ROOT}/ai-agents.extensions.ts`, line: 1 }, metadata: { target: 'agent', mode: 'extension', targetAgentId: 'other.agent' } },
        { kind: 'ai-extension', id: 'agent-override:other.assistant', source: { sourcePath: `${SOURCE_ROOT}/ai-agents.ts`, line: 7 }, metadata: { target: 'agent', mode: 'override', overrideKey: 'other.assistant' } },
        { kind: 'ai-extension', id: 'tool-override:other.tool', source: { sourcePath: `${SOURCE_ROOT}/ai-tools.ts`, line: 9 }, metadata: { target: 'tool', mode: 'override', overrideKey: 'other.tool' } },
      ],
    },
    extensionSurfaces: {
      hosts: [],
      unresolved: [],
      contributions: [
        { id: 'demo:sub', kind: 'subscriber', targets: [], scopeContract: '', source: { path: `${SOURCE_ROOT}/subscribers/demo.ts`, symbol: 'metadata' }, details: { event: 'demo.e', subscriberId: 'demo:sub', persistent: true, sync: false } },
        { id: 'demo.interceptor', kind: 'api-interceptor', targets: [], scopeContract: '', source: { path: `${SOURCE_ROOT}/api/interceptors.ts`, symbol: 'demo.interceptor' }, details: { route: 'items', methods: ['POST'], phases: ['before'], activation: 'crud-pipeline', timeoutMs: 2000, failurePosture: 'fallback' } },
        { id: 'demo.cmd', kind: 'command-interceptor', targets: [], scopeContract: '', source: { path: `${SOURCE_ROOT}/commands/interceptors.ts`, symbol: 'demo.cmd' }, details: { targetCommand: 'demo.thing.update', phases: ['before-execute'] } },
        { id: 'demo.enricher', kind: 'response-enricher', targets: [], scopeContract: '', source: { path: `${SOURCE_ROOT}/data/enrichers.ts`, symbol: 'demo.enricher' }, details: { targetEntity: 'demo.entity', surfaces: ['list'], timeoutMs: 2000, fallback: 'none', critical: false, cachePosture: 'record-pure' } },
        { id: 'demo.widget@profile:demo:slot', kind: 'widget', targets: [], scopeContract: '', source: { path: `${SOURCE_ROOT}/widgets/injection-table.ts`, symbol: 'injectionTable' }, details: { payload: 'render', registryKey: 'demo.widget', executionGuard: 'host' } },
        { id: 'dashboard:demo.card', kind: 'widget', targets: [], scopeContract: '', source: { path: `${SOURCE_ROOT}/widgets/dashboard/card/widget.ts`, symbol: 'widget.metadata' }, details: { payload: 'dashboard', registryKey: 'demo.card', executionGuard: 'both' } },
        { id: 'demo.table-widget@data-table:demo.list:columns', kind: 'data-table', targets: [], scopeContract: '', source: { path: `${SOURCE_ROOT}/widgets/injection-table.ts`, symbol: 'injectionTable' }, details: { payload: 'column', tableId: 'demo.list', executionGuard: 'host' } },
        { id: 'demo.override.0:section:demo.login', kind: 'component-override', targets: [], scopeContract: '', source: { path: `${SOURCE_ROOT}/widgets/components.ts`, symbol: 'componentOverrides' }, details: { handle: 'section:demo.login', mode: 'replace', propsContract: 'x' } },
        { id: 'demo.mutation-guard', kind: 'mutation-guard', targets: [], scopeContract: '', source: { path: `${SOURCE_ROOT}/data/guards.ts`, symbol: 'demo.mutation-guard' }, details: { entityId: 'demo.entity', operations: ['create'], capabilities: ['block'], optimisticLock: 'preserved' } },
        { id: 'notification:demo.alert', kind: 'specialized-registry', targets: [], scopeContract: '', source: { path: `${SOURCE_ROOT}/notifications.ts`, symbol: 'demo.alert' }, details: { registry: 'notification', registryId: 'demo.alert', specialistRoute: 'notifications' } },
        { id: 'demo.alert-handler', kind: 'browser-reaction', targets: [], scopeContract: '', source: { path: `${SOURCE_ROOT}/notifications.handlers.ts`, symbol: 'notificationHandlers' }, details: { transports: ['notification-effect'], hooks: ['useNotificationEffect'], audienceScopeContract: 'tenant', overrideKey: 'demo.alert-handler' } },
        { id: 'demo.notification-handler.1', kind: 'browser-reaction', targets: [], scopeContract: '', source: { path: `${SOURCE_ROOT}/notifications.handlers.ts`, symbol: 'notificationHandlers' }, details: { transports: ['notification-effect'], hooks: ['useNotificationEffect'], audienceScopeContract: 'tenant' } },
      ],
    },
    ...overrides,
  }
}

function targetFor(facts: ModuleFactsJsonEntry, domain: string, key?: string) {
  const { overrideTargets } = collectModuleOverrideTargets(facts)
  return overrideTargets.find((target) => target.domain === domain && (key === undefined || target.key === key))
}

describe('module override targets — adapter registry coverage', () => {
  it('covers every runtime override domain with an adapter or explicit framework-only classification', () => {
    const adaptersByDomain = new Map(MODULE_OVERRIDE_TARGET_ADAPTERS.map((adapter) => [adapter.domain, adapter]))
    for (const domain of ALL_OVERRIDE_DOMAINS) {
      const adapter = adaptersByDomain.get(domain)
      expect(adapter).toBeDefined()
    }
    for (const adapter of MODULE_OVERRIDE_TARGET_ADAPTERS) {
      expect(ALL_OVERRIDE_DOMAINS).toContain(adapter.domain)
    }
    // exactly the 16 runtime domains, one adapter each
    expect(ALL_OVERRIDE_DOMAINS).toHaveLength(16)
    expect(MODULE_OVERRIDE_TARGET_ADAPTERS).toHaveLength(16)
  })

  it('classifies nav as framework-only (never a module target)', () => {
    const navAdapter = MODULE_OVERRIDE_TARGET_ADAPTERS.find((adapter) => adapter.domain === 'nav')
    expect(navAdapter?.frameworkOnly).toBe(true)
    expect(navAdapter?.collect(baseFacts())).toEqual([])
    const { overrideTargets } = collectModuleOverrideTargets(baseFacts())
    expect(overrideTargets.some((target) => target.domain === 'nav')).toBe(false)
    expect(overrideTargets.some((target) => JSON.stringify(target.path) === JSON.stringify(['nav', 'groupOrder']))).toBe(false)
  })
})

describe('module override targets — golden target per domain family', () => {
  const { overrideTargets } = collectModuleOverrideTargets(baseFacts())
  const byPath = (path: string[]) => overrideTargets.find((target) => JSON.stringify(target.path) === JSON.stringify(path))

  it.each([
    ['ai', ['ai', 'agents', 'demo.agent'], 'demo.agent', ['disable-replace']],
    ['ai', ['ai', 'tools', 'demo.tool'], 'demo.tool', ['disable-replace']],
    ['ai', ['ai', 'extensions'], undefined, ['additive']],
    ['routes', ['routes', 'api', 'GET /api/demo/items'], 'GET /api/demo/items', ['disable-replace']],
    ['routes', ['routes', 'api', 'POST /api/demo/items'], 'POST /api/demo/items', ['disable-replace']],
    ['routes', ['routes', 'pages', 'backend:/backend/demo/list'], 'backend:/backend/demo/list', ['disable-replace']],
    ['routes', ['routes', 'pages', 'frontend:/demo-portal'], 'frontend:/demo-portal', ['disable-replace']],
    ['events', ['events', 'subscribers', 'demo:sub'], 'demo:sub', ['disable-replace']],
    ['workers', ['workers', 'demo.worker'], 'demo.worker', ['disable-replace']],
    ['widgets', ['widgets', 'injection', 'demo.widget'], 'demo.widget', ['disable-replace']],
    ['widgets', ['widgets', 'injection', 'demo.table-widget'], 'demo.table-widget', ['disable-replace']],
    ['widgets', ['widgets', 'dashboard', 'demo.card'], 'demo.card', ['disable-replace']],
    ['widgets', ['widgets', 'components', 'section:demo.login'], 'section:demo.login', ['disable-replace']],
    ['notifications', ['notifications', 'types', 'demo.alert'], 'demo.alert', ['disable-replace']],
    ['interceptors', ['interceptors', 'demo.interceptor'], 'demo.interceptor', ['disable-replace']],
    ['commandInterceptors', ['commandInterceptors', 'demo.cmd'], 'demo.cmd', ['disable-replace']],
    ['enrichers', ['enrichers', 'demo.enricher'], 'demo.enricher', ['disable-replace']],
    ['guards', ['guards', 'demo.guard'], 'demo.guard', ['disable-replace']],
    ['cli', ['cli', 'demo:seed'], 'demo:seed', ['disable-replace']],
    ['setup', ['setup', 'seedDefaults'], undefined, ['replace']],
    ['acl', ['acl', 'features', 'demo.view'], 'demo.view', ['disable-replace']],
    ['di', ['di', 'demoService'], 'demoService', ['disable-replace']],
    ['encryption', ['encryption', 'maps', 'demo:secret'], 'demo:secret', ['disable-replace']],
  ])('emits %s target at %j', (domain, path, key, modes) => {
    const target = byPath(path as string[])
    expect(target).toBeDefined()
    expect(target?.domain).toBe(domain)
    expect(target?.key).toBe(key)
    expect(target?.modes).toEqual(modes)
    expect(target?.factRef.factSection.length).toBeGreaterThan(0)
    expect(target?.source.sourcePath.length).toBeGreaterThan(0)
    expect(target?.id).toBe(computeOverrideTargetId(MODULE_ID, domain as never, path as string[]))
  })

  it('emits the supported setup hook/profile paths only (not unsupported hooks)', () => {
    const setupPaths = overrideTargets.filter((t) => t.domain === 'setup').map((t) => t.path[1]).sort()
    expect(setupPaths).toEqual(['defaultRoleFeatures', 'onTenantCreated', 'seedDefaults', 'seedExamples'])
    expect(setupPaths).not.toContain('installStuff')
  })
})

describe('module override targets — invariants', () => {
  const facts = baseFacts()
  const { overrideTargets } = collectModuleOverrideTargets(facts)

  it('holds the terminal-key invariant for every adapter/target', () => {
    for (const target of overrideTargets) {
      if (target.key !== undefined) {
        expect(target.path[target.path.length - 1]).toBe(target.key)
      } else {
        // keyless targets are structured singleton properties, never a lookup key
        expect(['ai/extensions', 'setup']).toContain(
          target.path[0] === 'setup' ? 'setup' : target.path.join('/'),
        )
      }
    }
  })

  it('preserves nested widget and AI paths without flattening keys', () => {
    const widget = targetFor(facts, 'widgets', 'demo.widget')
    expect(widget?.path).toEqual(['widgets', 'injection', 'demo.widget'])
    const agent = targetFor(facts, 'ai', 'demo.agent')
    expect(agent?.path).toEqual(['ai', 'agents', 'demo.agent'])
    // never collapse to a single flattened dotted segment
    for (const target of overrideTargets) {
      expect(target.path.some((segment) => segment === `${target.domain}.injection` || segment === `${target.domain}.agents`)).toBe(false)
    }
  })

  it('points CLI override targets at the source-bearing command fact', () => {
    const cli = targetFor(facts, 'cli', 'demo:seed')
    expect(cli?.factRef).toEqual({ factSection: 'cliCommands', factKey: 'demo:seed' })
  })

  it('exposes DI tokens with the safe-metadata-only note and no runtime value/body', () => {
    const di = targetFor(facts, 'di', 'demoService')
    expect(di?.notes).toEqual(['safe-metadata-only'])
    expect(di?.factRef).toEqual({ factSection: 'ownedContracts.di-registration', factKey: 'demoService' })
    const serialized = JSON.stringify(di)
    for (const forbidden of ['register', 'asClass', 'asFunction', 'asValue', 'handler', 'resolve', 'lifetime', 'value']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('keeps page middleware under guards and never emits a mutation guard there', () => {
    const guard = targetFor(facts, 'guards', 'demo.guard')
    expect(guard?.notes).toEqual(['page-middleware-not-mutation-guard'])
    expect(guard?.factRef.factSection).toBe('ownedContracts.page-middleware')
    const guardsTargets = overrideTargets.filter((t) => t.domain === 'guards')
    expect(guardsTargets.every((t) => t.key !== 'demo.mutation-guard')).toBe(true)
    expect(guardsTargets.every((t) => !t.source.sourcePath.includes('data/guards.ts'))).toBe(true)
  })

  it('sorts deterministically and regenerates byte-identically', () => {
    const first = collectModuleOverrideTargets(baseFacts())
    const second = collectModuleOverrideTargets(baseFacts())
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    const domains = first.overrideTargets.map((t) => t.domain)
    expect(domains).toEqual([...domains].sort((a, b) => a.localeCompare(b)))
  })
})

describe('module override targets — deterministic diagnostics (never a guessed key)', () => {
  it('emits missing-source and no target when the route source cannot be proven', () => {
    const facts = baseFacts({
      apiRoutes: [{ path: '/demo/items', methods: ['GET'], auth: {}, sourcePath: null }],
    })
    const { overrideTargets, overrideTargetDiagnostics } = collectModuleOverrideTargets(facts)
    expect(overrideTargets.some((t) => t.domain === 'routes' && t.path[1] === 'api')).toBe(false)
    const diag = overrideTargetDiagnostics.find((d) => d.domain === 'routes' && d.code === 'missing-source')
    expect(diag).toBeDefined()
    expect(diag?.moduleId).toBe(MODULE_ID)
    expect(diag?.candidatePath).toEqual(['routes', 'api', 'GET /api/demo/items'])
    expect(diag?.source).toBeUndefined()
  })

  it('emits missing-source when an acl feature has no indexed provenance', () => {
    const facts = baseFacts({ factSources: [] })
    const { overrideTargets, overrideTargetDiagnostics } = collectModuleOverrideTargets(facts)
    expect(overrideTargets.some((t) => t.domain === 'acl')).toBe(false)
    expect(overrideTargetDiagnostics.some((d) => d.domain === 'acl' && d.code === 'missing-source')).toBe(true)
  })
})

describe('module override targets — keyed AI, notification handlers, setup profiles', () => {
  it('emits exact ai.agents/ai.tools targets for keyed overrides and keeps extensions additive', () => {
    const { overrideTargets } = collectModuleOverrideTargets(baseFacts())
    const aiPaths = overrideTargets
      .filter((target) => target.domain === 'ai')
      .map((target) => target.path.join('.'))
      .sort()
    expect(aiPaths).toEqual([
      'ai.agents.demo.agent',
      'ai.agents.other.assistant',
      'ai.extensions',
      'ai.tools.demo.tool',
      'ai.tools.other.tool',
    ])

    const agentOverride = overrideTargets.find(
      (target) => target.domain === 'ai' && target.key === 'other.assistant',
    )
    expect(agentOverride?.factRef).toEqual({
      factSection: 'ownedContracts.ai-extension',
      factKey: 'agent-override:other.assistant',
    })
    expect(agentOverride?.source.sourcePath).toBe(`${SOURCE_ROOT}/ai-agents.ts`)

    const extensions = overrideTargets.find(
      (target) => target.domain === 'ai' && target.path.join('.') === 'ai.extensions',
    )
    expect(extensions?.key).toBeUndefined()
    expect(extensions?.factRef.factKey).toBe('agent-extension:other.agent')
    expect(JSON.stringify(overrideTargets)).not.toContain('replacement')
  })

  it('emits notifications.handlers targets keyed by the declared handler id', () => {
    const { overrideTargets, overrideTargetDiagnostics } = collectModuleOverrideTargets(baseFacts())
    const handler = overrideTargets.find(
      (target) => target.domain === 'notifications' && target.path[1] === 'handlers',
    )
    expect(handler?.path).toEqual(['notifications', 'handlers', 'demo.alert-handler'])
    expect(handler?.key).toBe('demo.alert-handler')
    expect(handler?.factRef).toEqual({
      factSection: 'extensionSurfaces.contributions',
      factKey: 'demo.alert-handler',
    })

    // A handler that declares no id cannot be addressed by runtime.
    expect(overrideTargets.some((target) => target.path[2] === 'demo.notification-handler.1')).toBe(false)
    expect(overrideTargetDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'unsupported-dynamic-key',
        domain: 'notifications',
        candidatePath: ['notifications', 'handlers'],
      }),
    ]))
  })

  it('emits setup.defaultCustomerRoleFeatures when customer-role profiles are declared', () => {
    const withoutProfiles = collectModuleOverrideTargets(baseFacts()).overrideTargets
    expect(withoutProfiles.some((target) => target.path.join('.') === 'setup.defaultCustomerRoleFeatures')).toBe(false)

    const facts = baseFacts()
    const setupFact = (facts.ownedContracts?.setup ?? [])[0]
    const withProfiles = collectModuleOverrideTargets(baseFacts({
      ownedContracts: {
        ...facts.ownedContracts,
        setup: [{ ...setupFact, metadata: { ...setupFact.metadata, customerRoles: ['portal-admin'] } }],
      },
    })).overrideTargets
    const target = withProfiles.find((entry) => entry.path.join('.') === 'setup.defaultCustomerRoleFeatures')
    expect(target).toBeDefined()
    expect(target?.factRef).toEqual({ factSection: 'ownedContracts.setup', factKey: 'demo:setup' })
  })
})
