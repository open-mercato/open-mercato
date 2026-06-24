/**
 * @jest-environment jsdom
 *
 * Regression coverage for issue #3320 — the widget injection registry must own
 * a SINGLE browser-level DOM listener and fan out registry-change
 * notifications to every hook subscriber through an internal callback set,
 * instead of registering one `window.addEventListener` per mounted widget
 * surface. Backend pages mount several injection spots at once
 * (`useInjectionWidgets`, `useInjectionSpotEvents`, `useInjectionDataWidgets`),
 * so the listener topology must not scale with the number of subscribers.
 */
import { describe, it, expect, afterEach, jest } from '@jest/globals'
import {
  registerEnabledModuleIds,
  subscribeToInjectionRegistryChanges,
} from '@open-mercato/shared/modules/widgets/injection-loader'

const INJECTION_REGISTRY_CHANGED_EVENT = '__openMercatoInjectionRegistryChanged__'

function countRegistryListenerCalls(
  spy: ReturnType<typeof jest.spyOn>,
): number {
  return spy.mock.calls.filter(([event]) => event === INJECTION_REGISTRY_CHANGED_EVENT).length
}

describe('Injection registry change listeners (#3320)', () => {
  const pendingUnsubscribers: Array<() => void> = []

  afterEach(() => {
    while (pendingUnsubscribers.length) {
      pendingUnsubscribers.pop()?.()
    }
    jest.restoreAllMocks()
  })

  it('registers exactly one shared DOM listener regardless of subscriber count', () => {
    const addSpy = jest.spyOn(window, 'addEventListener')

    pendingUnsubscribers.push(subscribeToInjectionRegistryChanges(() => {}))
    pendingUnsubscribers.push(subscribeToInjectionRegistryChanges(() => {}))
    pendingUnsubscribers.push(subscribeToInjectionRegistryChanges(() => {}))

    expect(countRegistryListenerCalls(addSpy)).toBe(1)
  })

  it('fans out a single registry change to every subscriber', () => {
    let firstCalls = 0
    let secondCalls = 0
    pendingUnsubscribers.push(
      subscribeToInjectionRegistryChanges(() => {
        firstCalls += 1
      }),
    )
    pendingUnsubscribers.push(
      subscribeToInjectionRegistryChanges(() => {
        secondCalls += 1
      }),
    )

    registerEnabledModuleIds(['host'])

    expect(firstCalls).toBe(1)
    expect(secondCalls).toBe(1)
  })

  it('detaches the shared DOM listener only after the last subscriber unsubscribes', () => {
    const removeSpy = jest.spyOn(window, 'removeEventListener')

    const unsubscribeFirst = subscribeToInjectionRegistryChanges(() => {})
    const unsubscribeSecond = subscribeToInjectionRegistryChanges(() => {})

    unsubscribeFirst()
    expect(countRegistryListenerCalls(removeSpy)).toBe(0)

    unsubscribeSecond()
    expect(countRegistryListenerCalls(removeSpy)).toBe(1)
  })

  it('stops notifying a subscriber once it unsubscribes', () => {
    let activeCalls = 0
    let removedCalls = 0
    pendingUnsubscribers.push(
      subscribeToInjectionRegistryChanges(() => {
        activeCalls += 1
      }),
    )
    const unsubscribeRemoved = subscribeToInjectionRegistryChanges(() => {
      removedCalls += 1
    })

    unsubscribeRemoved()
    registerEnabledModuleIds(['host'])

    expect(activeCalls).toBe(1)
    expect(removedCalls).toBe(0)
  })

  it('re-attaches the shared DOM listener after a full unsubscribe cycle', () => {
    const addSpy = jest.spyOn(window, 'addEventListener')

    const unsubscribe = subscribeToInjectionRegistryChanges(() => {})
    expect(countRegistryListenerCalls(addSpy)).toBe(1)
    unsubscribe()

    pendingUnsubscribers.push(subscribeToInjectionRegistryChanges(() => {}))
    expect(countRegistryListenerCalls(addSpy)).toBe(2)
  })
})
