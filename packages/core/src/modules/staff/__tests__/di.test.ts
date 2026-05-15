/** @jest-environment node */

import { createContainer, InjectionMode } from 'awilix'
import { register } from '../di'

describe('staff/di — availabilityAccessResolver registration', () => {
  it('registers the availabilityAccessResolver token with a resolveAvailabilityWriteAccess method', () => {
    const container = createContainer({ injectionMode: InjectionMode.PROXY })
    register(container)
    expect(container.hasRegistration('availabilityAccessResolver')).toBe(true)
    const resolver = container.resolve<{
      resolveAvailabilityWriteAccess: unknown
    }>('availabilityAccessResolver')
    expect(typeof resolver.resolveAvailabilityWriteAccess).toBe('function')
  })

  it('returns undefined (not throws) when consumer uses allowUnregistered on a container without staff', () => {
    const container = createContainer({ injectionMode: InjectionMode.PROXY })
    const resolver = container.resolve('availabilityAccessResolver', {
      allowUnregistered: true,
    })
    expect(resolver).toBeUndefined()
  })
})
