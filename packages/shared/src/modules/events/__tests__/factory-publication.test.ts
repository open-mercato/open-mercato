import { createModuleEvents, setGlobalEventBus } from '../factory'

it('forwards optional publication identity/deadline and trusted scope without changing old emitter defaults', async () => {
  const emit = jest.fn(async () => undefined)
  setGlobalEventBus({ emit })
  const moduleEvents = createModuleEvents({ moduleId: 'publication_test', events: [
    { id: 'publication_test.receipt.received', label: 'Receipt received' },
  ] as const })
  const payload = { id: 'receipt-one', tenantId: 'payload-tenant' }
  const options = { persistent: true, tenantId: 'trusted-tenant', organizationId: 'trusted-org',
    enqueue: { jobId: 'receipt-event-one', timeoutMs: 250 } }
  await moduleEvents.emit('publication_test.receipt.received', payload, options)
  expect(emit).toHaveBeenLastCalledWith('publication_test.receipt.received', payload, options)
  await moduleEvents.emit('publication_test.receipt.received', payload)
  expect(emit).toHaveBeenLastCalledWith('publication_test.receipt.received', payload, undefined)
})
