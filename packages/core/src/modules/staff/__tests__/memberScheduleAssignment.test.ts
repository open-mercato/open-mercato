import {
  updateMemberScheduleAssignment,
  type OptimisticVersionStore,
} from '../lib/memberScheduleAssignment'

function makeStore(initial: string | null): OptimisticVersionStore & { value: () => string | null } {
  let current = initial
  return {
    get: () => current,
    set: (next) => {
      current = next
    },
    value: () => current,
  }
}

describe('updateMemberScheduleAssignment', () => {
  it('sends the currently-known version and refreshes it from the server after success', async () => {
    const store = makeStore('T0')
    const sent: (string | null)[] = []
    await updateMemberScheduleAssignment({
      versionStore: store,
      applyAssignment: async (expected) => {
        sent.push(expected)
      },
      readCurrentVersion: async () => 'T1',
    })
    expect(sent).toEqual(['T0'])
    expect(store.value()).toBe('T1')
  })

  it('uses the refreshed version on a follow-up write (regression: false 409 on schedule delete #2847)', async () => {
    const store = makeStore('T0')
    const sent: (string | null)[] = []
    const serverVersions = ['T1', 'T2']
    let writes = 0
    const run = () =>
      updateMemberScheduleAssignment({
        versionStore: store,
        applyAssignment: async (expected) => {
          sent.push(expected)
          writes += 1
        },
        readCurrentVersion: async () => serverVersions[writes - 1] ?? null,
      })
    // 1) user selects a schedule -> bumps the member version server-side
    await run()
    // 2) deleting the schedule clears the assignment -> must NOT reuse stale 'T0'
    await run()
    expect(sent).toEqual(['T0', 'T1'])
    expect(store.value()).toBe('T2')
  })

  it('keeps the last-known version when the refresh read fails', async () => {
    const store = makeStore('T0')
    await updateMemberScheduleAssignment({
      versionStore: store,
      applyAssignment: async () => {},
      readCurrentVersion: async () => {
        throw new Error('network')
      },
    })
    expect(store.value()).toBe('T0')
  })

  it('propagates a write error and does not refresh on a genuine conflict', async () => {
    const store = makeStore('T0')
    let refreshed = false
    await expect(
      updateMemberScheduleAssignment({
        versionStore: store,
        applyAssignment: async () => {
          throw new Error('409')
        },
        readCurrentVersion: async () => {
          refreshed = true
          return 'T1'
        },
      }),
    ).rejects.toThrow('409')
    expect(refreshed).toBe(false)
    expect(store.value()).toBe('T0')
  })
})
