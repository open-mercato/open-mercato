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

function callerContainer(services: Record<string, unknown>) {
  const registrations = new Map<string, unknown>(Object.entries(services))
  return {
    resolve: <Service>(name: string) => registrations.get(name) as Service,
    register: (entries: Record<string, unknown>) => {
      for (const [name, value] of Object.entries(entries)) registrations.set(name, value)
    },
  }
}

it('hands each inline subscriber the container of the caller that resolved the bus, never the bootstrap one', async () => {
  const createBus = createScopedEventBusFactory({ queueStrategy: 'local' })
  const firstCaller = callerContainer({ auth: 'first-user' })
  const secondCaller = callerContainer({ auth: 'second-user' })
  const first = createBus(firstCaller.resolve, firstCaller)
  const second = createBus(secondCaller.resolve, secondCaller)
  const seen: unknown[] = []
  createBus.definitions.on('probe.created', (_payload, context) => {
    seen.push(context.container)
    context.container?.register({ auth: `override-from-${context.resolve('auth')}` })
  })

  await first.emit('probe.created', {})
  await second.emit('probe.created', {})

  expect(seen).toEqual([firstCaller, secondCaller])
  expect(firstCaller.resolve('auth')).toBe('override-from-first-user')
  expect(secondCaller.resolve('auth')).toBe('override-from-second-user')
})

it('leaves ctx.container unset for a caller bus built without a container', async () => {
  const createBus = createScopedEventBusFactory({ queueStrategy: 'local' })
  const bus = createBus(resolver({ auth: 'user' }))
  let seen: unknown = 'not-called'
  createBus.definitions.on('probe.created', (_payload, context) => { seen = context.container })
  await bus.emit('probe.created', {})
  expect(seen).toBeUndefined()
})

it('shares queued registration changes across concurrent subscribers but not other jobs', async () => {
  const createBus = createScopedEventBusFactory({ queueStrategy: 'local' })
  const busContainer = callerContainer({ probe: 'bus' })
  const firstJob = callerContainer({ probe: 'first-job' })
  const secondJob = callerContainer({ probe: 'second-job' })
  const bus = createBus(busContainer.resolve, busContainer)
  const observed: string[] = []
  const containers: unknown[] = []
  let markReaderStarted = () => {}
  let releaseReader = () => {}
  const readerStarted = new Promise<void>((resolve) => { markReaderStarted = resolve })
  const readerBlocked = new Promise<void>((resolve) => { releaseReader = resolve })

  createBus.definitions.on('probe.created', async (payload, context) => {
    containers.push(context.container)
    observed.push(context.resolve('probe'))
    if (payload === 'first-job') {
      markReaderStarted()
      await readerBlocked
      observed.push(context.resolve('probe'))
    }
  }, { persistent: true, id: 'reader' })
  createBus.definitions.on('probe.created', async (payload, context) => {
    containers.push(context.container)
    if (payload === 'first-job') {
      await readerStarted
      context.container?.register({ probe: 'shared-with-first-job' })
      releaseReader()
    }
  }, { persistent: true, id: 'writer' })

  const firstResults = await bus.dispatchQueued!('probe.created', 'first-job', undefined, firstJob.resolve, firstJob)
  const secondResults = await bus.dispatchQueued!('probe.created', 'second-job', undefined, secondJob.resolve, secondJob)

  expect(firstResults.every((result) => result.ok)).toBe(true)
  expect(secondResults.every((result) => result.ok)).toBe(true)
  expect(containers).toEqual([firstJob, firstJob, secondJob, secondJob])
  expect(observed).toEqual(['first-job', 'shared-with-first-job', 'second-job'])
  expect(firstJob.resolve('probe')).toBe('shared-with-first-job')
  expect(secondJob.resolve('probe')).toBe('second-job')
  expect(busContainer.resolve('probe')).toBe('bus')
})
