/** @jest-environment node */
import { resolveSeedLoadScope } from '../cli'

type ExecuteCall = { sql: string; params?: unknown[] }

function createEm(rows: Array<Array<Record<string, unknown>>>) {
  const calls: ExecuteCall[] = []
  const execute = jest.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params })
    return rows.shift() ?? []
  })
  const em = {
    getConnection: () => ({ execute }),
  }
  return { em: em as Parameters<typeof resolveSeedLoadScope>[0], execute, calls }
}

describe('seeds CLI load scope auto-detection', () => {
  it('keeps explicit tenant and organization without querying', async () => {
    const { em, execute } = createEm([])

    await expect(
      resolveSeedLoadScope(em, { tenantId: 'tenant-1', organizationId: 'org-1' }),
    ).resolves.toEqual({ tenantId: 'tenant-1', organizationId: 'org-1', inferred: false })
    expect(execute).not.toHaveBeenCalled()
  })

  it('infers the only active tenant and organization', async () => {
    const { em } = createEm([[{ id: 'tenant-1' }], [{ id: 'org-1' }]])

    await expect(resolveSeedLoadScope(em, {})).resolves.toEqual({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      inferred: true,
    })
  })

  it('infers the only organization for an explicit tenant', async () => {
    const { em, calls } = createEm([[{ id: 'org-1' }]])

    await expect(resolveSeedLoadScope(em, { tenantId: 'tenant-1' })).resolves.toEqual({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      inferred: true,
    })
    expect(calls[0]?.params).toEqual(['tenant-1'])
  })

  it('infers tenant from an explicit organization', async () => {
    const { em } = createEm([[{ id: 'org-1', tenant_id: 'tenant-1' }]])

    await expect(resolveSeedLoadScope(em, { organizationId: 'org-1' })).resolves.toEqual({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      inferred: true,
    })
  })

  it('fails closed when tenant detection is ambiguous', async () => {
    const { em } = createEm([[{ id: 'tenant-1' }, { id: 'tenant-2' }]])

    await expect(resolveSeedLoadScope(em, {})).rejects.toThrow(
      'Cannot auto-detect tenant: found multiple active tenants.',
    )
  })

  it('fails closed when organization detection is ambiguous', async () => {
    const { em } = createEm([[{ id: 'org-1' }, { id: 'org-2' }]])

    await expect(resolveSeedLoadScope(em, { tenantId: 'tenant-1' })).rejects.toThrow(
      'Cannot auto-detect organization: found multiple active organizations.',
    )
  })
})
