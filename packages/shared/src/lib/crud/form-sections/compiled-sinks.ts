import { z } from 'zod'
import type { EntityClass } from '@mikro-orm/core'
import type { CrudFormSectionAddress, CrudFormExtensionSinkFact } from '../../../modules/form-section-facts'
import type { CrudFormSectionSink } from '../../../modules/form-sections'
import type { CompiledCrudFormSinkAssociation } from './compiled-extensions'
import { resolveCompiledStoreEntity, type CompiledStoreRow } from './compiled-store-entities'
import { createCrudFormCompiledTableSink } from './compiled-table-store'
import { defineCrudFormSectionOutboxSink, type CrudFormSectionOutboxMirror } from './outbox'
import { createCrudFormSectionOutboxMirror, outboxColumns } from './outbox-columns'
import { symbolicIdSchema } from './protocol'

export type CompiledCrudFormValueField = Readonly<{
  key: string
  kind: 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'select' | 'custom'
  required?: boolean
  options?: readonly string[]
}>

const mirrorCache = new WeakMap<EntityClass<CompiledStoreRow>, CrudFormSectionOutboxMirror>()

function fieldSchema({ kind, required, options }: CompiledCrudFormValueField): z.ZodType {
  const schema: z.ZodType = kind === 'number' ? z.number()
    : kind === 'boolean' ? z.boolean()
      : kind === 'date' ? z.iso.date()
        : kind === 'custom' ? z.json()
          : kind === 'select' && options?.length ? z.enum(options)
            : z.string()
  return required ? schema.refine((value) => value !== null && !(typeof value === 'string' && !value.trim()))
    : schema.nullish()
}

function storedFields(association: CompiledCrudFormSinkAssociation): readonly CompiledCrudFormValueField[] | null {
  const fields = association.fields ?? []
  const prefix = `extensions.${association.ownerModuleId}.`
  const paths = new Set(association.payloadPaths)
  const reserved = new Set(['constructor', '__proto__', 'prototype', '__updatedAt', '__sync', 'id', 'tenantId', 'organizationId', 'hostId', 'updatedAt'])
  if (!fields.length || paths.size !== fields.length || !fields.every(({ key }) => /^[a-zA-Z0-9_]+$/.test(key)
      && !reserved.has(key) && paths.delete(prefix + key))) return null
  return fields
}

export function bindCompiledCrudFormGenericSink(
  association: CompiledCrudFormSinkAssociation,
  address: CrudFormSectionAddress,
): CrudFormSectionSink | null {
  const { store, ownerModuleId, id, roundTripId, capabilityId, hostDetailEntityId, payloadPaths } = association
  if (store.kind !== 'external' && store.kind !== 'table') return null
  const fields = storedFields(association)
  if (!fields) return null
  const targetEntityId = store.kind === 'table' ? store.entityId : store.config.mirror
  const columns = fields.map(({ key }) => key)
  const entity = resolveCompiledStoreEntity(ownerModuleId, targetEntityId, columns, association.entityExports, store.kind === 'external')
  if (!entity) return null
  const schema = z.strictObject(Object.fromEntries(fields.map((field) => [field.key, fieldSchema(field)])))
  const sharedFact = {
    ...address, id, roundTripId, ownerModuleId, targetEntityId, payloadPaths, optimisticLock: 'sink-version', undo: 'snapshot',
  } as const
  if (store.kind === 'table') return createCrudFormCompiledTableSink({
    fact: { ...sharedFact, atomicity: 'host-transaction' }, capabilityId, hostDetailEntityId, schema, columns, entity,
  })
  const { integrationId, contractId = `${targetEntityId}@v1`, maxAttempts = 5, deliver, validateExternal,
    failureNotificationType = `${ownerModuleId}.crud_form_sync_failed` } = store.config
  if (!(entity.prototype instanceof outboxColumns) || !symbolicIdSchema.safeParse(integrationId).success
      || !contractId.startsWith(targetEntityId + '@v') || !/^[1-9][0-9]*$/.test(contractId.slice(targetEntityId.length + 2))
      || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || typeof deliver !== 'function') return null
  const fact = {
    ...sharedFact,
    atomicity: 'outbox',
    externalDelivery: {
      integrationId, contractId, maxAttempts, preCommitValidation: validateExternal ? 'read-only' : 'none',
      coalesce: 'latest-state', fencing: 'remote-monotonic-revision/v1',
    },
  } as const satisfies CrudFormExtensionSinkFact
  const mirror = mirrorCache.get(entity) ?? createCrudFormSectionOutboxMirror(
    entity as unknown as Parameters<typeof createCrudFormSectionOutboxMirror>[0],
  )
  mirrorCache.set(entity, mirror)
  return defineCrudFormSectionOutboxSink({
    fact, capabilityId, hostDetailEntityId, schema,
    outbox: { mirror, deliver, validateExternal, failureNotificationType },
  })
}
