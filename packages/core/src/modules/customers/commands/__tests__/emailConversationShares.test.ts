/**
 * Authorization + idempotency coverage for
 * `customers.email_conversation_shares.set`.
 *
 * Owner-only is structural here (the owner is always the authenticated actor and
 * no request field names another), so what needs asserting is the refusal set:
 * api-key principals, a share that would grant access to nothing, a stale
 * version, and the concurrent-insert race the unique index creates.
 */

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: jest.fn(),
}))

const findOneWithDecryptionMock = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

const withAtomicFlushMock = jest.fn(async (_em: unknown, phases: Array<() => unknown>) => {
  for (const phase of phases) await phase()
})
jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: (...args: unknown[]) => (withAtomicFlushMock as never)(...(args as never[])),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_k: string, d?: string) => d ?? _k }),
}))

const emitEventMock = jest.fn()
jest.mock('../../events', () => ({
  emitCustomersEvent: (...args: unknown[]) => emitEventMock(...args),
}))

const canShareMock = jest.fn(async () => true)
jest.mock('../../lib/conversationShares', () => ({
  canShareConversation: (...args: unknown[]) => canShareMock(...(args as never[])),
}))

jest.mock('../shared', () => ({
  ensureTenantScope: jest.fn(),
  ensureOrganizationScope: jest.fn(),
}))

import { setEmailConversationShareCommand as cmd } from '../emailConversationShares'

const TENANT = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'
const OWNER = '11111111-1111-4111-8111-111111111111'
const PERSON = '55555555-5555-4555-8555-555555555555'
const SHARE = '66666666-6666-4666-8666-666666666666'

let emState: Record<string, unknown>

function ctx(auth: Record<string, unknown> | null = { sub: OWNER }) {
  return {
    container: { resolve: () => emState },
    auth,
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  } as never
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    organizationId: ORG,
    personEntityId: PERSON,
    shared: true,
    ...overrides,
  } as never
}

function makeEm(over: Record<string, unknown> = {}) {
  const self: Record<string, unknown> = {
    fork: () => self,
    findOne: jest.fn(async () => null),
    create: jest.fn((_e: unknown, data: Record<string, unknown>) => ({ id: SHARE, ...data })),
    persist: jest.fn(),
    ...over,
  }
  return self
}

beforeEach(() => {
  jest.clearAllMocks()
  canShareMock.mockResolvedValue(true)
  findOneWithDecryptionMock.mockResolvedValue({ id: PERSON })
  emState = makeEm()
})

describe('actor resolution', () => {
  it('rejects an api-key principal — it owns no mailbox', async () => {
    await expect(cmd.execute(input(), ctx({ isApiKey: true, sub: 'api_key:1' }))).rejects.toMatchObject({
      status: 401,
    })
  })

  it('rejects a context with no auth at all', async () => {
    await expect(cmd.execute(input(), ctx(null))).rejects.toMatchObject({ status: 401 })
  })
})

describe('person scoping', () => {
  it('404s when the person is not visible in the tenant/org', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    await expect(cmd.execute(input(), ctx())).rejects.toMatchObject({ status: 404 })
    expect(withAtomicFlushMock).not.toHaveBeenCalled()
  })
})

describe('sharing', () => {
  it('refuses with 400 when there is no private conversation to hand over', async () => {
    canShareMock.mockResolvedValue(false)
    await expect(cmd.execute(input(), ctx())).rejects.toMatchObject({ status: 400 })
    // Never persist a grant that would unlock nothing.
    expect(withAtomicFlushMock).not.toHaveBeenCalled()
    expect(emitEventMock).not.toHaveBeenCalled()
  })

  it('creates the grant and emits the audit event', async () => {
    const result = await cmd.execute(input(), ctx())
    expect(result).toMatchObject({ shareId: SHARE, changed: true })
    expect(emitEventMock).toHaveBeenCalledWith(
      'customers.email.conversation_visibility_changed',
      expect.objectContaining({ shared: true, ownerUserId: OWNER }),
    )
  })

  it('is a no-op when already shared', async () => {
    emState = makeEm({ findOne: jest.fn(async () => ({ id: SHARE, updatedAt: new Date() })) })
    const result = await cmd.execute(input(), ctx())
    expect(result).toMatchObject({ shareId: SHARE, changed: false })
    expect(withAtomicFlushMock).not.toHaveBeenCalled()
  })

  it('converges to changed:false when a concurrent insert wins the unique index', async () => {
    // Two concurrent PUT {shared:true} both read "no row" and both insert; the
    // loser hits customer_email_conv_shares_uq. The caller's desired end state is
    // already true, and the route documents this operation as idempotent — so a
    // 23505 must not surface as a 500.
    let call = 0
    emState = makeEm({
      findOne: jest.fn(async () => (call++ === 0 ? null : { id: SHARE, updatedAt: new Date() })),
    })
    withAtomicFlushMock.mockImplementationOnce(async () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' })
    })

    const result = await cmd.execute(input(), ctx())

    expect(result).toMatchObject({ changed: false })
    // Not reported as a change, so no audit event for a write that did not happen.
    expect(emitEventMock).not.toHaveBeenCalled()
  })

  it('still propagates a non-unique-violation database error', async () => {
    withAtomicFlushMock.mockImplementationOnce(async () => {
      throw Object.assign(new Error('deadlock'), { code: '40P01' })
    })
    await expect(cmd.execute(input(), ctx())).rejects.toThrow('deadlock')
  })
})

describe('un-sharing', () => {
  it('soft-deletes the grant and emits the revoke event', async () => {
    const row: Record<string, unknown> = { id: SHARE, updatedAt: new Date(), deletedAt: null }
    emState = makeEm({ findOne: jest.fn(async () => row) })

    const result = await cmd.execute(input({ shared: false }), ctx())

    expect(result).toMatchObject({ shareId: SHARE, changed: true })
    expect(row.deletedAt).toBeInstanceOf(Date)
    expect(emitEventMock).toHaveBeenCalledWith(
      'customers.email.conversation_visibility_changed',
      expect.objectContaining({ shared: false }),
    )
  })

  it('is a no-op when nothing is shared', async () => {
    const result = await cmd.execute(input({ shared: false }), ctx())
    expect(result).toMatchObject({ shareId: null, changed: false })
  })
})

describe('optimistic locking', () => {
  it('throws 409 on a stale expectedUpdatedAt', async () => {
    emState = makeEm({
      findOne: jest.fn(async () => ({
        id: SHARE,
        updatedAt: new Date('2026-08-25T10:00:00.000Z'),
      })),
    })
    await expect(
      cmd.execute(input({ shared: false, expectedUpdatedAt: '2026-08-01T00:00:00.000Z' }), ctx()),
    ).rejects.toMatchObject({ status: 409 })
    expect(withAtomicFlushMock).not.toHaveBeenCalled()
  })
})
