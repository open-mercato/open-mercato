/**
 * Deploy-time fingerprint of the registered module surface.
 *
 * Some cached payloads are derived from state that only changes when the app
 * is redeployed — the enabled module set and the backend route manifest. That
 * state has no database write to hang a tag invalidation off, so a cache key
 * that omits it keeps serving the pre-deploy payload to anyone with a warm
 * entry (see `/api/auth/admin/nav`, whose payload embeds
 * `filterGrantsByEnabledModules(...)` computed at write time).
 *
 * Mixing this fingerprint into such keys makes new processes write to new
 * keys, so old and new pods coexist during a rolling deploy without a purge
 * step and without any ordering constraint between purge and rollout.
 *
 * Covered inputs: the enabled module ids, each module's declared `features`
 * (which drive `filterGrantsByEnabledModules`, including the `*` superadmin
 * expansion and off-convention prefixes), and every JSON-serializable field
 * of the backend route manifest.
 *
 * NOT covered: a route's `icon`. It is a React element whose `type` is a
 * function, which `JSON.stringify` drops — two different icon components
 * serialize identically. Swapping an icon heals on the caller's TTL, not on
 * the fingerprint. Callers MUST therefore still pass a `ttl`.
 */
import { createHash } from 'node:crypto'
import type { Module } from '../../modules/registry'
import { getBackendRouteManifests } from '../../modules/registry'
import { getModules } from './registry'

const UNKNOWN_FINGERPRINT = 'unknown'

let cachedFingerprint: string | null = null
let cachedManifestsRef: unknown = null
let cachedModulesRef: unknown = null

function readModulesRef(): readonly Module[] | null {
  try {
    return getModules()
  } catch {
    return null
  }
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function describeModules(modules: readonly Module[] | null): string[] {
  if (!modules) return []
  return modules
    .map((mod) => {
      const features = (Array.isArray(mod.features) ? mod.features : [])
        .filter((feature) => feature && typeof feature.id === 'string' && feature.id.length > 0)
        .map((feature) => `${feature.id}:${feature.module || mod.id}`)
        .sort(byCodeUnit)
      return JSON.stringify({ id: mod.id, features })
    })
    .sort(byCodeUnit)
}

export function getModuleSurfaceFingerprint(): string {
  const manifests = getBackendRouteManifests()
  const modulesRef = readModulesRef()
  if (cachedFingerprint !== null && cachedManifestsRef === manifests && cachedModulesRef === modulesRef) {
    return cachedFingerprint
  }
  // The manifest carries third-party route metadata and module-scope React
  // elements, so serialization is not fully under this repo's control. Every
  // other fallible step in the nav handler degrades rather than throws, and a
  // throw here would blank the entire admin chrome — fall back to a constant,
  // which is exactly the pre-fingerprint behavior.
  let fingerprint: string
  try {
    const modules = describeModules(modulesRef)
    const routes = manifests.map((route) => JSON.stringify(route)).sort(byCodeUnit)
    fingerprint = createHash('sha1')
      .update(JSON.stringify({ modules, routes }))
      .digest('hex')
      .slice(0, 12)
  } catch {
    fingerprint = UNKNOWN_FINGERPRINT
  }
  cachedManifestsRef = manifests
  cachedModulesRef = modulesRef
  cachedFingerprint = fingerprint
  return fingerprint
}
