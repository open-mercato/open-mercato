import { createScopedEventBusFactory } from '../bus'
import type { CreateBusOptions } from '../types'

function resolver(services: Record<string, unknown>): CreateBusOptions['resolve'] {
  return <Service>(name: string) => services[name] as Service
}

it('shares definitions while retaining the exact caller through interleaved delivery', async () => {
  const createBus = createScopedEventBusFactory({ queueStrategy: 'local' })
  const first = createBus(resolver({ em: 'first-em', auth: 'first-user' }))
  const second = createBus(resolver({ em: 'second-em', auth: 'second-user' }))
  let releaseFirst = () => {}
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve })
  const observed: string[] = []
  createBus.definitions.on('probe.created', async (payload, context) => {
    if (payload === 'first') await firstBlocked
    observed.push(`${context.resolve('em')}:${context.resolve('auth')}`)
  })
  const firstDelivery = first.emit('probe.created', 'first')
  await second.emit('probe.created', 'second')
  releaseFirst()
  await firstDelivery
  expect(observed).toEqual(['second-em:second-user', 'first-em:first-user'])
})

it('does not multiply listeners when creating caller facades and respects an explicit worker resolver', async () => {
  const createBus = createScopedEventBusFactory()
  const definitionBus = createBus.definitions
  const seen: string[] = []
  definitionBus.on('probe.*', (_payload, context) => { seen.push(context.resolve('em')) }, { persistent: true })
  for (let index = 0; index < 20; index += 1) createBus(resolver({ em: `caller-${index}` }))
  const caller = createBus(resolver({ em: 'caller' }))
  await caller.dispatchQueued!('probe.created', {}, undefined, resolver({ em: 'worker' }))
  expect(seen).toEqual(['worker'])
})

it('a replacement generation drops old subscribers including an empty replacement', async () => {
  const createOldBus = createScopedEventBusFactory()
  const oldBus = createOldBus(resolver({}))
  const handler = jest.fn()
  oldBus.on('probe.created', handler)
  const newBus = createScopedEventBusFactory()(resolver({}))
  await newBus.emit('probe.created', {})
  expect(handler).not.toHaveBeenCalled()
  await oldBus.emit('probe.created', {})
  expect(handler).toHaveBeenCalledTimes(1)
})


it('keeps runtime subscriptions local while sharing generation definitions', async () => {
  const createBus = createScopedEventBusFactory()
  const shared = jest.fn()
  createBus.definitions.on('probe.created', shared)
  const first = createBus(resolver({ em: 'first' }))
  const second = createBus(resolver({ em: 'second' }))
  const firstOnly = jest.fn()
  first.on('probe.created', firstOnly)
  await second.emit('probe.created', {})
  expect(shared).toHaveBeenCalledTimes(1)
  expect(firstOnly).not.toHaveBeenCalled()
  await first.emit('probe.created', {})
  expect(shared).toHaveBeenCalledTimes(2)
  expect(firstOnly).toHaveBeenCalledTimes(1)
})
