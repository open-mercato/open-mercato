import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getIntegration, type IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { IntegrationState } from '../data/entities'

export type ResolvedIntegrationState = {
  isEnabled: boolean
  apiVersion: string | null
  reauthRequired: boolean
  lastHealthStatus: string | null
  lastHealthCheckedAt: Date | null
}

export function createIntegrationStateService(em: EntityManager) {
  function resolveDefinitionDefaults(integrationId: string): ResolvedIntegrationState {
    const definition = getIntegration(integrationId)

    return {
      isEnabled: definition?.defaultState?.isEnabled ?? false,
      apiVersion: null,
      reauthRequired: false,
      lastHealthStatus: null,
      lastHealthCheckedAt: null,
    }
  }

  return {
    async get(integrationId: string, scope: IntegrationScope): Promise<IntegrationState | null> {
      return findOneWithDecryption(
        em,
        IntegrationState,
        {
          integrationId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        },
        undefined,
        scope,
      )
    },

    async resolveState(integrationId: string, scope: IntegrationScope): Promise<ResolvedIntegrationState> {
      const state = await this.get(integrationId, scope)
      const defaults = resolveDefinitionDefaults(integrationId)

      return {
        isEnabled: state?.isEnabled ?? defaults.isEnabled,
        apiVersion: state?.apiVersion ?? null,
        reauthRequired: state?.reauthRequired ?? false,
        lastHealthStatus: state?.lastHealthStatus ?? null,
        lastHealthCheckedAt: state?.lastHealthCheckedAt ?? null,
      }
    },

    async isEnabled(integrationId: string, scope: IntegrationScope): Promise<boolean> {
      const state = await this.resolveState(integrationId, scope)
      return state.isEnabled
    },

    async upsert(
      integrationId: string,
      input: Partial<Pick<IntegrationState, 'isEnabled' | 'apiVersion' | 'reauthRequired' | 'lastHealthStatus' | 'lastHealthCheckedAt'>>,
      scope: IntegrationScope,
    ): Promise<IntegrationState> {
      const current = await this.get(integrationId, scope)
      if (current) {
        if (input.isEnabled !== undefined) current.isEnabled = input.isEnabled
        if (input.apiVersion !== undefined) current.apiVersion = input.apiVersion
        if (input.reauthRequired !== undefined) current.reauthRequired = input.reauthRequired
        if (input.lastHealthStatus !== undefined) current.lastHealthStatus = input.lastHealthStatus
        if (input.lastHealthCheckedAt !== undefined) current.lastHealthCheckedAt = input.lastHealthCheckedAt
        await em.flush()
        return current
      }

      const created = em.create(IntegrationState, {
        integrationId,
        isEnabled: input.isEnabled ?? false,
        apiVersion: input.apiVersion,
        reauthRequired: input.reauthRequired ?? false,
        lastHealthStatus: input.lastHealthStatus,
        lastHealthCheckedAt: input.lastHealthCheckedAt,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
      await em.persistAndFlush(created)
      return created
    },

    async resolveApiVersion(integrationId: string, scope: IntegrationScope): Promise<string | undefined> {
      const state = await this.get(integrationId, scope)
      return state?.apiVersion ?? undefined
    },

    async setReauthRequired(integrationId: string, required: boolean, scope: IntegrationScope): Promise<IntegrationState> {
      return this.upsert(integrationId, { reauthRequired: required }, scope)
    },
  }
}

export type IntegrationStateService = ReturnType<typeof createIntegrationStateService>
