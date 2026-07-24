import type { IntrospectionBootstrapData } from '../bootstrap/dynamicLoader'
import type { AppContainer } from '../di/container'
import type { EntityManager } from '@mikro-orm/core'
import type { IntrospectionContext, IntrospectionSnapshot } from './types'

export function buildIntrospectionContext(input: {
  bootstrapData: IntrospectionBootstrapData
  container?: AppContainer
  em?: EntityManager
  tenantId?: string | null
  organizationId?: string | null
}): IntrospectionContext {
  const snapshot: IntrospectionSnapshot = {
    notificationTypes: input.bootstrapData.notificationTypes,
    aiToolConfigEntries: input.bootstrapData.aiToolConfigEntries,
    messageTypes: input.bootstrapData.messageTypes,
  }

  return {
    modules: input.bootstrapData.modules,
    container: input.container,
    em: input.em,
    tenantId: input.tenantId ?? null,
    organizationId: input.organizationId ?? null,
    snapshot,
  }
}
