import { LEASE_IDLE_TIMEOUT_MS, createState, reapIdleLeases, type Lease } from '../dispatch'

function fakeLease(touchedAt: number, onClose: () => void): Lease {
  return {
    touchedAt,
    context: {
      newPage: async () => ({}),
      close: async () => {
        onClose()
      },
    },
    page: {
      goto: async () => undefined,
      content: async () => '',
      url: () => 'https://example.com',
      close: async () => undefined,
    },
  } as unknown as Lease
}

describe('lease reaping', () => {
  it('closes a lease nobody released', async () => {
    // `release` normally closes the context, but a caller can die between render
    // and release — and every orphan is a live BrowserContext holding memory for
    // as long as the sidecar runs.
    let closed = 0
    const clock = { value: 1_000_000 }
    const state = createState({ now: () => clock.value, warn: () => {} })
    state.leases.set('orphan', fakeLease(clock.value, () => (closed += 1)))

    clock.value += LEASE_IDLE_TIMEOUT_MS + 1
    await reapIdleLeases(state)

    expect(closed).toBe(1)
    expect(state.leases.size).toBe(0)
  })

  it('leaves a lease that is still in use alone', async () => {
    let closed = 0
    const clock = { value: 1_000_000 }
    const state = createState({ now: () => clock.value, warn: () => {} })
    state.leases.set('active', fakeLease(clock.value, () => (closed += 1)))

    clock.value += LEASE_IDLE_TIMEOUT_MS - 1_000
    await reapIdleLeases(state)

    expect(closed).toBe(0)
    expect(state.leases.size).toBe(1)
  })
})
