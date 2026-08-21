import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  PrivacyDataClassHandler,
  PrivacyEnvironmentSanitizationInput,
} from '@open-mercato/shared/lib/privacy'
import { registerPrivacyDataClass } from '@open-mercato/shared/lib/privacy'
import { getAllBundles, getAllIntegrations } from '@open-mercato/shared/modules/integrations/types'
import { IntegrationCredentials, IntegrationState } from './data/entities'
import type { IntegrationStateService } from './lib/state-service'

export const INTEGRATION_SECRETS_DATA_CLASS_ID = 'integrations.secrets'

registerPrivacyDataClass({
  id: INTEGRATION_SECRETS_DATA_CLASS_ID,
  module: 'integrations',
  title: 'Integration credentials and outbound state',
  description: 'Stored connector credentials and runtime enablement state.',
  handlerService: 'integrationEnvironmentPrivacyHandler',
  subjectKinds: [],
  subjectActions: [],
  environmentSanitization: { categories: ['credentials', 'outbound_integrations'] },
})

export class IntegrationEnvironmentPrivacyHandler implements PrivacyDataClassHandler {
  constructor(
    private readonly em: EntityManager,
    private readonly integrationStateService: IntegrationStateService,
  ) {}

  async sanitizeEnvironment(input: PrivacyEnvironmentSanitizationInput) {
    const credentialCount = await this.countCredentials(input)
    const unsafeIntegrationIds = await this.findUnsafeIntegrationIds(input)
    const matched = credentialCount + unsafeIntegrationIds.length
    if (input.dryRun || matched === 0) return { matched, affected: 0 }

    await this.em.nativeDelete(IntegrationCredentials, {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    })
    for (const integrationId of await this.targetIntegrationIds(input)) {
      await this.integrationStateService.upsert(integrationId, {
        isEnabled: false,
        reauthRequired: true,
        lastHealthStatus: null,
        lastHealthCheckedAt: null,
        lastHealthLatencyMs: null,
        enabledAt: null,
      }, input.scope)
    }

    return { matched, affected: matched }
  }

  async verifyEnvironmentSanitization(input: PrivacyEnvironmentSanitizationInput) {
    const credentials = await this.countCredentials(input)
    const unsafeIntegrations = (await this.findUnsafeIntegrationIds(input)).length
    const findings = [
      { code: 'integrations.credentials_present', count: credentials },
      { code: 'integrations.outbound_state_unsafe', count: unsafeIntegrations },
    ].filter((finding) => finding.count > 0)
    return { passed: findings.length === 0, findings }
  }

  private countCredentials(input: PrivacyEnvironmentSanitizationInput): Promise<number> {
    return this.em.count(IntegrationCredentials, {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      deletedAt: null,
    })
  }

  private registeredIntegrationIds(): string[] {
    return Array.from(new Set([
      ...getAllIntegrations().map((definition) => definition.id),
      ...getAllBundles().map((bundle) => bundle.id),
    ])).sort()
  }

  private async findUnsafeIntegrationIds(input: PrivacyEnvironmentSanitizationInput): Promise<string[]> {
    const ids = await this.targetIntegrationIds(input)
    if (ids.length === 0) return []
    const states = await this.em.find(IntegrationState, {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      integrationId: { $in: ids },
      deletedAt: null,
    })
    const byId = new Map(states.map((state) => [state.integrationId, state]))
    return ids.filter((id) => {
      const state = byId.get(id)
      return !state || state.isEnabled || !state.reauthRequired
    })
  }

  private async targetIntegrationIds(input: PrivacyEnvironmentSanitizationInput): Promise<string[]> {
    const persisted = await this.em.find(IntegrationState, {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      deletedAt: null,
    })
    return Array.from(new Set([
      ...this.registeredIntegrationIds(),
      ...persisted.map((state) => state.integrationId),
    ])).sort()
  }
}
