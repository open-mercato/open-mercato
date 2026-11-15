import {
  bindRequestScopeContainer,
  getRequestScopeContainer,
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
