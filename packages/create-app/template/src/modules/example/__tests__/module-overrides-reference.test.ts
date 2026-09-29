/** @jest-environment node */
/**
 * A markdown snippet of an override shape rots silently. This reference is a compiled
 * `ModuleOverrides` value, and the assertions below run it through the REAL dispatcher
 * (`applyModuleOverridesFromEnabledModules`) with a recording applier registered for
 * every wired domain.
 *
 * That is what makes the coverage claim mechanical rather than editorial: a domain the
 * reference forgets is never dispatched, and a domain whose value is not a plain object
 * is dropped by the dispatcher before any applier sees it.
 *
 * Dispatch alone is not enough, though. Every key in the reference is a plain string
 * that TypeScript cannot check, and an override keyed on an id nothing declares is
 * either a silent no-op (every shared-dispatcher domain skips it with a
 * `warnStaleOverrides` log) or, in the `ai` domain, a silently invented tool/agent. So
 * `resolves every key against an id the module really declares` re-derives the id sets
 * from the module's OWN declarations — by importing the real subscriber, worker,
 * interceptor, enricher, widget, CLI, ACL, DI and encryption files — and fails on any
 * key that names nothing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { InjectionMode, asValue, createContainer } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  applyModuleOverridesFromEnabledModules,
  registerModuleOverrideApplier,
  resetModuleOverrideAppliersForTests,
  type ModuleOverrideDomain,
  type ModuleOverrideEntry,
} from '@open-mercato/shared/modules/overrides'
import reference, { exampleModuleOverridesReference } from '../references/module-overrides.reference'

/**
 * The dispatcher's own domain list is module-private, so it is restated here. The
 * `dispatches every domain` case fails if the framework ever stops routing one of
 * these, which is the drift this file exists to catch.
 */
const WIRED_DOMAINS: ModuleOverrideDomain[] = [
  'ai',
  'routes',
  'events',
  'workers',
  'widgets',
  'notifications',
  'interceptors',
  'commandInterceptors',
  'enrichers',
  'guards',
  'cli',
  'setup',
  'acl',
  'di',
  'encryption',
  'nav',
]

const moduleRoot = path.join(__dirname, '..')

/**
 * Every keyed map in the reference, by dotted path. `routes.*` is checked for stale ids
 * by its own case (a route key is a method + path, not an id), the rest by
 * `keyedDomains()` below — but all of them are counted and null-checked here.
 */
const KEYED_MAP_LABELS = [
  'ai.agents',
  'ai.tools',
  'routes.api',
  'routes.pages',
  'events.subscribers',
  'workers',
  'widgets.injection',
  'widgets.components',
  'widgets.dashboard',
  'notifications.types',
  'notifications.handlers',
  'interceptors',
  'commandInterceptors',
  'enrichers',
  'guards',
  'cli',
  'acl.features',
  'di',
  'encryption.maps',
]

/** Exact number of keys across every keyed map, so a domain cannot be silently voided. */
const TOTAL_KEYED_ENTRIES = 20

function recordDispatch(): Map<ModuleOverrideDomain, Array<ModuleOverrideEntry<unknown>>> {
  const seen = new Map<ModuleOverrideDomain, Array<ModuleOverrideEntry<unknown>>>()
  for (const domain of WIRED_DOMAINS) {
    registerModuleOverrideApplier<unknown>(domain, (entries) => {
      seen.set(domain, [...entries])
    })
  }
  applyModuleOverridesFromEnabledModules([
    { id: 'example', overrides: exampleModuleOverridesReference },
  ])
  return seen
}

/** Every `<dir>/<name>/widget.ts` default export's declared id. */
async function widgetIdsUnder(relativeDir: string): Promise<string[]> {
  const absolute = path.join(moduleRoot, relativeDir)
  const names = fs.readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(absolute, entry.name, 'widget.ts')))
    .map((entry) => entry.name)
  const ids: string[] = []
  for (const name of names) {
    const widget = (await import(`../${relativeDir}/${name}/widget`)).default as { metadata?: { id?: string } }
    if (widget?.metadata?.id) ids.push(widget.metadata.id)
  }
  return ids
}

/**
 * Every `<dir>/<file>.ts` `metadata.id` (subscribers, workers). Auto-discovery keys
 * these registries on the `metadata` export, not on the default handler.
 */
async function declaredIdsInDirectory(relativeDir: string): Promise<string[]> {
  const absolute = path.join(moduleRoot, relativeDir)
  const files = fs.readdirSync(absolute)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => file.replace(/\.ts$/, ''))
  const ids: string[] = []
  for (const file of files) {
    const loaded = await import(`../${relativeDir}/${file}`) as { metadata?: { id?: string } }
    if (loaded.metadata?.id) ids.push(loaded.metadata.id)
  }
  return ids
}

async function declaredDiRegistrations(): Promise<string[]> {
  const { register } = await import('../di')
  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  container.register({ em: asValue({}), cache: asValue({}) })
  const before = new Set(Object.keys(container.registrations))
  register(container as unknown as AppContainer)
  return Object.keys(container.registrations).filter((name) => !before.has(name))
}

async function declaredNavGroupIds(): Promise<string[]> {
  const menus = (await import('../widgets/injection/example-menus/widget')).default
  return menus.menuItems.flatMap((item) => (item.groupId ? [item.groupId] : []))
}

type KeyedDomain = {
  label: string
  keys: string[]
  declaredIds: () => Promise<string[]>
}

/**
 * One row per keyed map in the reference. `declaredIds` re-reads the module's real
 * declarations, so renaming a subscriber/interceptor/CLI command without updating the
 * reference fails here instead of shipping a key that matches nothing.
 */
async function keyedDomains(): Promise<KeyedDomain[]> {
  const value = exampleModuleOverridesReference
  return [
    {
      label: 'ai.agents',
      keys: Object.keys(value.ai?.agents ?? {}),
      declaredIds: async () => (await import('../ai-agents')).default.map((agent) => agent.id),
    },
    {
      label: 'ai.tools',
      keys: Object.keys(value.ai?.tools ?? {}),
      declaredIds: async () => (await import('../ai-tools')).default.map((tool) => tool.name),
    },
    {
      label: 'events.subscribers',
      keys: Object.keys(value.events?.subscribers ?? {}),
      declaredIds: () => declaredIdsInDirectory('subscribers'),
    },
    {
      label: 'workers',
      keys: Object.keys(value.workers ?? {}),
      declaredIds: () => declaredIdsInDirectory('workers'),
    },
    {
      label: 'widgets.injection',
      keys: Object.keys(value.widgets?.injection ?? {}),
      declaredIds: () => widgetIdsUnder('widgets/injection'),
    },
    {
      label: 'widgets.components',
      keys: Object.keys(value.widgets?.components ?? {}),
      declaredIds: async () => (await import('../widgets/components')).componentOverrides
        .map((override) => override.target.componentId),
    },
    {
      label: 'widgets.dashboard',
      keys: Object.keys(value.widgets?.dashboard ?? {}),
      declaredIds: () => widgetIdsUnder('widgets/dashboard'),
    },
    {
      label: 'notifications.types',
      keys: Object.keys(value.notifications?.types ?? {}),
      declaredIds: async () => (await import('../notifications')).default.map((type) => type.type),
    },
    {
      label: 'notifications.handlers',
      keys: Object.keys(value.notifications?.handlers ?? {}),
      declaredIds: async () => (await import('../notifications.handlers')).default.map((handler) => handler.id),
    },
    {
      label: 'interceptors',
      keys: Object.keys(value.interceptors ?? {}),
      declaredIds: async () => (await import('../api/interceptors')).interceptors.map((entry) => entry.id),
    },
    {
      label: 'commandInterceptors',
      keys: Object.keys(value.commandInterceptors ?? {}),
      declaredIds: async () => (await import('../commands/interceptors')).interceptors.map((entry) => entry.id),
    },
    {
      label: 'enrichers',
      keys: Object.keys(value.enrichers ?? {}),
      declaredIds: async () => (await import('../data/enrichers')).enrichers.map((entry) => entry.id),
    },
    {
      label: 'guards',
      keys: Object.keys(value.guards ?? {}),
      declaredIds: async () => [
        ...(await import('../backend/middleware')).default,
        ...(await import('../frontend/middleware')).default,
      ].map((entry) => entry.id),
    },
    {
      label: 'cli',
      keys: Object.keys(value.cli ?? {}),
      declaredIds: async () => (await import('../cli')).default.map((entry) => `example ${entry.command}`),
    },
    {
      label: 'acl.features',
      keys: Object.keys(value.acl?.features ?? {}),
      declaredIds: async () => (await import('../acl')).default.map((feature) => feature.id),
    },
    {
      label: 'di',
      keys: Object.keys(value.di ?? {}),
      declaredIds: declaredDiRegistrations,
    },
    {
      label: 'encryption.maps',
      keys: Object.keys(value.encryption?.maps ?? {}),
      declaredIds: async () => (await import('../encryption')).default.map((map) => map.entityId),
    },
  ]
}

describe('example module overrides reference', () => {
  afterEach(() => {
    resetModuleOverrideAppliersForTests()
  })

  it('is the default export as well, so either import style compiles', () => {
    expect(reference).toBe(exampleModuleOverridesReference)
  })

  it('dispatches every wired override domain through the real dispatcher', () => {
    const seen = recordDispatch()
    const missing = WIRED_DOMAINS.filter((domain) => !seen.has(domain))
    expect(missing).toEqual([])
    expect(seen.size).toBe(WIRED_DOMAINS.length)
  })

  it('attributes every dispatched bucket to the declaring module', () => {
    const seen = recordDispatch()
    expect(seen.size).toBe(WIRED_DOMAINS.length)
    for (const [domain, entries] of seen) {
      expect(entries).toHaveLength(1)
      expect(entries[0].moduleId).toBe('example')
      expect(entries[0].overrides).toBe(
        (exampleModuleOverridesReference as Record<string, unknown>)[domain],
      )
    }
  })

  it('uses null for disable in every keyed map, which is the documented convention', () => {
    const nonNull: string[] = []
    const empty: string[] = []
    let keyCount = 0
    for (const label of KEYED_MAP_LABELS) {
      const entries = Object.entries(domainValues(label))
      if (entries.length === 0) empty.push(label)
      for (const [key, value] of entries) {
        keyCount += 1
        if (value !== null) nonNull.push(`${label} → ${key}`)
      }
    }
    expect(nonNull).toEqual([])
    // A map emptied to `{}` still dispatches, so the domain-coverage case above passes
    // while the reference teaches nothing. Name the offender instead of counting past it.
    expect(empty).toEqual([])
    // Exact, not a floor: a lower bound let four whole domains be emptied for free.
    expect(keyCount).toBe(TOTAL_KEYED_ENTRIES)
  })

  it('resolves every key against an id the module really declares', async () => {
    const stale: string[] = []
    for (const domain of await keyedDomains()) {
      const declared = new Set(await domain.declaredIds())
      // A domain that stops carrying keys is as broken as one carrying wrong keys.
      expect(domain.keys.length).toBeGreaterThan(0)
      expect(declared.size).toBeGreaterThan(0)
      for (const key of domain.keys) {
        if (!declared.has(key)) stale.push(`${domain.label} → ${key}`)
      }
    }
    expect(stale).toEqual([])
  })

  it('names a route method and a page path this module really serves', async () => {
    const apiKeys = Object.keys(exampleModuleOverridesReference.routes?.api ?? {})
    expect(apiKeys.length).toBeGreaterThan(0)
    for (const key of apiKeys) {
      const [method, routePath] = key.split(' ')
      const relative = routePath.replace(/^\/api\/example\//, '')
      const route = await import(`../api/${relative}/route`) as Record<string, unknown>
      expect(typeof route[method]).toBe('function')
    }

    const pageKeys = Object.keys(exampleModuleOverridesReference.routes?.pages ?? {})
    expect(pageKeys.length).toBeGreaterThan(0)
    for (const key of pageKeys) {
      const relative = key.replace(/^\//, '')
      expect(fs.existsSync(path.join(moduleRoot, relative, 'page.tsx'))).toBe(true)
    }
  })

  it('reorders a nav group this module actually declares', async () => {
    const groupOrder = exampleModuleOverridesReference.nav?.groupOrder ?? []
    expect(groupOrder.length).toBeGreaterThan(0)
    const declared = new Set(await declaredNavGroupIds())
    expect(groupOrder.filter((groupId) => !declared.has(groupId))).toEqual([])
  })

  it('keeps `ai.extensions` additive rather than a null map', () => {
    expect(Array.isArray(exampleModuleOverridesReference.ai?.extensions)).toBe(true)
  })

  it('keeps `setup` a flag shape rather than a keyed map', () => {
    expect(exampleModuleOverridesReference.setup).toEqual({ seedExamples: false })
  })
})

/** Resolves a dotted domain label back to the map it names in the reference. */
function domainValues(label: string): Record<string, unknown> {
  const parts = label.split('.')
  let current: unknown = exampleModuleOverridesReference
  for (const part of parts) {
    current = (current as Record<string, unknown> | undefined)?.[part]
  }
  return (current ?? {}) as Record<string, unknown>
}
