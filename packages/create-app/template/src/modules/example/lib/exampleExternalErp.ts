import { createHash } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import type { CrudFormSectionOutboxDelivery } from '@open-mercato/shared/lib/crud/form-sections/outbox'

type ErpDelivery = Pick<CrudFormSectionOutboxDelivery, 'deliver' | 'validateExternal'>
type ErpRecord = { revision: bigint; idempotencyKey: string; externalId?: string }

export function createExampleExternalErp(): ErpDelivery {
  const records = new Map<string, ErpRecord>()
  const failedOnce = new Set<string>()
  return {
    async validateExternal({ values, signal }) {
      if (values.erpSupplierRef === 'timeout') await wait(10_000, undefined, { signal })
      if (values.erpSupplierRef === 'invalid') {
        return { fieldErrors: { erpSupplierRef: 'example.todoShowcase.errors.supplier' } }
      }
    },
    async deliver({ scope, sinkId, hostResourceId, operation, values, revision, idempotencyKey, signal }) {
      signal.throwIfAborted()
      const key = JSON.stringify([scope.tenantId, scope.organizationId, sinkId, hostResourceId])
      if (values?.erpSupplierRef === 'slow') await wait(300, undefined, { signal })
      const current = records.get(key)
      const nextRevision = BigInt(revision)
      if (current && nextRevision < current.revision) {
        return { status: 'stale', currentRevision: String(current.revision) }
      }
      if (current && nextRevision === current.revision) {
        return current.idempotencyKey === idempotencyKey
          ? { status: 'identical', ...(current.externalId ? { externalId: current.externalId } : {}) }
          : { status: 'rejected' }
      }
      if (values?.erpSupplierRef === 'retry' && !failedOnce.has(idempotencyKey)) {
        failedOnce.add(idempotencyKey)
        return { status: 'rejected' }
      }
      const externalId = operation === 'delete' ? undefined : createHash('sha256').update(key).digest('hex')
      records.set(key, { revision: nextRevision, idempotencyKey, externalId })
      return { status: 'applied', ...(externalId ? { externalId } : {}) }
    },
  }
}

export const exampleExternalErp = createExampleExternalErp()
