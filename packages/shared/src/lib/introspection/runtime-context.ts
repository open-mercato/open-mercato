import { getModules } from '../modules/registry'
import type { AppContainer } from '../di/container'
import type { EntityManager } from '@mikro-orm/core'
import type { IntrospectionContext } from './types'
import { loadIntrospectionSnapshot, type IntrospectionSnapshotField } from './snapshot-loader'

const SNAPSHOT_FIELDS_BY_SURFACE: Record<string, IntrospectionSnapshotField[]> = {
  notification: ['notificationTypes'],
  'ai-tool': ['aiToolConfigEntries'],
}

export async function buildRuntimeIntrospectionContext(input: {
  container?: AppContainer
  em?: EntityManager
  tenantId?: string | null
  organizationId?: string | null
  surfaceIds?: string[]
}): Promise<IntrospectionContext> {
  const snapshotFields = resolveSnapshotFields(input.surfaceIds)
  const snapshot = snapshotFields.length > 0 ? await loadIntrospectionSnapshot(snapshotFields) : undefined

  return {
    modules: getModules(),
    container: input.container,
    em: input.em,
    tenantId: input.tenantId ?? null,
    organizationId: input.organizationId ?? null,
    snapshot,
  }
}

function resolveSnapshotFields(surfaceIds?: string[]): IntrospectionSnapshotField[] {
  if (!surfaceIds?.length) return []
  const fields = new Set<IntrospectionSnapshotField>()
  for (const surfaceId of surfaceIds) {
    for (const field of SNAPSHOT_FIELDS_BY_SURFACE[surfaceId] ?? []) {
      fields.add(field)
    }
  }
  return [...fields]
}
