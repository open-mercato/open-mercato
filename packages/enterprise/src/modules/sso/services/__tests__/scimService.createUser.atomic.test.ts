import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { lockAuthorizationUserRows } from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'
import { SsoIdentity, SsoUserDeactivation, ScimProvisioningLog } from '../../data/entities'
import type { ScimScope } from '../../api/scim/context'
import { ScimService } from '../scimService'

jest.mock('@open-mercato/core/modules/auth/lib/authorizationStateLocks', () => ({ lockAuthorizationUserRows: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (manager: { findOne: (...args: unknown[]) => Promise<unknown> }, ...args: unknown[]) => manager.findOne(...args),
}))

type RecordValue = Record<string, unknown>
type State = { user: RecordValue | null; identities: RecordValue[]; deactivations: RecordValue[]; sessions: string[]; keys: RecordValue[]; logs: RecordValue[] }
const scope = { tenantId: 'tenant-1', organizationId: 'org-1', ssoConfigId: 'config-1', config: {} } as ScimScope
const payload = { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'user@example.com', externalId: 'external-1', active: false }

function fixture(existingIdentity = false, existingUser = true) {
  let state: State = {
    user: existingUser ? { id: 'user-1', email: 'user@example.com', tenantId: 'tenant-1', organizationId: 'org-1' } : null,
    identities: existingIdentity ? [{ id: 'identity-1', userId: 'user-1', externalId: 'external-1', ssoConfigId: 'config-1', createdAt: new Date(), updatedAt: new Date() }] : [],
    deactivations: [], sessions: existingUser ? ['user-1'] : [],
    keys: existingUser ? [
      { id: 'key-1', sessionUserId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null },
      { id: 'machine-key', sessionUserId: null, tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null },
      { id: 'other-user', sessionUserId: 'user-2', tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null },
      { id: 'other-tenant', sessionUserId: 'user-1', tenantId: 'tenant-2', organizationId: 'org-1', deletedAt: null },
      { id: 'other-org', sessionUserId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-2', deletedAt: null },
    ] : [], logs: [],
  }
  let failAt: 'session' | 'credential' | 'audit' | null = null
  let lastCreated: unknown
  let counter = 0
  const manager = {
    transactional: jest.fn(async (run: (transaction: EntityManager) => Promise<unknown>) => {
      const pending = structuredClone(state)
      const entityTypes = new WeakMap<object, unknown>()
      const transaction = {
        findOne: jest.fn(async (entity: unknown, where: RecordValue) => {
          if (entity === User) return pending.user
          if (entity === SsoIdentity) return pending.identities.find((identity) => where.externalId ? identity.externalId === where.externalId : identity.userId === where.userId) ?? null
          if (entity === SsoUserDeactivation) return pending.deactivations.find((record) => record.userId === where.userId) ?? null
          return null
        }),
        create: jest.fn((entity: unknown, data: RecordValue) => {
          const record = { id: `record-${++counter}`, ...data }
          entityTypes.set(record, entity)
          return record
        }),
        persist: jest.fn((record: RecordValue) => {
          lastCreated = entityTypes.get(record)
          if (lastCreated === User) pending.user = record
          if (lastCreated === SsoIdentity) pending.identities.push(record)
          if (lastCreated === SsoUserDeactivation) pending.deactivations.push(record)
          if (lastCreated === ScimProvisioningLog) pending.logs.push(record)
          return transaction
        }),
        flush: jest.fn(async () => {
          if (failAt === 'audit' && lastCreated === ScimProvisioningLog) throw new Error('[internal] audit unavailable')
        }),
        nativeUpdate: jest.fn(async (_entity: unknown, where: RecordValue, updates: RecordValue) => {
          if (failAt === 'credential') throw new Error('[internal] delegated revocation unavailable')
          for (const key of pending.keys) {
            if (Object.entries(where).every(([field, value]) => key[field] === value)) Object.assign(key, updates)
          }
        }),
        nativeDelete: jest.fn(async (_entity: unknown, where: RecordValue) => {
          if (failAt === 'session') throw new Error('[internal] session revocation unavailable')
          pending.sessions = pending.sessions.filter((userId) => userId !== where.user)
        }),
      }
      const result = await run(transaction as unknown as EntityManager)
      state = pending
      return result
    }),
  }
  return {
    manager,
    service: new ScimService(manager as unknown as EntityManager),
    state: () => state,
    fail: (stage: typeof failAt) => { failAt = stage },
  }
}

describe('atomic inactive SCIM provisioning', () => {
  beforeEach(() => jest.mocked(lockAuthorizationUserRows).mockReset())

  it.each([false, true])('rolls back identity and deactivation when revocation fails for existingUser=%s, then safely retries', async (existingUser) => {
    const world = fixture(false, existingUser)
    const original = structuredClone(world.state())
    world.fail('session')

    await expect(world.service.createUser(payload, scope, 'https://example.test')).rejects.toThrow('session revocation unavailable')
    expect(world.state()).toEqual(original)
    world.fail(null)
    const response = await world.service.createUser(payload, scope, 'https://example.test')

    expect(response.resource.active).toBe(false)
    expect(world.state().identities).toHaveLength(1)
    expect(world.state().deactivations).toHaveLength(1)
    expect(world.state().sessions).toEqual([])
    expect(world.state().logs).toHaveLength(1)
    expect(world.manager.transactional).toHaveBeenCalledTimes(2)
  })

  it('reconciles active:false on an idempotent retry with an existing identity', async () => {
    const world = fixture(true)

    const response = await world.service.createUser(payload, scope, 'https://example.test')

    expect(response.status).toBe(200)
    expect(response.resource.active).toBe(false)
    expect(world.state().identities).toHaveLength(1)
    expect(world.state().deactivations).toHaveLength(1)
    expect(world.state().sessions).toEqual([])
    expect(world.state().logs).toHaveLength(1)
    expect(lockAuthorizationUserRows).toHaveBeenCalledTimes(1)
  })

  it('reconciles an inactive retry without an external identifier instead of leaving the existing link active', async () => {
    const world = fixture(true)
    const { externalId: _externalId, ...withoutExternalId } = payload

    const response = await world.service.createUser(withoutExternalId, scope, 'https://example.test')

    expect(response.status).toBe(200)
    expect(response.resource.active).toBe(false)
    expect(world.state().identities).toHaveLength(1)
    expect(world.state().sessions).toEqual([])
    expect(world.state().logs).toHaveLength(1)
  })

  it('revokes only delegated keys in the deactivated user, tenant, and organization scope', async () => {
    const world = fixture(true)

    await world.service.createUser(payload, scope, 'https://example.test')

    expect(world.state().keys.find((key) => key.id === 'key-1')?.deletedAt).toBeInstanceOf(Date)
    expect(world.state().keys.filter((key) => key.id !== 'key-1').every((key) => key.deletedAt === null)).toBe(true)
  })

  it('rolls back identity, deactivation, and staff sessions when delegated key revocation fails', async () => {
    const world = fixture()
    const original = structuredClone(world.state())
    world.fail('credential')

    await expect(world.service.createUser(payload, scope, 'https://example.test')).rejects.toThrow('delegated revocation unavailable')
    expect(world.state()).toEqual(original)
  })

  it('rolls back revocation and identity writes when the audit flush fails', async () => {
    const world = fixture()
    const original = structuredClone(world.state())
    world.fail('audit')

    await expect(world.service.createUser(payload, scope, 'https://example.test')).rejects.toThrow('audit unavailable')
    expect(world.state()).toEqual(original)
  })
})
