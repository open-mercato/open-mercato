import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  MASKED_SECRET_VALUE,
  mergeMaskedSecretCredentials,
} from '@open-mercato/core/modules/integrations/lib/credentials-masking'
import { integration } from '../integration'
import { tenantS3CredentialsSchema } from './validators'

export const guards: MutationGuard[] = [{
  id: 'storage_s3.explicit-tenant-credentials',
  targetEntity: 'integrations.integration',
  operations: ['update'],
  async validate(input) {
    if (input.resourceId !== 'storage_s3' || input.requestMethod !== 'PUT') return { ok: true }
    const payload = input.mutationPayload
    if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'credentials')) return { ok: true }
    const { t } = await resolveTranslations()
    const reject = () => ({ ok: false, status: 422, message: t('storage_s3.errors.explicitCredentialsRequired') })
    const credentials = payload.credentials
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) return reject()
    const incoming = credentials as Record<string, unknown>
    const unchangedSecretFields = Array.isArray(payload.unchangedSecretFields)
      ? payload.unchangedSecretFields.filter((field): field is string => typeof field === 'string')
      : []
    let effective = incoming
    if (Object.values(incoming).includes(MASKED_SECRET_VALUE) || unchangedSecretFields.length > 0) {
      if (!input.organizationId) return reject()
      const container = await createRequestContainer()
      const service = container.resolve('integrationCredentialsService') as {
        resolve(id: string, scope: { tenantId: string; organizationId: string }): Promise<Record<string, unknown> | null>
      }
      const existing = await service.resolve('storage_s3', {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      try {
        effective = mergeMaskedSecretCredentials(integration.credentials, incoming, existing ?? {}, unchangedSecretFields)
      } catch {
        return reject()
      }
    }
    const parsed = tenantS3CredentialsSchema.safeParse(effective)
    if (!parsed.success) return reject()
    return { ok: true, modifiedPayload: { credentials: parsed.data, unchangedSecretFields: [] } }
  },
}]
