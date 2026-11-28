import {
  bindRequestScopeContainer,
  getRequestScopeContainer,
  runInRequestScope,
  runInOwnedRequestScope,
  runWithRequestScopeContainer,
  runWithRequestScopeAcquisition,
  trackRequestScopeDisposal,
  type RequestScopeContainer,
} from '../request-scope'

function makeContainer(label: string): RequestScopeContainer & { label: string } {
  return {
    label,
    resolve: <T = unknown>(name: string): T => `${label}:${name}` as unknown as T,
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('request scope', () => {
  it('has no container and ignores binds outside a scope', () => {
    bindRequestScopeContainer(makeContainer('stray'))
    expect(getRequestScopeContainer()).toBeNull()
  })

  it('exposes the bound container only for the duration of the scope', async () => {
    const container = makeContainer('a')
    const seen = await runInRequestScope(async () => {
      expect(getRequestScopeContainer()).toBeNull()
      bindRequestScopeContainer(container)
      await tick()
      return getRequestScopeContainer()
    })
    expect(seen).toBe(container)
    expect(getRequestScopeContainer()).toBeNull()
  })

  it('keeps the most recently bound container within one scope', () => {
    const first = makeContainer('first')
    const second = makeContainer('second')
    runInRequestScope(() => {
      bindRequestScopeContainer(first)
      bindRequestScopeContainer(second)
      expect(getRequestScopeContainer()).toBe(second)
    })
  })

  it('isolates a nested scope from its parent', () => {
    const outer = makeContainer('outer')
    const inner = makeContainer('inner')
    runInRequestScope(() => {
      bindRequestScopeContainer(outer)
      runInRequestScope(() => {
        expect(getRequestScopeContainer()).toBeNull()
        bindRequestScopeContainer(inner)
        expect(getRequestScopeContainer()).toBe(inner)
      })
      expect(getRequestScopeContainer()).toBe(outer)
    })
  })

  it('keeps interleaved concurrent scopes on their own containers', async () => {
    const containerA = makeContainer('a')
    const containerB = makeContainer('b')
    const runScope = (container: RequestScopeContainer, delayTicks: number) =>
      runInRequestScope(async () => {
        bindRequestScopeContainer(container)
        for (let index = 0; index < delayTicks; index += 1) await tick()
        return getRequestScopeContainer()
      })
    const [seenA, seenB] = await Promise.all([runScope(containerA, 3), runScope(containerB, 1)])
    expect(seenA).toBe(containerA)
    expect(seenB).toBe(containerB)
  })
})


describe('owned request scope', () => {
  it('collects pinned helper scopes and cleans nested resources before their parent', async () => {
    const { asFunction, createContainer } = await import('awilix')
    const disposed: string[] = []
    const caller = createContainer().register({ parent: asFunction(() => ({})).scoped().disposer(() => { disposed.push('parent') }) })
    await runInOwnedRequestScope(async () => {
      bindRequestScopeContainer(caller)
      caller.resolve('parent')
      const nested = caller.createScope().register({ child: asFunction(() => ({})).scoped().disposer(() => { disposed.push('child') }) })
      nested.resolve('child')
      await runWithRequestScopeContainer(caller, async () => {
        const helper = { ...makeContainer('helper'), dispose: async () => { disposed.push('helper') } }
        bindRequestScopeContainer(helper)
        expect(getRequestScopeContainer()).toBe(caller)
      })
    })
    expect(disposed).toEqual(['helper', 'child', 'parent'])
  })

  it('does not acquire ownership of scopes created by independent background work', async () => {
    const dispose = jest.fn(async () => {})
    await runInOwnedRequestScope(async () => {
      await runInRequestScope(async () => bindRequestScopeContainer({ ...makeContainer('background'), dispose }))
    })
    expect(dispose).not.toHaveBeenCalled()
    await dispose()
  })

  it('waits for an in-flight acquisition to finish initialization before cleanup', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const dispose = jest.fn(async () => {})
    let initialized = false
    const boundary = runInOwnedRequestScope(() => {
      void runWithRequestScopeAcquisition(async () => {
        const scope = { ...makeContainer('initializing'), dispose }
        trackRequestScopeDisposal(scope)
        await blocked
        expect(dispose).not.toHaveBeenCalled()
        initialized = true
        return scope
      })
      return 'result'
    })
    await tick()
    expect(dispose).not.toHaveBeenCalled()
    release()
    expect(await boundary).toBe('result')
    expect(initialized).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('preserves handler outcomes when cleanup fails', async () => {
    const setup = () => bindRequestScopeContainer({ ...makeContainer('failure'), dispose: async () => { throw new Error('[internal] cleanup failed') } })
    expect(await runInOwnedRequestScope(() => { setup(); return 'success' })).toBe('success')
    const failure = new Error('[internal] handler failed')
    await expect(runInOwnedRequestScope(() => { setup(); throw failure })).rejects.toBe(failure)
  })
})


it('awaits the same cleanup when stream cancellation races with a pending read', async () => {
  let release!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const dispose = jest.fn(async () => blocked)
  const response = await runInOwnedRequestScope(() => {
    bindRequestScopeContainer({ ...makeContainer('stream'), dispose })
    return new Response(new ReadableStream<Uint8Array>({}, { highWaterMark: 0 }))
  })
  const reader = response.body!.getReader()
  const reading = reader.read()
  let completed = false
  const cancelling = reader.cancel().then(() => { completed = true })
  await tick()
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(completed).toBe(false)
  release()
  await Promise.all([reading, cancelling])
  expect(completed).toBe(true)
  expect(dispose).toHaveBeenCalledTimes(1)
})


it('keeps scopes alive until asynchronous source cancellation finishes despite pending read EOF', async () => {
  let release!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const dispose = jest.fn(async () => {})
  const cancelled = jest.fn(async () => {
    await blocked
    expect(dispose).not.toHaveBeenCalled()
  })
  const response = await runInOwnedRequestScope(() => {
    bindRequestScopeContainer({ ...makeContainer('stream'), dispose })
    return new Response(new ReadableStream<Uint8Array>({ cancel: cancelled }, { highWaterMark: 0 }))
  })
  const reader = response.body!.getReader()
  const reading = reader.read()
  await tick()
  const cancelling = reader.cancel()
  await tick()
  expect(cancelled).toHaveBeenCalledTimes(1)
  expect(dispose).not.toHaveBeenCalled()
  release()
  await Promise.all([reading, cancelling])
  expect(dispose).toHaveBeenCalledTimes(1)
})
