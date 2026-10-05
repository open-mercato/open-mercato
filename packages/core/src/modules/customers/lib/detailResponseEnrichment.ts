import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { applyResponseEnricherToRecord } from '@open-mercato/shared/lib/crud/enricher-runner'
import { extractResponseEnricherNamespaces } from '@open-mercato/shared/lib/crud/response-enricher-namespaces'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

type DetailRecordKey = 'person' | 'company' | 'deal'

type DetailEnrichmentContext = {
  auth: NonNullable<AuthContext>
  container: AppContainer
  em: EntityManager
  tenantId: string | null
  organizationId: string | null
}

export async function enrichCustomerDetailResponse<T extends Record<string, unknown>>(
  payload: T,
  recordKey: DetailRecordKey,
  context: DetailEnrichmentContext,
): Promise<T> {
  const clonedPayload = structuredClone(payload)
  const mainRecord = clonedPayload[recordKey]
  if (!context.tenantId || !context.organizationId || !mainRecord || typeof mainRecord !== 'object' || Array.isArray(mainRecord)) {
    return clonedPayload
  }
  let userFeatures: string[] | undefined
  try {
    const rbac = context.container.resolve<RbacService>('rbacService')
    if (rbac?.getGrantedFeatures) {
      userFeatures = await rbac.getGrantedFeatures(context.auth.sub, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
      })
    }
  } catch {
    userFeatures = undefined
  }
  const record = mainRecord as Record<string, unknown>
  const result = await applyResponseEnricherToRecord(structuredClone(record), `customers.${recordKey}`, {
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    userId: context.auth.sub,
    em: context.em,
    container: context.container,
    userFeatures,
  })
  const namespaces = extractResponseEnricherNamespaces(result.record)
  return { ...clonedPayload, ...namespaces, [recordKey]: { ...record, ...namespaces } }
}
