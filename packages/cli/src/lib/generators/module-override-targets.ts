import crypto from 'node:crypto'
import type { ModuleOverrideDomain } from '@open-mercato/shared/modules/overrides'
import type { ModuleExtensionContributionFact } from '@open-mercato/shared/modules/widgets/extension-points'
import type {
  ModuleFactRef,
  ModuleFactSourceKind,
  ModuleFactSourceRef,
  ModuleFactsJsonEntry,
  ModuleOwnedContractFact,
} from './module-facts'
import { buildFactSourceLookup, type FactSourceLookup } from './module-fact-sources'
import { getFrameworkOverrideModes } from './module-extension-facts'

/**
 * Exact module-specific unified override targets.
 *
 * Spec: `.ai/specs/2026-08-02-module-facts-exact-override-targets.md`.
 *
 * Projects every concrete key a downstream app can set under
 * `modules.<moduleId>.overrides.<domain>` from the normalized owned facts
 * (spec 1 provenance) and the extension-surface contributions (spec 2). Each
 * target carries the structured runtime `path`, the applicable framework mode,
 * a module-owned `factRef`, and a portable `source`. The framework catalog
 * (`framework-extension-points`) stays the authority for domains/modes; this
 * layer only emits the module's concrete keys. Framework-only settings such as
 * `nav.groupOrder` are never module targets.
 */

export type ModuleOverrideMode = 'disable-replace' | 'replace' | 'additive'

export type ModuleOverrideTargetNote =
  | 'safe-metadata-only'
  | 'page-middleware-not-mutation-guard'

export type ModuleOverrideTarget = {
  id: string
  domain: ModuleOverrideDomain
  key?: string
  path: string[]
  modes: ModuleOverrideMode[]
  factRef: ModuleFactRef
  source: ModuleFactSourceRef
  notes?: ModuleOverrideTargetNote[]
}

export type ModuleOverrideTargetDiagnosticCode =
  | 'missing-owned-fact'
  | 'missing-source'
  | 'unsupported-dynamic-key'
  | 'unknown-framework-domain'

export type ModuleOverrideTargetDiagnostic = {
  code: ModuleOverrideTargetDiagnosticCode
  moduleId: string
  domain: ModuleOverrideDomain
  candidatePath?: string[]
  source?: ModuleFactSourceRef
}

/**
 * Public, spec-shaped adapter view. `collect` mirrors the spec's illustrative
 * signature (targets only); `diagnose` is the additive per-module diagnostic
 * companion. Every adapter is bound to exactly one top-level override domain,
 * or classified `frameworkOnly` (framework-catalog settings that never become
 * module targets, e.g. `nav`).
 */
export type OverrideTargetAdapter = {
  domain: ModuleOverrideDomain
  collect(moduleFacts: ModuleFactsJsonEntry): ModuleOverrideTarget[]
  diagnose(moduleFacts: ModuleFactsJsonEntry): ModuleOverrideTargetDiagnostic[]
  frameworkOnly?: boolean
}

type AdapterResult = {
  targets: ModuleOverrideTarget[]
  diagnostics: ModuleOverrideTargetDiagnostic[]
}

type InternalAdapter = {
  domain: ModuleOverrideDomain
  frameworkOnly?: boolean
  run(moduleFacts: ModuleFactsJsonEntry, resolveFactSource: FactSourceLookup): AdapterResult
}

const OVERRIDE_MODES = getFrameworkOverrideModes()

function modesFor(dottedHost: string): ModuleOverrideMode[] {
  const mode = OVERRIDE_MODES[dottedHost]
  return mode ? [mode] : ['disable-replace']
}

/**
 * The module id equals the last segment of the portable `sourceRoot`
 * (`node_modules/<pkg>/src/modules/<moduleId>`), which the provenance builder
 * derives from the module id itself, so this round-trips losslessly.
 */
function moduleIdOf(facts: ModuleFactsJsonEntry): string {
  const segments = facts.sourceRoot.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? ''
}

/**
 * Deterministic id derived from the JSON-serialized `[moduleId, domain, path]`
 * tuple so segment boundaries cannot collide. `path` remains the lossless
 * authority; this is a compact stable handle for consumers that key by id.
 */
export function computeOverrideTargetId(moduleId: string, domain: ModuleOverrideDomain, path: string[]): string {
  return crypto.createHash('sha1').update(JSON.stringify([moduleId, domain, path])).digest('hex').slice(0, 16)
}

function compareSourceRefs(left: ModuleFactSourceRef, right: ModuleFactSourceRef): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    (left.exportName ?? '').localeCompare(right.exportName ?? '')
  )
}

function comparePaths(left: string[], right: string[]): number {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftSegment = left[index]
    const rightSegment = right[index]
    if (leftSegment === undefined) return -1
    if (rightSegment === undefined) return 1
    const compared = leftSegment.localeCompare(rightSegment)
    if (compared !== 0) return compared
  }
  return 0
}

type MakeTargetInput = {
  moduleId: string
  domain: ModuleOverrideDomain
  path: string[]
  dottedHost: string
  factRef: ModuleFactRef
  source: ModuleFactSourceRef
  key?: string
  notes?: ModuleOverrideTargetNote[]
}

function makeTarget(input: MakeTargetInput): ModuleOverrideTarget {
  const target: ModuleOverrideTarget = {
    id: computeOverrideTargetId(input.moduleId, input.domain, input.path),
    domain: input.domain,
    ...(input.key !== undefined ? { key: input.key } : {}),
    path: input.path,
    modes: modesFor(input.dottedHost),
    factRef: input.factRef,
    source: input.source,
    ...(input.notes && input.notes.length > 0 ? { notes: input.notes } : {}),
  }
  return target
}

/** Portable contribution source ref → override target source ref. */
function contributionSource(contribution: ModuleExtensionContributionFact): ModuleFactSourceRef {
  return {
    sourcePath: contribution.source.path,
    ...(contribution.source.symbol ? { exportName: contribution.source.symbol } : {}),
  }
}

/** Owned-contract source ref, dropping the (constant) exportName for compactness. */
function ownedSource(fact: ModuleOwnedContractFact): ModuleFactSourceRef {
  return {
    sourcePath: fact.source.sourcePath,
    ...(fact.source.line ? { line: fact.source.line } : {}),
  }
}

function contributionsOfKind<K extends ModuleExtensionContributionFact['kind']>(
  facts: ModuleFactsJsonEntry,
  kind: K,
): Array<Extract<ModuleExtensionContributionFact, { kind: K }>> {
  const contributions = facts.extensionSurfaces?.contributions ?? []
  return contributions.filter((contribution): contribution is Extract<ModuleExtensionContributionFact, { kind: K }> =>
    contribution.kind === kind,
  )
}

function indexedFactSourcePath(
  resolveFactSource: FactSourceLookup,
  kind: ModuleFactSourceKind,
  id: string,
): string | null {
  return resolveFactSource(kind, id)?.sourcePath ?? null
}

// ---------------------------------------------------------------------------
// Local canonical override-key normalizers.
//
// These MIRROR the private `normalizeApiRouteOverrideKey` /
// `normalizePageRouteOverrideKey` in
// `packages/shared/src/modules/overrides.ts` (not exported by that module).
// Round-trip tests feed the emitted keys back through the exported runtime
// appliers (`applyApiOverridesToManifests` / `applyPageOverridesToManifests`)
// to prove equivalence. See the implementation report: exporting the shared
// normalizers would let this file import rather than mirror them.
// ---------------------------------------------------------------------------

const VALID_HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Canonical `'METHOD /api/path'` public override key for a route method. Route
 * fact paths are stored without the `/api` prefix (e.g. `/customers/x`), so the
 * public key downstream apps write is `METHOD /api<path>`.
 */
function apiRouteOverrideKey(method: string, routePath: string): string | null {
  const upper = method.trim().toUpperCase()
  if (!VALID_HTTP_METHODS.has(upper)) return null
  const withLead = routePath.startsWith('/') ? routePath : `/${routePath}`
  const publicPath = withLead.startsWith('/api/') || withLead === '/api' ? withLead : `/api${withLead}`
  const normalized = publicPath.replace(/\/+$/, '') || '/'
  return `${upper} ${normalized}`
}

function pageRouteOverrideKey(routePath: string): string | null {
  const trimmed = routePath.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('backend:') || trimmed.startsWith('frontend:')) return trimmed
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const stripped = withLead.replace(/\/+$/, '') || '/'
  if (stripped === '/frontend') return 'frontend:/'
  if (stripped.startsWith('/frontend/')) return `frontend:/${stripped.slice('/frontend/'.length)}`
  if (stripped === '/backend' || stripped.startsWith('/backend/')) return `backend:${stripped}`
  return `frontend:${stripped}`
}

// ---------------------------------------------------------------------------
// Adapters (one per top-level override domain).
// ---------------------------------------------------------------------------

const aiAdapter: InternalAdapter = {
  domain: 'ai',
  run(facts) {
    const moduleId = moduleIdOf(facts)
    const targets: ModuleOverrideTarget[] = []
    const diagnostics: ModuleOverrideTargetDiagnostic[] = []

    for (const agent of facts.aiAgents) {
      if (!agent.sourcePath) {
        diagnostics.push({ code: 'missing-source', moduleId, domain: 'ai', candidatePath: ['ai', 'agents', agent.id] })
        continue
      }
      const path = ['ai', 'agents', agent.id]
      targets.push(makeTarget({
        moduleId, domain: 'ai', path, key: agent.id, dottedHost: 'ai.agents',
        factRef: { factSection: 'aiAgents', factKey: agent.id },
        source: { sourcePath: agent.sourcePath },
      }))
    }
    for (const tool of facts.aiTools) {
      if (!tool.sourcePath) {
        diagnostics.push({ code: 'missing-source', moduleId, domain: 'ai', candidatePath: ['ai', 'tools', tool.name] })
        continue
      }
      const path = ['ai', 'tools', tool.name]
      targets.push(makeTarget({
        moduleId, domain: 'ai', path, key: tool.name, dottedHost: 'ai.tools',
        factRef: { factSection: 'aiTools', factKey: tool.name },
        source: { sourcePath: tool.sourcePath },
      }))
    }
    // `ai.extensions` is an additive array (no runtime lookup key): a single
    // structured target for the module's AI extension bundle.
    const aiExtensions = facts.ownedContracts?.['ai-extension'] ?? []
    if (aiExtensions.length > 0) {
      const anchor = [...aiExtensions].sort((left, right) => left.id.localeCompare(right.id))[0]
      targets.push(makeTarget({
        moduleId, domain: 'ai', path: ['ai', 'extensions'], dottedHost: 'ai.extensions',
        factRef: { factSection: 'ownedContracts.ai-extension', factKey: anchor.id },
        source: ownedSource(anchor),
      }))
    }
    return { targets, diagnostics }
  },
}

const routesAdapter: InternalAdapter = {
  domain: 'routes',
  run(facts) {
    const moduleId = moduleIdOf(facts)
    const targets: ModuleOverrideTarget[] = []
    const diagnostics: ModuleOverrideTargetDiagnostic[] = []

    for (const route of facts.apiRoutes) {
      for (const method of route.methods) {
        const key = apiRouteOverrideKey(method, route.path)
        if (!key) {
          diagnostics.push({ code: 'unsupported-dynamic-key', moduleId, domain: 'routes', candidatePath: ['routes', 'api', `${method} ${route.path}`] })
          continue
        }
        if (!route.sourcePath) {
          diagnostics.push({ code: 'missing-source', moduleId, domain: 'routes', candidatePath: ['routes', 'api', key] })
          continue
        }
        const path = ['routes', 'api', key]
        targets.push(makeTarget({
          moduleId, domain: 'routes', path, key, dottedHost: 'routes.api',
          factRef: { factSection: 'apiRoutes', factKey: route.path },
          source: { sourcePath: route.sourcePath },
        }))
      }
    }

    const emitPage = (page: { path: string; sourcePath: string }, section: 'backendPages' | 'frontendPages'): void => {
      const key = pageRouteOverrideKey(page.path)
      if (!key) {
        diagnostics.push({ code: 'unsupported-dynamic-key', moduleId, domain: 'routes', candidatePath: ['routes', 'pages', page.path] })
        return
      }
      if (!page.sourcePath) {
        diagnostics.push({ code: 'missing-source', moduleId, domain: 'routes', candidatePath: ['routes', 'pages', key] })
        return
      }
      const path = ['routes', 'pages', key]
      targets.push(makeTarget({
        moduleId, domain: 'routes', path, key, dottedHost: 'routes.pages',
        factRef: { factSection: section, factKey: page.path },
        source: { sourcePath: page.sourcePath },
      }))
    }
    for (const page of facts.backendPages) emitPage(page, 'backendPages')
    for (const page of facts.frontendPages) emitPage(page, 'frontendPages')

    return { targets, diagnostics }
  },
}

const eventsAdapter: InternalAdapter = {
  domain: 'events',
  run(facts) {
    const moduleId = moduleIdOf(facts)
    const targets: ModuleOverrideTarget[] = []
    const diagnostics: ModuleOverrideTargetDiagnostic[] = []
    for (const contribution of contributionsOfKind(facts, 'subscriber')) {
      const subscriberId = contribution.details.subscriberId || contribution.id
      const path = ['events', 'subscribers', subscriberId]
      if (!contribution.source.path) {
        diagnostics.push({ code: 'missing-source', moduleId, domain: 'events', candidatePath: path })
        continue
      }
      targets.push(makeTarget({
        moduleId, domain: 'events', path, key: subscriberId, dottedHost: 'events.subscribers',
        factRef: { factSection: 'extensionSurfaces.contributions', factKey: contribution.id },
        source: contributionSource(contribution),
      }))
    }
    return { targets, diagnostics }
  },
}

const workersAdapter: InternalAdapter = {
  domain: 'workers',
  run(facts) {
    const moduleId = moduleIdOf(facts)
    const targets: ModuleOverrideTarget[] = []
    const diagnostics: ModuleOverrideTargetDiagnostic[] = []
    for (const fact of facts.ownedContracts?.worker ?? []) {
      const path = ['workers', fact.id]
      if (!fact.source.sourcePath) {
        diagnostics.push({ code: 'missing-source', moduleId, domain: 'workers', candidatePath: path })
        continue
      }
      targets.push(makeTarget({
        moduleId, domain: 'workers', path, key: fact.id, dottedHost: 'workers',
        factRef: { factSection: 'ownedContracts.worker', factKey: fact.id },
        source: ownedSource(fact),
      }))
    }
    return { targets, diagnostics }
  },
}

const widgetsAdapter: InternalAdapter = {
  domain: 'widgets',
  run(facts) {
    const moduleId = moduleIdOf(facts)
    const targets: ModuleOverrideTarget[] = []
    const diagnostics: ModuleOverrideTargetDiagnostic[] = []

    const emitInjection = (registryKey: string, contribution: ModuleExtensionContributionFact): void => {
      const path = ['widgets', 'injection', registryKey]
      targets.push(makeTarget({
        moduleId, domain: 'widgets', path, key: registryKey, dottedHost: 'widgets.injection',
        factRef: { factSection: 'extensionSurfaces.contributions', factKey: contribution.id },
        source: contributionSource(contribution),
      }))
    }

    for (const contribution of contributionsOfKind(facts, 'widget')) {
      const registryKey = contribution.details.registryKey
      if (!registryKey) {
        diagnostics.push({ code: 'unsupported-dynamic-key', moduleId, domain: 'widgets', candidatePath: ['widgets', 'injection', contribution.id] })
        continue
      }
      if (contribution.details.payload === 'dashboard') {
        const path = ['widgets', 'dashboard', registryKey]
        targets.push(makeTarget({
          moduleId, domain: 'widgets', path, key: registryKey, dottedHost: 'widgets.dashboard',
          factRef: { factSection: 'extensionSurfaces.contributions', factKey: contribution.id },
          source: contributionSource(contribution),
        }))
      } else {
        emitInjection(registryKey, contribution)
      }
    }

    // data-table / crud-form contributions are injection-widget entries whose
    // registry key is the id segment before the `@<spot>` suffix.
    for (const contribution of [
      ...contributionsOfKind(facts, 'data-table'),
      ...contributionsOfKind(facts, 'crud-form'),
    ]) {
      const registryKey = contribution.id.split('@')[0]
      if (!registryKey || registryKey === contribution.id) {
        diagnostics.push({ code: 'unsupported-dynamic-key', moduleId, domain: 'widgets', candidatePath: ['widgets', 'injection', contribution.id] })
        continue
      }
      emitInjection(registryKey, contribution)
    }

    for (const contribution of contributionsOfKind(facts, 'component-override')) {
      const componentId = contribution.details.handle
      const path = ['widgets', 'components', componentId]
      targets.push(makeTarget({
        moduleId, domain: 'widgets', path, key: componentId, dottedHost: 'widgets.components',
        factRef: { factSection: 'extensionSurfaces.contributions', factKey: contribution.id },
        source: contributionSource(contribution),
      }))
    }

    return { targets, diagnostics }
  },
}

const notificationsAdapter: InternalAdapter = {
  domain: 'notifications',
  run(facts, resolveFactSource) {
    const moduleId = moduleIdOf(facts)
    const targets: ModuleOverrideTarget[] = []
    const diagnostics: ModuleOverrideTargetDiagnostic[] = []

    const registrySources = new Map<string, ModuleFactSourceRef>()
    for (const contribution of contributionsOfKind(facts, 'specialized-registry')) {
      if (contribution.details.registry !== 'notification') continue
      registrySources.set(contribution.details.registryId, contributionSource(contribution))
    }
    for (const type of facts.notifications) {
      const path = ['notifications', 'types', type]
      const indexedPath = indexedFactSourcePath(resolveFactSource, 'notification', type)
      const source = registrySources.get(type) ?? (indexedPath ? { sourcePath: indexedPath } : null)
      if (!source) {
        diagnostics.push({ code: 'missing-source', moduleId, domain: 'notifications', candidatePath: path })
        continue
      }
      targets.push(makeTarget({
        moduleId, domain: 'notifications', path, key: type, dottedHost: 'notifications.types',
        factRef: { factSection: 'notifications', factKey: type },
        source,
      }))
    }
    return { targets, diagnostics }
  },
}

function contributionIdAdapter(
  domain: ModuleOverrideDomain,
  kind: ModuleExtensionContributionFact['kind'],
  dottedHost: string,
): InternalAdapter {
  return {
    domain,
    run(facts) {
      const moduleId = moduleIdOf(facts)
      const targets: ModuleOverrideTarget[] = []
      const diagnostics: ModuleOverrideTargetDiagnostic[] = []
      for (const contribution of contributionsOfKind(facts, kind)) {
        const path = [domain, contribution.id]
        if (!contribution.source.path) {
          diagnostics.push({ code: 'missing-source', moduleId, domain, candidatePath: path })
          continue
        }
        targets.push(makeTarget({
          moduleId, domain, path, key: contribution.id, dottedHost,
          factRef: { factSection: 'extensionSurfaces.contributions', factKey: contribution.id },
          source: contributionSource(contribution),
        }))
      }
      return { targets, diagnostics }
    },
  }
}

const interceptorsAdapter = contributionIdAdapter('interceptors', 'api-interceptor', 'interceptors')
const commandInterceptorsAdapter = contributionIdAdapter('commandInterceptors', 'command-interceptor', 'commandInterceptors')
const enrichersAdapter = contributionIdAdapter('enrichers', 'response-enricher', 'enrichers')

/**
 * `guards` targets ONLY backend/frontend page route middleware
 * (`ownedContracts['page-middleware']`). `data/guards.ts` mutation guards
 * (contribution kind `mutation-guard`) are a different runtime contract and
 * MUST NEVER surface here — every target carries the closed
 * `page-middleware-not-mutation-guard` note.
 */
const guardsAdapter: InternalAdapter = {
  domain: 'guards',
  run(facts) {
    const moduleId = moduleIdOf(facts)
    const targets: ModuleOverrideTarget[] = []
    const diagnostics: ModuleOverrideTargetDiagnostic[] = []
    for (const fact of facts.ownedContracts?.['page-middleware'] ?? []) {
      const path = ['guards', fact.id]
      if (!fact.source.sourcePath) {
        diagnostics.push({ code: 'missing-source', moduleId, domain: 'guards', candidatePath: path })
        continue
      }
      targets.push(makeTarget({
        moduleId, domain: 'guards', path, key: fact.id, dottedHost: 'guards',
        factRef: { factSection: 'ownedContracts.page-middleware', factKey: fact.id },
        source: ownedSource(fact),
        notes: ['page-middleware-not-mutation-guard'],
      }))
    }
    return { targets, diagnostics }
  },
}

const cliAdapter: InternalAdapter = {
  domain: 'cli',
  run(facts) {
    const moduleId = moduleIdOf(facts)
    const targets: ModuleOverrideTarget[] = []
    const diagnostics: ModuleOverrideTargetDiagnostic[] = []
    for (const command of facts.cliCommands) {
      const path = ['cli', command.command]
      if (!command.sourcePath) {
        diagnostics.push({ code: 'missing-source', moduleId, domain: 'cli', candidatePath: path })
        continue
      }
      targets.push(makeTarget({
        moduleId, domain: 'cli', path, key: command.command, dottedHost: 'cli',
        factRef: { factSection: 'cli', factKey: command.command },
        source: { sourcePath: command.sourcePath },
      }))
    }
    return { targets, diagnostics }
  },
}

// `SetupOverridesShape` keys the runtime override resolver accepts. Only these
// supported hook/profile properties become `setup` targets.
const SUPPORTED_SETUP_HOOKS = new Set(['seedDefaults', 'seedExamples', 'onTenantCreated'])

const setupAdapter: InternalAdapter = {
  domain: 'setup',
  run(facts) {
    const moduleId = moduleIdOf(facts)
    const targets: ModuleOverrideTarget[] = []
    const diagnostics: ModuleOverrideTargetDiagnostic[] = []
    const setupFacts = facts.ownedContracts?.setup ?? []
    for (const fact of setupFacts) {
      if (!fact.source.sourcePath) {
        diagnostics.push({ code: 'missing-source', moduleId, domain: 'setup', candidatePath: ['setup'] })
        continue
      }
      const source = ownedSource(fact)
      const properties: string[] = []
      const hooks = fact.metadata?.hooks
      if (Array.isArray(hooks)) {
        for (const hook of hooks) {
          if (typeof hook === 'string' && SUPPORTED_SETUP_HOOKS.has(hook)) properties.push(hook)
        }
      }
      const roles = fact.metadata?.roles
      if (Array.isArray(roles) && roles.length > 0) properties.push('defaultRoleFeatures')
      for (const property of properties) {
        const path = ['setup', property]
        targets.push(makeTarget({
          moduleId, domain: 'setup', path, dottedHost: 'setup',
          factRef: { factSection: 'ownedContracts.setup', factKey: fact.id },
          source,
        }))
      }
    }
    return { targets, diagnostics }
  },
}

const aclAdapter: InternalAdapter = {
  domain: 'acl',
  run(facts, resolveFactSource) {
    const moduleId = moduleIdOf(facts)
    const targets: ModuleOverrideTarget[] = []
    const diagnostics: ModuleOverrideTargetDiagnostic[] = []
    for (const feature of facts.aclFeatures) {
      const path = ['acl', 'features', feature]
      const sourcePath = indexedFactSourcePath(resolveFactSource, 'acl-feature', feature)
      if (!sourcePath) {
        diagnostics.push({ code: 'missing-source', moduleId, domain: 'acl', candidatePath: path })
        continue
      }
      targets.push(makeTarget({
        moduleId, domain: 'acl', path, key: feature, dottedHost: 'acl.features',
        factRef: { factSection: 'aclFeatures', factKey: feature },
        source: { sourcePath },
      }))
    }
    return { targets, diagnostics }
  },
}

/**
 * `di` targets expose the exact registration token and correlate to the rich DI
 * owned fact (which carries the registration kind). They NEVER include the
 * `asValue` payload, constructed service, or factory/class body — the target
 * schema has no such field and carries the `safe-metadata-only` note.
 */
const diAdapter: InternalAdapter = {
  domain: 'di',
  run(facts) {
    const moduleId = moduleIdOf(facts)
    const targets: ModuleOverrideTarget[] = []
    const diagnostics: ModuleOverrideTargetDiagnostic[] = []
    for (const fact of facts.ownedContracts?.['di-registration'] ?? []) {
      const path = ['di', fact.id]
      if (!fact.source.sourcePath) {
        diagnostics.push({ code: 'missing-source', moduleId, domain: 'di', candidatePath: path })
        continue
      }
      targets.push(makeTarget({
        moduleId, domain: 'di', path, key: fact.id, dottedHost: 'di',
        factRef: { factSection: 'ownedContracts.di-registration', factKey: fact.id },
        source: ownedSource(fact),
        notes: ['safe-metadata-only'],
      }))
    }
    return { targets, diagnostics }
  },
}

const encryptionAdapter: InternalAdapter = {
  domain: 'encryption',
  run(facts) {
    const moduleId = moduleIdOf(facts)
    const targets: ModuleOverrideTarget[] = []
    const diagnostics: ModuleOverrideTargetDiagnostic[] = []
    for (const fact of facts.ownedContracts?.encryption ?? []) {
      const path = ['encryption', 'maps', fact.id]
      if (!fact.source.sourcePath) {
        diagnostics.push({ code: 'missing-source', moduleId, domain: 'encryption', candidatePath: path })
        continue
      }
      targets.push(makeTarget({
        moduleId, domain: 'encryption', path, key: fact.id, dottedHost: 'encryption.maps',
        factRef: { factSection: 'ownedContracts.encryption', factKey: fact.id },
        source: ownedSource(fact),
      }))
    }
    return { targets, diagnostics }
  },
}

/** `nav.groupOrder` is a framework-only setting; never a module target. */
const navAdapter: InternalAdapter = {
  domain: 'nav',
  frameworkOnly: true,
  run() {
    return { targets: [], diagnostics: [] }
  },
}

const INTERNAL_ADAPTERS: InternalAdapter[] = [
  aiAdapter,
  routesAdapter,
  eventsAdapter,
  workersAdapter,
  widgetsAdapter,
  notificationsAdapter,
  interceptorsAdapter,
  commandInterceptorsAdapter,
  enrichersAdapter,
  guardsAdapter,
  cliAdapter,
  setupAdapter,
  aclAdapter,
  diAdapter,
  encryptionAdapter,
  navAdapter,
]

/**
 * Runtime enumeration of every unified override domain. Typed as a
 * `Record<ModuleOverrideDomain, true>` so adding a member to the runtime
 * `ModuleOverrideDomain` union fails the build here until it is listed — and
 * the coverage test then fails until an adapter (or `frameworkOnly`
 * classification) is registered.
 */
const OVERRIDE_DOMAIN_PRESENCE: Record<ModuleOverrideDomain, true> = {
  ai: true,
  routes: true,
  events: true,
  workers: true,
  widgets: true,
  notifications: true,
  interceptors: true,
  commandInterceptors: true,
  enrichers: true,
  guards: true,
  cli: true,
  setup: true,
  acl: true,
  di: true,
  encryption: true,
  nav: true,
}

export const ALL_OVERRIDE_DOMAINS = Object.keys(OVERRIDE_DOMAIN_PRESENCE) as ModuleOverrideDomain[]

export const MODULE_OVERRIDE_TARGET_ADAPTERS: OverrideTargetAdapter[] = INTERNAL_ADAPTERS.map((adapter) => ({
  domain: adapter.domain,
  ...(adapter.frameworkOnly ? { frameworkOnly: true } : {}),
  collect: (moduleFacts) => adapter.run(moduleFacts, buildFactSourceLookup(moduleFacts)).targets,
  diagnose: (moduleFacts) => adapter.run(moduleFacts, buildFactSourceLookup(moduleFacts)).diagnostics,
}))

export type ModuleOverrideTargetsResult = {
  overrideTargets: ModuleOverrideTarget[]
  overrideTargetDiagnostics: ModuleOverrideTargetDiagnostic[]
}

/**
 * Project every exact override target (and per-module diagnostic) for one
 * module's facts. Output sorts by domain, then path segments, then source;
 * diagnostics sort by moduleId, domain, code, then path/source. Targets are
 * deduped by `(domain, path)` keeping the source-first entry.
 */
export function collectModuleOverrideTargets(
  facts: ModuleFactsJsonEntry,
  resolveFactSource: FactSourceLookup = buildFactSourceLookup(facts),
): ModuleOverrideTargetsResult {
  const collected: ModuleOverrideTarget[] = []
  const diagnostics: ModuleOverrideTargetDiagnostic[] = []
  for (const adapter of INTERNAL_ADAPTERS) {
    if (adapter.frameworkOnly) continue
    const result = adapter.run(facts, resolveFactSource)
    collected.push(...result.targets)
    diagnostics.push(...result.diagnostics)
  }

  const byPath = new Map<string, ModuleOverrideTarget>()
  for (const target of collected) {
    const pathKey = `${target.domain} ${JSON.stringify(target.path)}`
    const existing = byPath.get(pathKey)
    if (!existing || compareSourceRefs(target.source, existing.source) < 0) byPath.set(pathKey, target)
  }

  const overrideTargets = [...byPath.values()].sort(
    (left, right) =>
      left.domain.localeCompare(right.domain) ||
      comparePaths(left.path, right.path) ||
      compareSourceRefs(left.source, right.source),
  )

  const overrideTargetDiagnostics = diagnostics.sort(
    (left, right) =>
      left.moduleId.localeCompare(right.moduleId) ||
      left.domain.localeCompare(right.domain) ||
      left.code.localeCompare(right.code) ||
      comparePaths(left.candidatePath ?? [], right.candidatePath ?? []) ||
      compareSourceRefs(left.source ?? { sourcePath: '' }, right.source ?? { sourcePath: '' }),
  )

  return { overrideTargets, overrideTargetDiagnostics }
}
