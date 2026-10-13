import type { EntityManager } from '@mikro-orm/postgresql'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

type DecryptOptions = { em?: EntityManager }

/**
 * Binds row decryption to the request EntityManager so a query engine that decrypts
 * many rows resolves each encryption-policy scope once per request (the policy memo
 * is keyed by the EntityManager) instead of once per row.
 */
export function bindEncryptionServiceToRequest<T extends Pick<TenantDataEncryptionService, 'decryptEntityPayload'>>(
  service: T | null | undefined,
  em: EntityManager,
): T | null {
  if (!service) return null
  return new Proxy(service, {
    get(target, property, receiver) {
      if (property === 'decryptEntityPayload') {
        return (
          entityId: string,
          payload: Record<string, unknown>,
          tenantId: string | null,
          organizationId: string | null,
          options?: DecryptOptions,
        ) => target.decryptEntityPayload(entityId, payload, tenantId, organizationId, { ...options, em: options?.em ?? em })
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
