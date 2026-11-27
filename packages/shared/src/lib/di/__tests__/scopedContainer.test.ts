/** @jest-environment node */
import { asValue } from 'awilix'
import { buildScopedContainerFromResolve } from '../scopedContainer'

describe('buildScopedContainerFromResolve', () => {
  it('falls through to the given resolve function for keys never registered', () => {
    const resolve = jest.fn((name: string) => (name === 'em' ? 'the-em' : undefined))
    const container = buildScopedContainerFromResolve(resolve as never)

    expect(container.resolve('em')).toBe('the-em')
    expect(resolve).toHaveBeenCalledWith('em')
  })

  it('register() with an asValue resolver shadows resolve() with the unwrapped value, never the resolver object', () => {
    const resolve = jest.fn()
    const container = buildScopedContainerFromResolve(resolve as never)

    container.register({ auth: asValue({ tenantId: 't1', orgId: 'o1' }) })

    expect(container.resolve('auth')).toEqual({ tenantId: 't1', orgId: 'o1' })
    // The override short-circuits before ever reaching the fallback resolver.
    expect(resolve).not.toHaveBeenCalled()
  })

  it('register() with a plain (non-resolver) value stores it as-is', () => {
    const resolve = jest.fn()
    const container = buildScopedContainerFromResolve(resolve as never)

    container.register({ probe: 'plain-value' })

    expect(container.resolve('probe')).toBe('plain-value')
  })

  it('a later register() for the same key overrides the earlier one', () => {
    const resolve = jest.fn()
    const container = buildScopedContainerFromResolve(resolve as never)

    container.register({ auth: asValue('first') })
    container.register({ auth: asValue('second') })

    expect(container.resolve('auth')).toBe('second')
  })

  it('an unregistered key still falls through even after other keys were registered', () => {
    const resolve = jest.fn((name: string) => (name === 'commandBus' ? 'the-bus' : undefined))
    const container = buildScopedContainerFromResolve(resolve as never)

    container.register({ auth: asValue('trusted') })

    expect(container.resolve('commandBus')).toBe('the-bus')
    expect(container.resolve('auth')).toBe('trusted')
  })
})
