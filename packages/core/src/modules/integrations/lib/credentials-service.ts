import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getBundle, getIntegration, resolveIntegrationCredentialsSchema } from '@open-mercato/shared/modules/integrations/types'
import { IntegrationCredentials } from '../data/entities'

export type IntegrationScope = {
  organizationId: string
  tenantId: string
}

export function createCredentialsService(em: EntityManager) {
  return {
    async getRaw(integrationId: string, scope: IntegrationScope): Promise<Record<string, unknown> | null> {
      const row = await findOneWithDecryption(
        em,
        IntegrationCredentials,
        {
          integrationId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        },
        undefined,
        scope,
      )
      if (!row) return null
      return row.credentials
    },

    async resolve(integrationId: string, scope: IntegrationScope): Promise<Record<string, unknown> | null> {
      const direct = await this.getRaw(integrationId, scope)
      if (direct) return direct

      const definition = getIntegration(integrationId)
      if (!definition?.bundleId) return null
      return this.getRaw(definition.bundleId, scope)
    },

    async save(integrationId: string, credentials: Record<string, unknown>, scope: IntegrationScope): Promise<void> {
      const row = await findOneWithDecryption(
        em,
        IntegrationCredentials,
        {
          integrationId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        },
        undefined,
        scope,
      )

      if (row) {
        row.credentials = credentials
        await em.flush()
        return
      }

      const created = em.create(IntegrationCredentials, {
        integrationId,
        credentials,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
      await em.persistAndFlush(created)
    },

    async saveField(
      integrationId: string,
      fieldKey: string,
      value: unknown,
      scope: IntegrationScope,
    ): Promise<Record<string, unknown>> {
      const current = (await this.getRaw(integrationId, scope)) ?? {}
      const updated = { ...current, [fieldKey]: value }
      await this.save(integrationId, updated, scope)
      return updated
    },

    getSchema(integrationId: string) {
      const definition = getIntegration(integrationId)
      if (!definition) return undefined

      if (definition.bundleId) {
        const bundle = getBundle(definition.bundleId)
        return bundle?.credentials ?? resolveIntegrationCredentialsSchema(integrationId)
      }

      return definition.credentials ?? resolveIntegrationCredentialsSchema(integrationId)
    },
  }
}

export type CredentialsService = ReturnType<typeof createCredentialsService>
