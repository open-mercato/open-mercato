import {
  bindRequestScopeContainer,
  endRequestContainerSharing,
  getRequestScopeContainer,
  getRequestScopeStats,
  isRequestContainerMemoEnabled,
  noteRequestContainerBuilt,
  noteRequestContainerRequested,
  resolveSharedRequestRoot,
  runInRequestScope,
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

describe('request scope container sharing', () => {
  const ORIGINAL_MEMO = process.env.OM_REQUEST_CONTAINER_MEMO

  afterEach(() => {
    if (ORIGINAL_MEMO === undefined) delete process.env.OM_REQUEST_CONTAINER_MEMO
    else process.env.OM_REQUEST_CONTAINER_MEMO = ORIGINAL_MEMO
  })

  it('reads OM_REQUEST_CONTAINER_MEMO with a default of off', () => {
    delete process.env.OM_REQUEST_CONTAINER_MEMO
    expect(isRequestContainerMemoEnabled()).toBe(false)
    process.env.OM_REQUEST_CONTAINER_MEMO = 'on'
    expect(isRequestContainerMemoEnabled()).toBe(true)
    process.env.OM_REQUEST_CONTAINER_MEMO = 'false'
    expect(isRequestContainerMemoEnabled()).toBe(false)
  })

  it('offers no shared root outside a scope or in a scope that does not share', () => {
    const build = jest.fn(async () => makeContainer('root'))
    expect(resolveSharedRequestRoot(build)).toBeNull()
    runInRequestScope(() => {
      expect(resolveSharedRequestRoot(build)).toBeNull()
    })
    expect(build).not.toHaveBeenCalled()
  })

  it('builds the shared root once per scope and never across scopes', async () => {
    const build = jest.fn(async () => makeContainer(`root-${build.mock.calls.length}`))
    const runScope = () =>
      runInRequestScope(async () => {
        const first = resolveSharedRequestRoot(build)
        await tick()
        const second = resolveSharedRequestRoot(build)
        expect(second).toBe(first)
        return first
      }, { shareContainer: true })
    const [rootA, rootB] = await Promise.all([runScope(), runScope()])
    expect(rootA).not.toBe(rootB)
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('forgets a failed shared build and stops sharing once ended', async () => {
    await runInRequestScope(async () => {
      const failing = resolveSharedRequestRoot(async () => {
        throw new Error('[internal] build failed')
      })
      await expect(failing).rejects.toThrow('build failed')
      const retried = resolveSharedRequestRoot(async () => makeContainer('retry'))
      expect(retried).not.toBe(failing)
      await expect(retried).resolves.toMatchObject({ label: 'retry' })

      endRequestContainerSharing()
      expect(resolveSharedRequestRoot(async () => makeContainer('late'))).toBeNull()
      expect(getRequestScopeStats()).toMatchObject({ shareContainer: false })
    }, { shareContainer: true })
  })

  it('keeps container counters per scope', async () => {
    const counts = await Promise.all([2, 5].map((calls) =>
      runInRequestScope(async () => {
        for (let index = 0; index < calls; index += 1) {
          noteRequestContainerRequested()
          await tick()
        }
        noteRequestContainerBuilt()
        return getRequestScopeStats()
      })))
    expect(counts).toEqual([
      { shareContainer: false, containersBuilt: 1, containersRequested: 2 },
      { shareContainer: false, containersBuilt: 1, containersRequested: 5 },
    ])
    expect(getRequestScopeStats()).toBeNull()
  })
})
