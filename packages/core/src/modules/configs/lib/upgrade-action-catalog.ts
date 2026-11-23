import * as semver from 'semver'
import type { Module } from '@open-mercato/shared/modules/registry'
import type { UpgradeActionDefinition, UpgradeActionScope } from '@open-mercato/shared/modules/upgrade-actions'
import { onModulesRegistered, tryGetModules } from '@open-mercato/shared/lib/modules/registry'
import { getEnabledModuleIds } from '@open-mercato/shared/security/enabledModulesRegistry'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('configs').child({ component: 'upgrade-actions' })

const ACTION_SCOPES: ReadonlySet<string> = new Set<UpgradeActionScope>(['organization', 'tenant'])

export type UpgradeActionIssue = { moduleId: string; actionId: string | null; reason: string }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isValidVersion(value: unknown): value is string {
  return typeof value === 'string' && semver.valid(semver.coerce(value)) !== null
}

export function upgradeActionKey(action: Pick<UpgradeActionDefinition, 'id' | 'version'>): string {
  return `${action.version}::${action.id}`
}

export function validateModuleUpgradeAction(moduleId: string, candidate: unknown): string | null {
  if (!candidate || typeof candidate !== 'object') return 'descriptor is not an object'
  const action = candidate as Partial<UpgradeActionDefinition>
  if (!isNonEmptyString(action.id)) return 'missing id'
  if (!action.id.startsWith(`${moduleId}.`) || action.id.length <= moduleId.length + 1) {
    return `id must be prefixed with "${moduleId}."`
  }
  if (!isValidVersion(action.version)) return 'invalid version'
  if (!isNonEmptyString(action.messageKey) || !isNonEmptyString(action.ctaKey) || !isNonEmptyString(action.successKey)) {
    return 'missing translation keys'
  }
  if (action.loadingKey !== undefined && !isNonEmptyString(action.loadingKey)) return 'invalid loadingKey'
  if (action.requiredModules !== undefined) {
    if (!Array.isArray(action.requiredModules) || !action.requiredModules.every(isNonEmptyString)) {
      return 'invalid requiredModules'
    }
  }
  if (action.scope !== undefined && !ACTION_SCOPES.has(action.scope)) return 'invalid scope'
  if (typeof action.run !== 'function') return 'missing run handler'
  if (action.down !== undefined && typeof action.down !== 'function') return 'invalid down handler'
  if (action.down !== undefined && action.scope === 'tenant') return 'tenant-wide actions cannot declare down'
  return null
}

export function collectModuleUpgradeActions(modules: readonly Module[]): {
  actions: Array<{ moduleId: string; action: UpgradeActionDefinition }>
  issues: UpgradeActionIssue[]
} {
  const candidates: Array<{ moduleId: string; action: UpgradeActionDefinition }> = []
  const issues: UpgradeActionIssue[] = []
  for (const moduleEntry of modules) {
    const declared: unknown = moduleEntry.upgradeActions
    if (declared === undefined) continue
    if (!Array.isArray(declared)) {
      issues.push({ moduleId: moduleEntry.id, actionId: null, reason: 'upgradeActions is not an array' })
      continue
    }
    for (const candidate of declared) {
      const reason = validateModuleUpgradeAction(moduleEntry.id, candidate)
      if (reason) {
        const actionId = candidate && typeof candidate === 'object' && isNonEmptyString((candidate as { id?: unknown }).id)
          ? (candidate as { id: string }).id
          : null
        issues.push({ moduleId: moduleEntry.id, actionId, reason })
        continue
      }
      candidates.push({ moduleId: moduleEntry.id, action: candidate as UpgradeActionDefinition })
    }
  }
  const occurrences = new Map<string, number>()
  for (const { action } of candidates) occurrences.set(action.id, (occurrences.get(action.id) ?? 0) + 1)
  const actions = candidates.filter(({ moduleId, action }) => {
    if ((occurrences.get(action.id) ?? 0) === 1) return true
    issues.push({ moduleId, actionId: action.id, reason: 'id is declared more than once' })
    return false
  })
  return { actions, issues }
}

type CatalogState = {
  syncedModules: readonly Module[] | null
  discovered: Set<UpgradeActionDefinition>
  owners: WeakMap<UpgradeActionDefinition, string>
  reportedCollisions: Set<string>
}

export type UpgradeActionCatalog = {
  sync: () => void
  ownerOf: (action: UpgradeActionDefinition) => string | null
  list: () => UpgradeActionDefinition[]
}

/**
 * Keeps `target` (the legacy exported array) aligned with the registered modules:
 * manifest actions are replaced on every registry change while entries pushed by
 * hand are preserved. Before bootstrap only manual entries exist.
 */
export function createUpgradeActionCatalog(target: UpgradeActionDefinition[]): UpgradeActionCatalog {
  const state: CatalogState = {
    syncedModules: null,
    discovered: new Set(),
    owners: new WeakMap(),
    reportedCollisions: new Set(),
  }

  const sync = () => {
    const modules = tryGetModules()
    if (modules === state.syncedModules) return
    state.syncedModules = modules
    for (let index = target.length - 1; index >= 0; index -= 1) {
      if (state.discovered.has(target[index])) target.splice(index, 1)
    }
    state.discovered = new Set()
    if (!modules) return
    const { actions, issues } = collectModuleUpgradeActions(modules)
    for (const issue of issues) {
      logger.error('Ignoring invalid upgrade action declaration', issue)
    }
    for (const { moduleId, action } of actions) {
      state.owners.set(action, moduleId)
      state.discovered.add(action)
      target.push(action)
    }
  }

  const list = () => {
    sync()
    const counts = new Map<string, number>()
    for (const action of target) counts.set(upgradeActionKey(action), (counts.get(upgradeActionKey(action)) ?? 0) + 1)
    return target.filter((action) => {
      const key = upgradeActionKey(action)
      if ((counts.get(key) ?? 0) === 1) return true
      if (!state.reportedCollisions.has(key)) {
        state.reportedCollisions.add(key)
        logger.error('Ignoring conflicting upgrade action registrations', { actionId: action.id, version: action.version })
      }
      return false
    })
  }

  onModulesRegistered(() => sync())

  return {
    sync,
    ownerOf: (action) => state.owners.get(action) ?? null,
    list,
  }
}

export function resolveUpgradeActionScope(action: UpgradeActionDefinition): UpgradeActionScope {
  return action.scope ?? 'organization'
}

/**
 * The owner and every declared peer must be enabled. Fails closed when an action
 * has requirements but the enabled-module registry is unavailable.
 */
export function isUpgradeActionAvailable(action: UpgradeActionDefinition, ownerModuleId: string | null): boolean {
  const required = [
    ...(ownerModuleId ? [ownerModuleId] : []),
    ...(Array.isArray(action.requiredModules) ? action.requiredModules : []),
  ]
  if (required.length === 0) return true
  const enabled = new Set(getEnabledModuleIds())
  return required.every((moduleId) => enabled.has(moduleId))
}
