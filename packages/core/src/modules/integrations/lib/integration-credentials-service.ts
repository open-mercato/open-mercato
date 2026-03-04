import type { EntityManager } from '@mikro-orm/core'
import { IntegrationCredentials } from '../data/entities'

export type IntegrationScope = {
  tenantId: string
  organizationId?: string | null
}

export type IntegrationCredentialsService = {
  resolve: (integrationId: string, scope: IntegrationScope) => Promise<Record<string, unknown> | null>
  save: (integrationId: string, scope: IntegrationScope, credentials: Record<string, unknown>) => Promise<void>
  remove: (integrationId: string, scope: IntegrationScope) => Promise<void>
}

export function createIntegrationCredentialsService(em: EntityManager): IntegrationCredentialsService {
  return {
    async resolve(integrationId, scope) {
      const organizationScope = scope.organizationId ?? null
      const record = await em.findOne(IntegrationCredentials, {
        integrationId,
        tenantId: scope.tenantId,
        organizationId: organizationScope,
        deletedAt: null,
      })

      if (record?.credentialsJson && typeof record.credentialsJson === 'object') {
        return record.credentialsJson
      }

      const fallback = await em.findOne(IntegrationCredentials, {
        integrationId,
        tenantId: scope.tenantId,
        organizationId: null,
        deletedAt: null,
      })

      return fallback?.credentialsJson && typeof fallback.credentialsJson === 'object'
        ? fallback.credentialsJson
        : null
    },

    async save(integrationId, scope, credentials) {
      const organizationScope = scope.organizationId ?? null
      const existing = await em.findOne(IntegrationCredentials, {
        integrationId,
        tenantId: scope.tenantId,
        organizationId: organizationScope,
      })

      if (existing) {
        existing.credentialsJson = credentials
        existing.deletedAt = null
        await em.persistAndFlush(existing)
        return
      }

      const created = em.create(IntegrationCredentials, {
        integrationId,
        tenantId: scope.tenantId,
        organizationId: organizationScope,
        credentialsJson: credentials,
      })
      await em.persistAndFlush(created)
    },

    async remove(integrationId, scope) {
      const organizationScope = scope.organizationId ?? null
      const existing = await em.findOne(IntegrationCredentials, {
        integrationId,
        tenantId: scope.tenantId,
        organizationId: organizationScope,
        deletedAt: null,
      })
      if (!existing) return
      existing.deletedAt = new Date()
      await em.persistAndFlush(existing)
    },
  }
}
