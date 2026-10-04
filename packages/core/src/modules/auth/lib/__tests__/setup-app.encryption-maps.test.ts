/** @jest-environment node */

import {
  invalidateSetupEncryptionMaps,
  upsertSetupEncryptionMaps,
} from '@open-mercato/core/modules/auth/lib/setup-app'

describe('tenant setup encryption-map materialization', () => {
  it('uses conflict-safe upserts for concurrent bootstrap attempts and skips system maps', async () => {
    const rows = new Map<string, { id: string; updated_at: Date }>()
    let arrivals = 0
    let release: (() => void) | undefined
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve
    })
    const execute = jest.fn(async (_sql: string, params: readonly unknown[]) => {
      arrivals += 1
      if (arrivals === 2) release?.()
      await bothArrived
      const key = `${String(params[0])}:${String(params[1])}:${String(params[2])}`
      const saved = rows.get(key) ?? { id: 'canonical-map', updated_at: new Date() }
      rows.set(key, saved)
      return [saved]
    })
    const em = { getConnection: () => ({ execute }) } as never
    const specs = [
      { entityId: 'auth:user', fields: [{ field: 'email', hashField: 'email_hash' }] },
      { entityId: 'onboarding:request', keyScope: 'system' as const, fields: [{ field: 'email' }] },
    ]

    const results = await Promise.all([
      upsertSetupEncryptionMaps(em, 'tenant-1', 'org-1', specs),
      upsertSetupEncryptionMaps(em, 'tenant-1', 'org-1', specs),
    ])

    expect(rows.size).toBe(1)
    expect(results).toEqual([['auth:user'], ['auth:user']])
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls.every(([sql]) => String(sql).includes('on conflict'))).toBe(true)
    expect(execute.mock.calls.every(([, params]) => params[0] === 'auth:user')).toBe(true)
  })

  it('invalidates every materialized organization map and the auth tenant fallback', async () => {
    const invalidateMap = jest.fn(async () => undefined)

    await invalidateSetupEncryptionMaps(
      { invalidateMap },
      ['auth:user', 'customers:person'],
      'tenant-1',
      'org-1',
    )

    expect(invalidateMap.mock.calls).toEqual([
      ['auth:user', 'tenant-1', 'org-1'],
      ['customers:person', 'tenant-1', 'org-1'],
      ['auth:user', 'tenant-1', null],
    ])
  })
})
