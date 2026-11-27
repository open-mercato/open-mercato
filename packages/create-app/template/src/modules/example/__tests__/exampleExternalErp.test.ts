import { createExampleExternalErp } from '../lib/exampleExternalErp'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { resolve, promise }
}

const scope = { tenantId: 'test-tenant', organizationId: 'test-org' }
const provider = {
  scope,
  credentials: {},
  signal: new AbortController().signal,
  fetch: jest.fn(async () => { throw new Error('The fixture is offline') }),
  resolveHost: jest.fn(async () => { throw new Error('The fixture is offline') }),
}
const input = {
  ...provider,
  hostResourceId: 'test-todo',
  sinkId: 'example:todo_erp_link',
  values: { erpSupplierRef: 'supplier' },
  operation: 'upsert' as const,
}

it('fences a delayed revision, recognizes duplicates, and keeps a delete tombstone', async () => {
  const entered = deferred()
  const release = deferred()
  const client = createExampleExternalErp({
    async beforeDeliver({ revision }) {
      if (revision === '1') { entered.resolve(); await release.promise }
    },
  })
  const first = client.deliver({ ...input, revision: '1', idempotencyKey: 'intent-1' })
  await entered.promise
  try {
    const current = { ...input, revision: '2', idempotencyKey: 'intent-2' }
    await expect(client.deliver(current)).resolves.toMatchObject({ status: 'applied' })
    await expect(client.deliver(current)).resolves.toMatchObject({ status: 'identical' })
    await expect(client.deliver({ ...input, revision: '3', idempotencyKey: 'intent-3', operation: 'delete', values: null }))
      .resolves.toEqual({ status: 'applied' })
  } finally {
    release.resolve()
  }
  await expect(first).resolves.toEqual({ status: 'stale', currentRevision: '3' })
  expect(provider.fetch).not.toHaveBeenCalled()
})

it('offers injection points for scope-independent failures and stops cancelled prevalidation', async () => {
  const validation = jest.fn()
  const client = createExampleExternalErp({ beforeValidate: validation, rejectDelivery: () => true })
  const controller = new AbortController()
  controller.abort()
  await expect(client.validateExternal({ ...provider, signal: controller.signal, values: {} })).rejects.toMatchObject({ name: 'AbortError' })
  await expect(client.deliver({ ...input, revision: '1', idempotencyKey: 'test' })).resolves.toEqual({ status: 'rejected' })
  expect(validation).toHaveBeenCalledTimes(1)
})

it('exhausts three transient attempts and accepts a retry of the same fenced intent', async () => {
  const client = createExampleExternalErp()
  const delivery = { ...input, revision: '1', idempotencyKey: 'retry-intent', values: { erpSupplierRef: 'retry' } }
  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(client.deliver(delivery)).rejects.toThrow('Offline ERP is temporarily unavailable')
  }
  const accepted = await client.deliver(delivery)
  expect(accepted).toMatchObject({ status: 'applied' })
  await expect(client.deliver(delivery)).resolves.toEqual({ ...accepted, status: 'identical' })
})
