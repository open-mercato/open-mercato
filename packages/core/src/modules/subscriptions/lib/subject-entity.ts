import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import type { EntityId } from '@open-mercato/shared/modules/entities'

type SubjectEntityScope = {
  tenantId: string
  organizationId: string
}

const SUBJECT_ENTITY_TYPE_ALIASES: Record<string, string> = {
  'customers:customer_company': 'customers:customer_company_profile',
  'customers:customer_person': 'customers:customer_person_profile',
}

function listRegisteredEntityIds(): Set<string> {
  const ids = new Set<string>()
  const entityIds = getEntityIds()
  for (const moduleIds of Object.values(entityIds)) {
    for (const entityId of Object.values(moduleIds ?? {})) {
      if (typeof entityId === 'string' && entityId.length > 0) ids.add(entityId)
    }
  }
  return ids
}

export function normalizeSubjectEntityType(entityType: string): string {
  const registered = listRegisteredEntityIds()
  if (registered.has(entityType)) return entityType
  const aliased = SUBJECT_ENTITY_TYPE_ALIASES[entityType]
  if (aliased && registered.has(aliased)) return aliased
  return entityType
}

export function isRegisteredSubjectEntityType(entityType: string): boolean {
  return listRegisteredEntityIds().has(normalizeSubjectEntityType(entityType))
}

export async function assertSubjectEntityExists(
  queryEngine: QueryEngine,
  scope: SubjectEntityScope,
  entityType: string,
  entityId: string,
): Promise<void> {
  const normalizedEntityType = normalizeSubjectEntityType(entityType)

  if (!isRegisteredSubjectEntityType(normalizedEntityType)) {
    throw new CrudHttpError(400, {
      error: `subscriptions.checkout: unknown subjectEntityType "${entityType}"`,
    })
  }

  const result = await queryEngine.query(normalizedEntityType as EntityId, {
    fields: ['id'],
    filters: {
      id: { $eq: entityId },
    },
    page: { page: 1, pageSize: 1 },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  const found = Array.isArray(result.items)
    && result.items.some((item) => item && typeof item === 'object' && (item as Record<string, unknown>).id === entityId)

  if (!found) {
    throw new CrudHttpError(404, {
      error: `subscriptions.checkout: subject entity "${normalizedEntityType}:${entityId}" not found`,
    })
  }
}
