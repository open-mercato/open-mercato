import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ExplainLoadContext } from '@open-mercato/shared/modules/insights/explain'
import type { SimulationFeatureCheck, SimulationScope } from '@open-mercato/shared/modules/insights/simulate'
import { getExplainResource } from '../explain-registry'
import { SIMULATION_SAMPLE_LIMIT } from './constants'
import type { SimulationResultGroup } from './privacy'

const logger = createLogger('insights').child({ component: 'simulation-samples' })

type Resolver = { resolve: (name: string) => unknown }

const UNSAFE_HREF_CHARACTERS = /[\u0000-\u0020\u007f\\]/

/** An app-internal path (`/…`, not `//…`, no control characters or backslashes); anything else is dropped. */
export function toInternalHref(href: unknown): string | null {
  if (typeof href !== 'string' || href.length === 0 || UNSAFE_HREF_CHARACTERS.test(href)) return null
  return href.startsWith('/') && !href.startsWith('//') ? href : null
}

export type SimulationSample = {
  id: string
  href: string | null
}

function tryResolveFactory(container: Resolver) {
  return <TService>(name: string): TService | undefined => {
    try {
      return container.resolve(name) as TService
    } catch {
      return undefined
    }
  }
}

function loadContext(container: Resolver, em: EntityManager, scope: SimulationScope, userId: string): ExplainLoadContext {
  return {
    em,
    resolve: tryResolveFactory(container),
    scope: { tenantId: scope.tenantId, organizationIds: [scope.organizationId] },
    userId,
    locale: null,
  }
}

async function isVisible(load: ExplainLoadContext, resourceKind: string, id: string): Promise<boolean> {
  const registered = getExplainResource(resourceKind)
  if (!registered) return false
  try {
    const current = await registered.descriptor.loadCurrent({ ...load, em: load.em.fork() }, id)
    return current !== null && current !== undefined
  } catch (error) {
    logger.warn('[internal] A simulation sample could not be checked; it is left out', { resourceKind, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_sample_check_failed', attributes: { resourceKind } })
    return false
  }
}

async function canReadResource(resourceKind: string, hasFeatures: SimulationFeatureCheck): Promise<boolean> {
  const registered = getExplainResource(resourceKind)
  if (!registered) return false
  return hasFeatures(registered.descriptor.requiredFeatures)
}

/**
 * S14: keeps at most `SIMULATION_SAMPLE_LIMIT` sample ids per visible cell, and only ids the owning
 * module's scoped explain `loadCurrent` confirms in the run's organization for the requester (whose
 * features for the resource are checked first). A group without an explain resource keeps none.
 */
export async function confirmSimulationSamples(
  container: Resolver,
  em: EntityManager,
  scope: SimulationScope,
  requesterUserId: string,
  hasFeatures: SimulationFeatureCheck,
  groups: SimulationResultGroup[],
): Promise<SimulationResultGroup[]> {
  const load = loadContext(container, em, scope, requesterUserId)
  const readable = new Map<string, boolean>()
  const confirmed: SimulationResultGroup[] = []
  for (const group of groups) {
    const resourceKind = group.sampleResourceKind
    let allowed = false
    if (resourceKind) {
      if (!readable.has(resourceKind)) readable.set(resourceKind, await canReadResource(resourceKind, hasFeatures))
      allowed = readable.get(resourceKind) === true
    }
    const cells = []
    for (const cell of group.cells) {
      const kept: string[] = []
      if (allowed && resourceKind) {
        for (const id of cell.sampleIds) {
          if (kept.length >= SIMULATION_SAMPLE_LIMIT) break
          if (await isVisible(load, resourceKind, id)) kept.push(id)
        }
      }
      cells.push({ ...cell, sampleIds: kept })
    }
    confirmed.push({ ...group, cells })
  }
  return confirmed
}

/**
 * Resolves stored sample ids live for the viewer (S14): only ids the viewer may still read (the
 * resource's features at the run's organization and a non-null scoped `loadCurrent`) are returned,
 * with the owning module's record link.
 */
export async function resolveSimulationSamples(
  container: Resolver,
  em: EntityManager,
  scope: SimulationScope,
  viewerUserId: string,
  hasFeatures: SimulationFeatureCheck,
  resourceKind: string | null,
  ids: readonly string[],
): Promise<SimulationSample[]> {
  if (!resourceKind || ids.length === 0) return []
  if (!(await canReadResource(resourceKind, hasFeatures))) return []
  const registered = getExplainResource(resourceKind)
  if (!registered) return []
  const load = loadContext(container, em, scope, viewerUserId)
  const samples: SimulationSample[] = []
  for (const id of ids.slice(0, SIMULATION_SAMPLE_LIMIT)) {
    if (!(await isVisible(load, resourceKind, id))) continue
    let href: string | null = null
    try {
      href = registered.descriptor.recordHref ? toInternalHref(registered.descriptor.recordHref(id)) : null
    } catch (error) {
      logger.warn('[internal] A simulation sample link could not be built; it is shown without one', { resourceKind, err: error })
      getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_sample_href_failed', attributes: { resourceKind } })
      href = null
    }
    samples.push({ id, href })
  }
  return samples
}
