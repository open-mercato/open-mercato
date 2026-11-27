import { asValue, createContainer } from 'awilix'
import { getProcessDiRegistrar, runCallerSetups } from '@open-mercato/shared/lib/di/process-registrar'
import { applicationLifecycleEvents } from '@open-mercato/shared/lib/runtime/events'

jest.mock('@open-mercato/core/bootstrap', () => ({ bootstrap: jest.fn(async () => undefined) }))
jest.mock('@/.mercato/generated/web-research-adapters.generated', () => ({
  webResearchAdapterEntries: [{ id: 'test-adapter' }],
}), { virtual: true })

import { register } from '../di'
import { bootstrap } from '@open-mercato/core/bootstrap'

const lifecycleKeys = [
  '__openMercatoApplicationBootstrapStartedEventEmitted__',
  '__openMercatoApplicationBootstrapCompletedEventEmitted__',
  '__openMercatoApplicationBootstrapFailedEventEmitted__',
]

beforeEach(() => {
  for (const key of lifecycleKeys) delete (globalThis as Record<string, unknown>)[key]
  jest.mocked(bootstrap).mockClear()
})

afterEach(() => {
  for (const key of lifecycleKeys) delete (globalThis as Record<string, unknown>)[key]
})

it('registers app values without resolving request state or bootstrapping infrastructure', async () => {
  const root = createContainer()
  const resolve = jest.spyOn(root, 'resolve')
  await getProcessDiRegistrar(register)!(root)
  expect(resolve).not.toHaveBeenCalled()
  expect(bootstrap).not.toHaveBeenCalled()
  expect(root.resolve('webResearchAdapterEntries')).toEqual([{ id: 'test-adapter' }])
})

it('emits lifecycle events once through a complete caller, including concurrent first callers', async () => {
  const root = createContainer()
  await getProcessDiRegistrar(register)!(root)
  const first = root.createScope()
  const second = root.createScope()
  const emitFirst = jest.fn(async (_event: string, _payload: unknown) => undefined)
  const emitSecond = jest.fn(async (_event: string, _payload: unknown) => undefined)
  first.register({ eventBus: asValue({ emit: emitFirst }) })
  second.register({ eventBus: asValue({ emit: emitSecond }) })
  await Promise.all([runCallerSetups(root, first), runCallerSetups(root, second)])
  await runCallerSetups(root, second)
  expect(emitFirst.mock.calls.map(([event]) => event)).toEqual([
    applicationLifecycleEvents.bootstrapStarted,
    applicationLifecycleEvents.bootstrapCompleted,
  ])
  expect(emitSecond).not.toHaveBeenCalled()
  expect(bootstrap).not.toHaveBeenCalled()
})

it('preserves the legacy app bootstrap and lifecycle path', async () => {
  const caller = createContainer()
  const emit = jest.fn(async (_event: string, _payload: unknown) => undefined)
  caller.register({ eventBus: asValue({ emit }) })
  await register(caller)
  expect(emit.mock.calls.map(([event]) => event)).toEqual([
    applicationLifecycleEvents.bootstrapStarted,
    applicationLifecycleEvents.bootstrapCompleted,
  ])
  expect(caller.resolve('webResearchAdapterEntries')).toEqual([{ id: 'test-adapter' }])
})
