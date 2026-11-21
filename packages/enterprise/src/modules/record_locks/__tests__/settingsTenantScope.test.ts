import type { EntityManager } from '@mikro-orm/postgresql'
import { isConflictNotificationEnabled } from '../lib/notificationHelpers'
import { setup } from '../setup'
import { DEFAULT_RECORD_LOCK_SETTINGS } from '../lib/config'

const TENANT_ID = '60000000-0000-4000-8000-000000000001'

type Where = { moduleId: string; name: string; tenantId?: string | null }

function createEm(rows: Array<{ tenantId: string | null; valueJson: unknown }>) {
  const findOne = jest.fn(async (_entity: unknown, where: Where) =>
    rows.find((row) => row.tenantId === where.tenantId) ?? null,
  )
  const em = {
    findOne,
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
  }
  return { em: { ...em, fork: () => em }, findOne }
}

describe('record-lock settings tenant scope outside the service', () => {
  test('conflict notifications read the tenant override first', async () => {
    const { em } = createEm([
      { tenantId: null, valueJson: { ...DEFAULT_RECORD_LOCK_SETTINGS, notifyOnConflict: true } },
      { tenantId: TENANT_ID, valueJson: { ...DEFAULT_RECORD_LOCK_SETTINGS, notifyOnConflict: false } },
      { tenantId: 'other-tenant', valueJson: { ...DEFAULT_RECORD_LOCK_SETTINGS, notifyOnConflict: true } },
    ])
    const ctx = { resolve: <T,>() => em as unknown as T }
    await expect(isConflictNotificationEnabled(ctx, { tenantId: TENANT_ID })).resolves.toBe(false)
  })

  test('conflict notifications fall back to instance settings, never another tenant', async () => {
    const { em, findOne } = createEm([
      { tenantId: 'other-tenant', valueJson: { ...DEFAULT_RECORD_LOCK_SETTINGS, notifyOnConflict: false } },
      { tenantId: null, valueJson: { ...DEFAULT_RECORD_LOCK_SETTINGS, notifyOnConflict: true } },
    ])
    const ctx = { resolve: <T,>() => em as unknown as T }
    await expect(isConflictNotificationEnabled(ctx, { tenantId: TENANT_ID })).resolves.toBe(true)
    expect(findOne).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ tenantId: null }))
  })

  test('tenant creation only seeds the instance row', async () => {
    const tenantRow = { tenantId: 'other-tenant', valueJson: { ...DEFAULT_RECORD_LOCK_SETTINGS, enabledResources: [] } }
    const { em, findOne } = createEm([tenantRow])
    await setup.onTenantCreated?.({ em: em as unknown as EntityManager } as Parameters<NonNullable<typeof setup.onTenantCreated>>[0])
    expect(findOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: null }))
    expect(tenantRow.valueJson.enabledResources).toEqual([])
    expect(em.create).toHaveBeenCalledTimes(1)
  })
})
