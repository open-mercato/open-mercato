import type { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { attachmentStorageConfigurationSchema, attachmentStorageScopeSchema } from '../../data/validators'

export type AttachmentStoragePolicy = 'legacy' | 'strict'
export type AttachmentStorageScope = z.infer<typeof attachmentStorageScopeSchema>
export type AttachmentStorageValidationStage = 'configured' | 'resolved'
export type AttachmentStorageValidationContext = {
  readonly driverKey: string
  readonly config: Readonly<Record<string, unknown>>
  readonly partitionCode?: string
  readonly scope?: Readonly<AttachmentStorageScope>
  readonly stage: AttachmentStorageValidationStage
}
export type AttachmentStorageValidator = (context: AttachmentStorageValidationContext) => boolean
export type AttachmentStorageConfigurationReason =
  | 'invalid_policy'
  | 'partition_missing'
  | 'driver_missing'
  | 'unknown_driver'
  | 'invalid_config'
  | 'invalid_scope'
  | 'validator_missing'
  | 'validator_rejected'
  | 'enhancement_failed'

const ERROR_MARKER = Symbol.for('@open-mercato/AttachmentStorageConfigurationError')
const VALIDATORS_KEY = Symbol.for('@open-mercato/AttachmentStorageValidators')
type ValidatorRegistry = Map<string, AttachmentStorageValidator>

function validators(): ValidatorRegistry {
  const registry = globalThis as typeof globalThis & { [VALIDATORS_KEY]?: ValidatorRegistry }
  return registry[VALIDATORS_KEY] ??= new Map()
}

export class AttachmentStorageConfigurationError extends CrudHttpError {
  readonly [ERROR_MARKER] = true
  readonly code = 'ATTACHMENT_STORAGE_CONFIGURATION_INVALID'

  constructor(readonly reason: AttachmentStorageConfigurationReason) {
    super(503, {
      error: 'attachments.errors.storageConfigurationInvalid',
      code: 'ATTACHMENT_STORAGE_CONFIGURATION_INVALID',
      reason,
    })
    this.name = 'AttachmentStorageConfigurationError'
  }
}

export function isAttachmentStorageConfigurationError(error: unknown): error is AttachmentStorageConfigurationError {
  return Boolean(error) && typeof error === 'object'
    && (error as Record<symbol, unknown>)[ERROR_MARKER] === true
}

export function getAttachmentStoragePolicy(): AttachmentStoragePolicy {
  const policy = process.env.OM_ATTACHMENT_STORAGE_POLICY?.trim()
  if (!policy || policy === 'legacy') return 'legacy'
  if (policy === 'strict') return 'strict'
  throw new AttachmentStorageConfigurationError('invalid_policy')
}

export function registerStorageDriverValidator(key: string, validator: AttachmentStorageValidator): () => void {
  const registry = validators()
  registry.set(key, validator)
  return () => {
    if (registry.get(key) === validator) registry.delete(key)
  }
}

export function assertAttachmentStoragePartitionExists(exists: boolean): void {
  if (getAttachmentStoragePolicy() === 'strict' && !exists) {
    throw new AttachmentStorageConfigurationError('partition_missing')
  }
}

export function validateAttachmentStorageConfiguration(
  context: Omit<AttachmentStorageValidationContext, 'driverKey' | 'config'> & {
    driverKey: unknown
    config: unknown
  },
  registered: boolean,
): void {
  if (getAttachmentStoragePolicy() === 'legacy') return
  if (typeof context.driverKey !== 'string' || !context.driverKey.trim()) {
    throw new AttachmentStorageConfigurationError('driver_missing')
  }
  if (!registered) throw new AttachmentStorageConfigurationError('unknown_driver')
  if (!attachmentStorageConfigurationSchema.safeParse(context.config).success) {
    throw new AttachmentStorageConfigurationError('invalid_config')
  }
  if (context.scope && !attachmentStorageScopeSchema.safeParse(context.scope).success) {
    throw new AttachmentStorageConfigurationError('invalid_scope')
  }
  const validator = validators().get(context.driverKey)
  if (!validator) {
    if (context.driverKey === 'local' || context.driverKey === 'legacyPublic') return
    throw new AttachmentStorageConfigurationError('validator_missing')
  }
  try {
    const accepted: unknown = validator({
      ...context,
      driverKey: context.driverKey,
      config: context.config as Record<string, unknown>,
    })
    if (accepted !== true) {
      if (accepted && typeof accepted === 'object' && 'then' in accepted) {
        void Promise.resolve(accepted).catch(() => undefined)
      }
      throw new AttachmentStorageConfigurationError('validator_rejected')
    }
  } catch {
    throw new AttachmentStorageConfigurationError('validator_rejected')
  }
}
