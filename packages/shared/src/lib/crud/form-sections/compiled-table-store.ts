import { isDeepStrictEqual } from 'node:util'
import { LockMode, type EntityClass } from '@mikro-orm/core'
import type { z } from 'zod'
import type { CrudFormExtensionSinkFact } from '../../../modules/form-section-facts'
import { defineCrudFormSectionSink, type CrudFormSectionSink } from '../../../modules/form-sections'
import { findOneWithDecryption } from '../../encryption/find'
import { CrudHttpError } from '../errors'
import { assertOptimisticLock, enforceRecordGoneIsConflict } from '../optimistic-lock-command'
import type { CompiledStoreRow } from './compiled-store-entities'

type Values = Record<string, unknown>
type Load = Parameters<CrudFormSectionSink['load']>[0]
type Write = Omit<Parameters<CrudFormSectionSink['persist']>[0], 'values' | 'hostOperation' | 'lockedRow'>

const invalid = () => new CrudHttpError(409, { error: 'extension_policy_mismatch', code: 'extension_policy_mismatch' })

function scopeOf({ scope, hostResourceId }: Load | Write) {
  if (!scope.tenantId || !scope.organizationId || !hostResourceId) throw invalid()
  return { tenantId: scope.tenantId, organizationId: scope.organizationId, hostId: hostResourceId }
}

function nextVersion(...previous: (Date | undefined)[]): Date {
  if (previous.some((current) => current && (!(current instanceof Date) || !Number.isFinite(current.getTime())))) throw invalid()
  return new Date(Math.max(Date.now(), ...previous.map((current) => current ? current.getTime() + 1 : 0)))
}

export function createCrudFormCompiledTableSink(input: {
  fact: CrudFormExtensionSinkFact
  capabilityId: string
  hostDetailEntityId: string
  columns: readonly string[]
  schema: z.ZodType<Values>
  entity: EntityClass<CompiledStoreRow>
}): CrudFormSectionSink {
  const { entity, columns, schema, fact, capabilityId, hostDetailEntityId } = input
  const ownedValues = (row: CompiledStoreRow) => Object.fromEntries(columns.flatMap((key) =>
    row[key] === undefined ? [] : [[key, structuredClone(row[key])]]))
  const read = async (context: Load | Write, lock = false) => {
    if (lock && !context.em.isInTransaction()) throw invalid()
    const where = scopeOf(context)
    const row = await findOneWithDecryption(context.em, entity, where, {
      refresh: true, ...(lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}),
    }, where)
    if (row && (row.tenantId !== where.tenantId || row.organizationId !== where.organizationId
        || row.hostId !== where.hostId || !(row.updatedAt instanceof Date)
        || !Number.isFinite(row.updatedAt.getTime()))) throw invalid()
    return row
  }

  return defineCrudFormSectionSink({
    fact, capabilityId, hostDetailEntityId, schema, tableVersioned: true,
    async lockRow(context) {
      const row = await read(context, true)
      return row ? { values: ownedValues(row), updatedAt: row.updatedAt } : null
    },
    async load(context) {
      const row = await read(context)
      return row ? { values: ownedValues(row), updatedAt: row.updatedAt } : null
    },
    async persist(context) {
      const row = await read(context, true)
      const before = row ? ownedValues(row) : null
      if (Boolean(row) !== Boolean(context.lockedRow)
          || (row && !isDeepStrictEqual(row.updatedAt, context.lockedRow?.updatedAt))) throw invalid()
      const updatedAt = nextVersion(row?.updatedAt)
      const parsed = schema.safeParse(context.values)
      if (!parsed.success) throw invalid()
      const values = structuredClone(parsed.data)
      const changed = row
        ? context.em.assign(row, { ...values, updatedAt })
        : context.em.create(entity, { ...scopeOf(context), ...values, updatedAt }, { persist: true, partial: true })
      return { before, after: ownedValues(changed), tableAfterUpdatedAt: updatedAt.toISOString(),
        tableBeforeUpdatedAt: context.lockedRow ? new Date(context.lockedRow.updatedAt!).toISOString() : null }
    },
    async onHostDeleted(context) {
      const row = await read(context, true)
      const before = row ? ownedValues(row) : null
      if (row) context.em.remove(row)
      return { before, after: null, tableAfterUpdatedAt: null, tableBeforeUpdatedAt: row?.updatedAt.toISOString() ?? null }
    },
    async undo(context) {
      const { snapshot } = context
      const row = await read(context, true)
      const expected = snapshot.tableAfterUpdatedAt
      const beforeVersion = snapshot.tableBeforeUpdatedAt
      if (expected === undefined || beforeVersion === undefined
          || (expected === null) !== (snapshot.after === null)
          || (beforeVersion === null) !== (snapshot.before === null)) throw invalid()
      const version = { expected, resourceId: context.hostResourceId, resourceKind: fact.targetEntityId, envValue: 'all' }
      if (expected && row) {
        assertOptimisticLock({ ...version, current: row.updatedAt })
        if (!isDeepStrictEqual(ownedValues(row), snapshot.after)) throw invalid()
      } else if (expected) enforceRecordGoneIsConflict(version)
      else if (row) throw invalid()
      if (snapshot.before === null) {
        if (row) context.em.remove(row)
        return
      }
      const validated = schema.safeParse(snapshot.before)
      if (!validated.success) throw invalid()
      const updatedAt = nextVersion(row?.updatedAt, beforeVersion ? new Date(beforeVersion) : undefined)
      if (row) context.em.assign(row, { ...validated.data, updatedAt })
      else context.em.create(entity, { ...scopeOf(context), ...validated.data, updatedAt }, { persist: true, partial: true })
    },
  })
}
