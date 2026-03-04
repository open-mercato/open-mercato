import type { EntityManager } from '@mikro-orm/core'
import { IntegrationState } from '../data/entities'

export type IntegrationStateScope = {
  tenantId: string
  organizationId?: string | null
}

export type IntegrationStateService = {
  get: (integrationId: string, scope: IntegrationStateScope) => Promise<IntegrationState | null>
  setEnabled: (integrationId: string, scope: IntegrationStateScope, enabled: boolean) => Promise<IntegrationState>
  setVersion: (integrationId: string, scope: IntegrationStateScope, version: string | null) => Promise<IntegrationState>
  setHealth: (
    integrationId: string,
    scope: IntegrationStateScope,
    input: { status: 'healthy' | 'unhealthy' | 'unknown'; message?: string | null },
  ) => Promise<IntegrationState>
}

async function ensureState(em: EntityManager, integrationId: string, scope: IntegrationStateScope): Promise<IntegrationState> {
  const organizationScope = scope.organizationId ?? null
  const existing = await em.findOne(IntegrationState, {
    integrationId,
    tenantId: scope.tenantId,
    organizationId: organizationScope,
  })
  if (existing) return existing

  const created = em.create(IntegrationState, {
    integrationId,
    tenantId: scope.tenantId,
    organizationId: organizationScope,
    isEnabled: false,
    healthStatus: 'unknown',
  })
  await em.persistAndFlush(created)
  return created
}

export function createIntegrationStateService(em: EntityManager): IntegrationStateService {
  return {
    async get(integrationId, scope) {
      return em.findOne(IntegrationState, {
        integrationId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId ?? null,
        deletedAt: null,
      })
    },

    async setEnabled(integrationId, scope, enabled) {
      const state = await ensureState(em, integrationId, scope)
      state.isEnabled = enabled
      state.deletedAt = null
      await em.persistAndFlush(state)
      return state
    },

    async setVersion(integrationId, scope, version) {
      const state = await ensureState(em, integrationId, scope)
      state.selectedApiVersion = version
      state.deletedAt = null
      await em.persistAndFlush(state)
      return state
    },

    async setHealth(integrationId, scope, input) {
      const state = await ensureState(em, integrationId, scope)
      state.healthStatus = input.status
      state.healthMessage = input.message ?? null
      state.healthCheckedAt = new Date()
      state.deletedAt = null
      await em.persistAndFlush(state)
      return state
    },
  }
}
