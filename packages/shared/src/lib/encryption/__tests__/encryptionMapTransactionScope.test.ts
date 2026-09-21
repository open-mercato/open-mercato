import { TenantDataEncryptionService } from '../tenantDataEncryptionService'

type ExecuteFn = (
  sql: string,
  params?: readonly unknown[],
  method?: string,
  ctx?: unknown,
) => Promise<unknown>

function makeConnections(serviceExecute: ExecuteFn, scopeExecute: ExecuteFn) {
  const serviceEm = {
    getConnection: () => ({ execute: serviceExecute }),
  }
  const txCtx = { tx: 'caller-transaction' }
  const scopeEm = {
    getConnection: () => ({ execute: scopeExecute }),
    getTransactionContext: () => txCtx,
  }
  return { serviceEm, scopeEm, txCtx }
}

function makeService(serviceExecute: ExecuteFn, scopeExecute: ExecuteFn) {
  const { serviceEm, scopeEm, txCtx } = makeConnections(serviceExecute, scopeExecute)
  const service = new TenantDataEncryptionService(serviceEm as never)
  jest.spyOn(service, 'isEnabled').mockReturnValue(true)
  return { service, scopeEm, txCtx }
}

const mapRow = (fields: Array<{ field: string }>) => ({
  entity_id: 'scope:entity',
  fields_json: fields,
})

describe('encryption map lookups inside a caller transaction (issue #6301)', () => {
  it('runs the map query on the caller transaction instead of the pool connection', async () => {
    const serviceExecute = jest.fn<Promise<unknown>, Parameters<ExecuteFn>>(async () => [])
    const scopeExecute = jest.fn<Promise<unknown>, Parameters<ExecuteFn>>(async () => [
      mapRow([{ field: 'display_name' }]),
    ])
    const { service, scopeEm, txCtx } = makeService(serviceExecute, scopeExecute)

    await expect(
      service.getEncryptedFieldNames('scope:entity:ctx', 't1', 'org1', { em: scopeEm }),
    ).resolves.toEqual(['display_name'])

    expect(scopeExecute).toHaveBeenCalledTimes(1)
    expect(scopeExecute).toHaveBeenCalledWith(
      expect.stringContaining('from encryption_maps'),
      ['scope:entity:ctx', 't1', 'org1'],
      'all',
      txCtx,
    )
    expect(serviceExecute).not.toHaveBeenCalled()
  })

  it('runs the organization-wide field query on the caller transaction', async () => {
    const serviceExecute = jest.fn<Promise<unknown>, Parameters<ExecuteFn>>(async () => [])
    const scopeExecute = jest.fn<Promise<unknown>, Parameters<ExecuteFn>>(
      async (_sql: string, params?: readonly unknown[]) => {
        if ((params?.length ?? 0) === 3) return []
        return [{ fields_json: [{ field: 'display_name' }] }]
      },
    )
    const { service, scopeEm, txCtx } = makeService(serviceExecute, scopeExecute)

    await expect(
      service.getEncryptedFieldNames('scope:entity:orgs', 't1', null, { em: scopeEm }),
    ).resolves.toEqual(['display_name'])

    expect(scopeExecute).toHaveBeenCalledWith(
      expect.stringContaining('organization_id is not null'),
      ['scope:entity:orgs', 't1'],
      'all',
      txCtx,
    )
    expect(serviceExecute).not.toHaveBeenCalled()
  })

  it('does not serve a scoped read from the shared hit cache', async () => {
    let current = [{ field: 'title' }]
    const serviceExecute = jest.fn<Promise<unknown>, Parameters<ExecuteFn>>(async () => [
      mapRow(current),
    ])
    const scopeExecute = jest.fn<Promise<unknown>, Parameters<ExecuteFn>>(async () => [
      mapRow(current),
    ])
    const { service, scopeEm } = makeService(serviceExecute, scopeExecute)

    await expect(
      service.getEncryptedFieldNames('scope:entity:stale', 't1', 'org1'),
    ).resolves.toEqual(['title'])
    expect(serviceExecute).toHaveBeenCalledTimes(1)

    current = [{ field: 'title' }, { field: 'location' }]
    await expect(
      service.getEncryptedFieldNames('scope:entity:stale', 't1', 'org1', { em: scopeEm }),
    ).resolves.toEqual(['title', 'location'])
    expect(scopeExecute).toHaveBeenCalledTimes(1)
  })

  it('does not publish a scoped miss into the shared miss cache', async () => {
    const serviceExecute = jest.fn<Promise<unknown>, Parameters<ExecuteFn>>(async () => [])
    const scopeExecute = jest.fn<Promise<unknown>, Parameters<ExecuteFn>>(async () => [])
    const { service, scopeEm } = makeService(serviceExecute, scopeExecute)

    await expect(
      service.getEncryptedFieldNames('scope:entity:miss', 't1', 'org1', { em: scopeEm }),
    ).resolves.toEqual([])
    const unscoped = service.getEncryptedFieldNames('scope:entity:miss', 't1', 'org1')
    await expect(unscoped).resolves.toEqual([])

    // Three candidates (org-scoped, tenant-scoped, global), each queried once
    // per call: the scoped miss must not let the unscoped call skip its lookup.
    expect(scopeExecute).toHaveBeenCalledTimes(3)
    expect(serviceExecute).toHaveBeenCalledTimes(3)
  })

  it('never joins a pending unscoped read for the same map', async () => {
    let releaseUnscoped!: (rows: unknown) => void
    const gate = new Promise<unknown>((resolve) => {
      releaseUnscoped = resolve
    })
    const serviceExecute = jest.fn<Promise<unknown>, Parameters<ExecuteFn>>(() => gate)
    const scopeExecute = jest.fn<Promise<unknown>, Parameters<ExecuteFn>>(async () => [
      mapRow([{ field: 'title' }]),
    ])
    const { service, scopeEm } = makeService(serviceExecute, scopeExecute)

    const unscoped = service.getEncryptedFieldNames('scope:entity:inflight', 't1', 'org1')
    const scoped = service.getEncryptedFieldNames('scope:entity:inflight', 't1', 'org1', {
      em: scopeEm,
    })
    await expect(scoped).resolves.toEqual(['title'])
    expect(scopeExecute).toHaveBeenCalledTimes(1)

    releaseUnscoped([])
    await expect(unscoped).resolves.toEqual([])
  })

  it('keeps the legacy two-argument call shape for unscoped lookups', async () => {
    const serviceExecute = jest.fn<Promise<unknown>, Parameters<ExecuteFn>>(async () => [])
    const scopeExecute = jest.fn<Promise<unknown>, Parameters<ExecuteFn>>(async () => [])
    const { service } = makeService(serviceExecute, scopeExecute)

    await service.getEncryptedFieldNames('scope:entity:legacy', 't1', 'org1')

    expect(serviceExecute).toHaveBeenCalledTimes(3)
    for (const call of serviceExecute.mock.calls) expect(call.length).toBe(2)
    expect(scopeExecute).not.toHaveBeenCalled()
  })
})
