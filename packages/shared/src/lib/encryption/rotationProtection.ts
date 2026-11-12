import type { EntityManager } from '@mikro-orm/postgresql'
import type { KmsService } from './kms'

export type RotationTimestampIntent = {
  table: string
  identity: string
  tenantId: string
  organizationId: string | null
  previousTimestamp: string | Date | null
}

export type RotationKeyProviders = {
  kms: KmsService
  previousKms: KmsService | null
  timestampForWrite?: (intent: RotationTimestampIntent) => Promise<Date>
}

export type RotationProtectionContext = {
  tenantId: string | null
  organizationId: string | null
  dryRun: boolean
  entityManager: EntityManager
  previousKey: string | null
}

export interface RotationProtectionService {
  protect(
    context: RotationProtectionContext,
    operation: (providers?: RotationKeyProviders) => Promise<void>,
  ): Promise<void>
}
