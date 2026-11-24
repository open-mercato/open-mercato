import { createContainer, asValue, InjectionMode } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createTransactionalEntityManagerDouble } from '../../../../test-utils/transactionalEntityManagerDouble'
import { register as registerApiKeysDi } from '../../di'
import { createApiKeyOneTimeIssuer, type ApiKeyOneTimeIssuer } from '../oneTimeIssuerService'

describe('apiKeyOneTimeIssuer', () => {
  let createdRecords: Array<Record<string, unknown>>
  let mockEm: EntityManager
  let forkSpy: jest.Mock

  beforeEach(() => {
    createdRecords = []
    const baseDouble = createTransactionalEntityManagerDouble({
      create: jest.fn((_Entity: unknown, data: Record<string, unknown>) => {
        const record = { id: `key-${createdRecords.length}`, deletedAt: null, ...data }
        createdRecords.push(record)
        return record
      }),
      persist: jest.fn(function persist(this: unknown) {
        return this
      }),
      flush: jest.fn(async () => undefined),
      find: jest.fn(async (_Entity: unknown, query: { id?: { $in?: string[] } }) => {
        if (Array.isArray(query?.id?.$in)) {
          return createdRecords.filter((record) => query.id!.$in!.includes(String(record.id)))
        }
        return []
      }),
      findOne: jest.fn(async (_Entity: unknown, query: { id?: string }) =>
        createdRecords.find((record) => record.id === query?.id) ?? null,
      ),
    })
    const originalFork = baseDouble.fork
    forkSpy = jest.fn(() => originalFork())
    baseDouble.fork = forkSpy
    mockEm = baseDouble as unknown as EntityManager
  })

  it('registers apiKeyOneTimeIssuer as a scoped service in api_keys/di.ts and issues on a context-detached EM', async () => {
    const root = createContainer({ injectionMode: InjectionMode.CLASSIC }) as unknown as AppContainer
    registerApiKeysDi(root)

    const scope = root.createScope()
    scope.register({ em: asValue(mockEm) })

    const issuer = scope.resolve<ApiKeyOneTimeIssuer>('apiKeyOneTimeIssuer')
    expect(scope.resolve('apiKeyOneTimeIssuer')).toBe(issuer)

    let receivedSecret: string | null = null
    const outcome = await issuer.withOneTimeApiKey(
      {
        name: '__workflow_inst-1__',
        description: 'One-time key',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        roles: ['role-1', 'role-1'],
        expiresAt: null,
      },
      async (secret) => {
        receivedSecret = secret
        return { ok: true }
      },
    )

    expect(outcome).toEqual({ ok: true })
    expect(receivedSecret).toMatch(/^omk_/)
    expect(forkSpy).toHaveBeenCalledWith({
      clear: true,
      freshEventManager: true,
      useContext: false,
    })
    expect(createdRecords).toHaveLength(1)
    expect(createdRecords[0].tenantId).toBe('tenant-1')
    expect(createdRecords[0].organizationId).toBe('org-1')
    expect(createdRecords[0].rolesJson).toEqual(['role-1'])
    expect(createdRecords[0].deletedAt).toBeInstanceOf(Date)
  })

  it('cleans up the issued key when the callback throws or aborts', async () => {
    const issuer = createApiKeyOneTimeIssuer(mockEm)
    const abortController = new AbortController()
    const abortError = Object.assign(new Error('Aborted'), { name: 'AbortError' })

    await expect(
      issuer.withOneTimeApiKey(
        {
          name: '__workflow_err__',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          roles: ['role-1'],
        },
        async () => {
          throw new Error('downstream failed')
        },
      ),
    ).rejects.toThrow('downstream failed')

    await expect(
      issuer.withOneTimeApiKey(
        {
          name: '__workflow_abort__',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          roles: ['role-1'],
        },
        async () =>
          new Promise((_resolve, reject) => {
            abortController.signal.addEventListener('abort', () => reject(abortError), { once: true })
            queueMicrotask(() => abortController.abort())
          }),
      ),
    ).rejects.toThrow('Aborted')

    expect(createdRecords).toHaveLength(2)
    expect(createdRecords.every((record) => record.deletedAt instanceof Date)).toBe(true)
  })

  it('refuses issuance when tenantId or roles are empty without minting a key', async () => {
    const issuer = createApiKeyOneTimeIssuer(mockEm)

    await expect(
      issuer.withOneTimeApiKey(
        { name: 'bad', tenantId: '   ', organizationId: 'org-1', roles: ['role-1'] },
        async () => 'never',
      ),
    ).rejects.toThrow(/tenantId/)

    await expect(
      issuer.withOneTimeApiKey(
        { name: 'bad', tenantId: 'tenant-1', organizationId: 'org-1', roles: ['  '] },
        async () => 'never',
      ),
    ).rejects.toThrow(/role ID/)

    expect(createdRecords).toHaveLength(0)
    expect(forkSpy).not.toHaveBeenCalled()
  })
})
