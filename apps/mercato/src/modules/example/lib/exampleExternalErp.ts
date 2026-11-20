import { createHash } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CrudFormSectionOutboxDelivery } from '@open-mercato/shared/lib/crud/form-sections/outbox'

export const EXAMPLE_TODO_ERP = 'exampleExternalErp' as const

type ErpDelivery = Required<Pick<CrudFormSectionOutboxDelivery, 'deliver' | 'validateExternal'>>
type DeliveryInput = Parameters<ErpDelivery['deliver']>[0]
type ValidationInput = Parameters<ErpDelivery['validateExternal']>[0]
type ExampleErpOptions = {
  beforeValidate?: (input: ValidationInput) => Promise<void> | void
  beforeDeliver?: (input: DeliveryInput) => Promise<void> | void
  rejectDelivery?: (input: DeliveryInput) => boolean
}
type ErpRecord = { revision: bigint; idempotencyKey: string; externalId?: string }

export function createExampleExternalErp(options: ExampleErpOptions = {}): ErpDelivery {
  const records = new Map<string, ErpRecord>()
  const failedOnce = new Set<string>()
  return {
    async validateExternal(input) {
      const { values, signal } = input
      await options.beforeValidate?.(input)
      signal.throwIfAborted()
      if (values.erpSupplierRef === 'timeout') await wait(10_000, undefined, { signal })
      if (values.erpSupplierRef === 'invalid') {
        return { fieldErrors: { 'extensions.example.erpSupplierRef': 'example.todoShowcase.errors.supplier' } }
      }
    },
    async deliver(input) {
      const { scope, sinkId, hostResourceId, operation, values, revision, idempotencyKey, signal } = input
      await options.beforeDeliver?.(input)
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
      if (options.rejectDelivery?.(input)) return { status: 'rejected' }
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

async function withExampleExternalErp<Result>(signal: AbortSignal, run: (erp: ErpDelivery) => Promise<Result>) {
  signal.throwIfAborted()
  const container = await createRequestContainer()
  try {
    signal.throwIfAborted()
    return await run(container.resolve<ErpDelivery>(EXAMPLE_TODO_ERP))
  } finally {
    await container.dispose()
  }
}

export const exampleExternalErpDelivery: ErpDelivery = {
  deliver: (input) => withExampleExternalErp(input.signal, (erp) => erp.deliver(input)),
  validateExternal: (input) => withExampleExternalErp(input.signal, (erp) => erp.validateExternal(input)),
}
