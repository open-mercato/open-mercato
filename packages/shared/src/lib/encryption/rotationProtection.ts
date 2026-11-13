import type { EntityManager } from '@mikro-orm/postgresql'
import type { KmsService } from './kms'

export type RotationTimestampIntent = {
  table: string
  identity: string
  tenantId: string
  organizationId: string | null
  previousTimestamp: string | Date | null
}

export type RotationBatchCheckpoint = {
  operationId: string
  cursor: string[]
  readRows: number
  writtenRows: number
}

export type RotationKeyProviders = {
  signal?: AbortSignal
  batchSize?: number
  resumeCursor?: (operationId: string) => Promise<string[] | null>
  checkpointBatch?: (checkpoint: RotationBatchCheckpoint) => Promise<void>
  kms: KmsService
  previousKms: KmsService | null
  timestampForBatchWrite?: (intents: RotationTimestampIntent[]) => Promise<Date[]>
  timestampForWrite?: (intent: RotationTimestampIntent) => Promise<Date>
}

export type RotationProtectionContext = {
  tenantId: string | null
  organizationId: string | null
  dryRun: boolean
  entityManager: EntityManager
  previousKey: string | null
  systemScopedEntityIds?: readonly string[]
}

export interface RotationProtectionService {
  protect(
    context: RotationProtectionContext,
    operation: (providers?: RotationKeyProviders) => Promise<void>,
  ): Promise<void>
}
