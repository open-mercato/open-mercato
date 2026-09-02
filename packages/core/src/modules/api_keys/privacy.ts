import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  PrivacyDataClassHandler,
  PrivacyEnvironmentSanitizationInput,
} from '@open-mercato/shared/lib/privacy'
import { registerPrivacyDataClass } from '@open-mercato/shared/lib/privacy'
import { ApiKey } from './data/entities'

export const API_KEYS_CREDENTIALS_DATA_CLASS_ID = 'api_keys.credentials'

registerPrivacyDataClass({
  id: API_KEYS_CREDENTIALS_DATA_CLASS_ID,
  module: 'api_keys',
  title: 'API key credentials',
  description: 'Tenant and organization scoped API credentials, including temporary AI session keys.',
  handlerService: 'apiKeyEnvironmentPrivacyHandler',
  subjectKinds: [],
  subjectActions: [],
  environmentSanitization: { categories: ['credentials', 'authentication'] },
})

export class ApiKeyEnvironmentPrivacyHandler implements PrivacyDataClassHandler {
  constructor(private readonly em: EntityManager) {}

  async sanitizeEnvironment(input: PrivacyEnvironmentSanitizationInput) {
    const matched = await this.countKeys(input)
    if (input.dryRun || matched === 0) return { matched, affected: 0 }
    await this.em.nativeDelete(ApiKey, this.scope(input))
    return { matched, affected: matched }
  }

  async verifyEnvironmentSanitization(input: PrivacyEnvironmentSanitizationInput) {
    const keys = await this.countKeys(input)
    const findings = keys > 0 ? [{ code: 'api_keys.active_credentials', count: keys }] : []
    return { passed: findings.length === 0, findings }
  }

  private countKeys(input: PrivacyEnvironmentSanitizationInput): Promise<number> {
    return this.em.count(ApiKey, { ...this.scope(input), deletedAt: null })
  }

  private scope(input: PrivacyEnvironmentSanitizationInput) {
    return {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    }
  }
}
