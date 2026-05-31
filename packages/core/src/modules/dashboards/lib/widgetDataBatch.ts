import type { WidgetDataRequest, WidgetDataResponse } from '../services/widgetDataService'

export type WidgetDataBatchEntry = {
  id: string
  request: WidgetDataRequest
}

export type WidgetDataBatchResult =
  | { id: string; ok: true; data: WidgetDataResponse }
  | { id: string; ok: false; error: string }

export type WidgetDataBatchDeps = {
  getRequiredFeatures: (entityType: string) => string[] | null
  checkFeatures: (features: string[]) => Promise<boolean>
  fetchOne: (request: WidgetDataRequest) => Promise<WidgetDataResponse>
  describeError: (error: unknown) => string
}

/**
 * Resolves per-entity-type feature access for a batch of widget requests while
 * collapsing the common case to a single RBAC resolution. The happy path checks
 * the union of all required features once; only when the union check fails do we
 * fall back to per-entity-type checks so a single privileged entity type does
 * not reject widgets the caller is allowed to see.
 */
export async function resolveEntityFeatureAccess(
  entityTypes: string[],
  getRequiredFeatures: (entityType: string) => string[] | null,
  checkFeatures: (features: string[]) => Promise<boolean>,
): Promise<Map<string, boolean>> {
  const access = new Map<string, boolean>()
  const featuresByEntity = new Map<string, string[]>()
  const unionFeatures = new Set<string>()

  for (const entityType of new Set(entityTypes)) {
    const features = getRequiredFeatures(entityType) ?? []
    featuresByEntity.set(entityType, features)
    if (features.length === 0) {
      access.set(entityType, true)
    } else {
      for (const feature of features) unionFeatures.add(feature)
    }
  }

  const gated = [...featuresByEntity.entries()].filter(([, features]) => features.length > 0)
  if (gated.length === 0) return access

  if (await checkFeatures([...unionFeatures])) {
    for (const [entityType] of gated) access.set(entityType, true)
    return access
  }

  for (const [entityType, features] of gated) {
    access.set(entityType, await checkFeatures(features))
  }
  return access
}

/**
 * Runs a batch of widget-data requests against shared request-scoped
 * dependencies (a single container, RBAC resolution, org-scope, and EM fork).
 * Feature access is resolved once up front; each request is then executed
 * concurrently with per-widget error isolation so one bad request never fails
 * the whole batch.
 */
export async function runWidgetDataBatch(
  entries: WidgetDataBatchEntry[],
  deps: WidgetDataBatchDeps,
): Promise<WidgetDataBatchResult[]> {
  const access = await resolveEntityFeatureAccess(
    entries.map((entry) => entry.request.entityType),
    deps.getRequiredFeatures,
    deps.checkFeatures,
  )

  return Promise.all(
    entries.map(async (entry): Promise<WidgetDataBatchResult> => {
      if (access.get(entry.request.entityType) === false) {
        return { id: entry.id, ok: false, error: 'Forbidden' }
      }
      try {
        const data = await deps.fetchOne(entry.request)
        return { id: entry.id, ok: true, data }
      } catch (error) {
        return { id: entry.id, ok: false, error: deps.describeError(error) }
      }
    }),
  )
}
