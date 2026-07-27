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
 */
import { createHash } from 'node:crypto'
import { getBackendRouteManifests } from '../../modules/registry'
import { getEnabledModuleIds } from '../../security/enabledModulesRegistry'
import { getModules } from './registry'

let cachedFingerprint: string | null = null
let cachedManifestsRef: unknown = null
let cachedModulesRef: unknown = null

function readModulesRef(): unknown {
  try {
    return getModules()
  } catch {
    return null
  }
}

export function getModuleSurfaceFingerprint(): string {
  const manifests = getBackendRouteManifests()
  const modulesRef = readModulesRef()
  if (cachedFingerprint !== null && cachedManifestsRef === manifests && cachedModulesRef === modulesRef) {
    return cachedFingerprint
  }
  const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  const moduleIds = [...getEnabledModuleIds()].sort(byCodeUnit)
  const routes = manifests.map((route) => JSON.stringify(route)).sort(byCodeUnit)
  const fingerprint = createHash('sha1')
    .update(JSON.stringify({ modules: moduleIds, routes }))
    .digest('hex')
    .slice(0, 12)
  cachedManifestsRef = manifests
  cachedModulesRef = modulesRef
  cachedFingerprint = fingerprint
  return fingerprint
}
