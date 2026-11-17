/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUserInvitation } from '../../data/entities'
import { CustomerInvitationService } from '../customerInvitationService'

jest.mock('../../lib/tokenGenerator', () => ({
  generateSecureToken: () => 'replacement-token',
  hashToken: (token: string) => `hashed:${token}`,
}))
jest.mock('@open-mercato/shared/lib/encryption/aes', () => ({
  hashForLookup: () => 'recipient-hash', lookupHashCandidates: () => ['recipient-hash'],
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (em: EntityManager, entity: typeof CustomerUserInvitation, where: object, options?: object) => em.findOne(entity, where, options),
}))

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

function signal() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => { resolve = complete })
  return { promise, resolve }
}

type InvitationFilter = {
  token?: string
  id?: string
  tenantId?: string
  organizationId?: string
  emailHash?: string
  acceptedAt?: null
  cancelledAt?: null
  expiresAt?: { $gt: Date }
}

function fixture(options: { pauseLookup?: boolean; pauseFlush?: boolean } = {}) {
  const original = {
    id: '33333333-3333-4333-8333-333333333333', ...scope,
    email: 'recipient@example.test', emailHash: 'recipient-hash', token: 'hashed:original-token',
    roleIdsJson: ['old-role'], displayName: 'Original', expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null, cancelledAt: null,
  } as CustomerUserInvitation
  const rows = [original]
  const lookupStarted = signal()
  const resumeLookup = signal()
  const flushStarted = signal()
  const resumeFlush = signal()
  const lockReleased = signal()
  let locked = false
  let managed: CustomerUserInvitation | null = null
  let inserted: CustomerUserInvitation | null = null

  function matches(row: CustomerUserInvitation, where: InvitationFilter) {
    return (!where.id || row.id === where.id)
      && (!where.token || row.token === where.token)
      && (!where.tenantId || row.tenantId === where.tenantId)
      && (!where.organizationId || row.organizationId === where.organizationId)
      && (!where.emailHash || row.emailHash === where.emailHash)
      && (!('acceptedAt' in where) || row.acceptedAt === null)
      && (!('cancelledAt' in where) || row.cancelledAt === null)
      && (!where.expiresAt || row.expiresAt > where.expiresAt.$gt)
  }

  const findOne = jest.fn(async (_entity: unknown, where: InvitationFilter, findOptions?: { lockMode?: number }) => {
    const snapshot = rows.find((row) => matches(row, where))
    if (where.token) return snapshot ?? null
    lookupStarted.resolve()
    if (options.pauseLookup) await resumeLookup.promise
    if (findOptions?.lockMode) {
      managed = rows.find((row) => matches(row, where)) ?? null
      locked = managed !== null
    } else {
      managed = snapshot ? { ...snapshot } : null
    }
    return managed
  })
  const flush = jest.fn(async () => {
    flushStarted.resolve()
    if (options.pauseFlush) await resumeFlush.promise
    if (inserted) rows.push(inserted)
    if (managed && managed !== original) {
      for (const key of ['email', 'token', 'displayName', 'expiresAt', 'roleIdsJson'] as const) {
        Object.assign(original, { [key]: managed[key] })
      }
    }
  })
  const nativeUpdate = jest.fn(async (_entity: unknown, where: InvitationFilter, update: { cancelledAt: Date }) => {
    if (locked) await lockReleased.promise
    const row = rows.find((item) => matches(item, where))
    if (!row) return 0
    row.cancelledAt = update.cancelledAt
    return 1
  })
  const manager = {
    findOne, nativeUpdate, flush,
    create: jest.fn((_entity: unknown, data: Partial<CustomerUserInvitation>) => ({ id: '44444444-4444-4444-8444-444444444444', acceptedAt: null, cancelledAt: null, ...data })),
    persist: jest.fn((row: CustomerUserInvitation) => { inserted = row; return { flush } }),
    transactional: jest.fn(async (operation: (em: EntityManager) => Promise<unknown>): Promise<unknown> => {
      try { return await operation(manager as unknown as EntityManager) } finally { locked = false; lockReleased.resolve() }
    }),
  }
  const service = new CustomerInvitationService(manager as unknown as EntityManager)
  return { service, manager, original, rows, lookupStarted, resumeLookup, flushStarted, resumeFlush }
}

describe('CustomerInvitationService resend/cancel serialization', () => {
  it('keeps a cancellation that wins before the pending lookup locks and issues a fresh usable invitation', async () => {
    const state = fixture({ pauseLookup: true })
    const originalToken = state.original.token
    const resend = state.service.createInvitation('recipient@example.test', scope, { roleIds: ['new-role'], displayName: 'Replacement' })
    await state.lookupStarted.promise
    await expect(state.service.cancelInvitation(state.original.id, scope)).resolves.toBe(true)
    const cancelled = { ...state.original, roleIdsJson: [...state.original.roleIdsJson!] }
    state.resumeLookup.resolve()
    const result = await resend

    expect(state.original).toEqual(cancelled)
    expect(state.original.token).toBe(originalToken)
    expect(result.reused).toBe(false)
    expect(result.invitation.id).not.toBe(state.original.id)
    expect(await state.service.findByToken(result.rawToken)).toBe(result.invitation)
    expect(state.manager.nativeUpdate.mock.calls.every((call) => Object.keys(call[2]).join() === 'cancelledAt')).toBe(true)
  })

  it('creates a fresh invitation if the prior one expires while its pending lookup waits', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-29T00:00:00Z') })
    try {
      const state = fixture({ pauseLookup: true })
      const originalToken = state.original.token
      const resend = state.service.createInvitation('recipient@example.test', scope, { roleIds: ['new-role'] })
      await state.lookupStarted.promise
      jest.advanceTimersByTime(61_000)
      state.resumeLookup.resolve()
      const result = await resend
      expect(result.reused).toBe(false)
      expect(result.invitation.id).not.toBe(state.original.id)
      expect(state.original.token).toBe(originalToken)
      expect(await state.service.findByToken(result.rawToken)).toBe(result.invitation)
    } finally {
      jest.useRealTimers()
    }
  })

  it('holds the resend lock through managed flush, then lets cancellation revoke the rotated token', async () => {
    const state = fixture({ pauseFlush: true })
    const resend = state.service.createInvitation('recipient@example.test', scope, { roleIds: ['new-role'] })
    await state.flushStarted.promise
    let cancellationSettled = false
    const cancellation = state.service.cancelInvitation(state.original.id, scope).then((result) => { cancellationSettled = true; return result })
    try {
      await Promise.resolve()
      await Promise.resolve()
      expect(cancellationSettled).toBe(false)
    } finally {
      state.resumeFlush.resolve()
      await Promise.all([resend, cancellation])
    }
    const result = await resend
    expect(result.reused).toBe(true)
    expect(result.invitation).toBe(state.original)
    expect(await cancellation).toBe(true)
    expect(state.original.cancelledAt).toBeInstanceOf(Date)
    expect(state.original.acceptedAt).toBeNull()
    expect(await state.service.findByToken(result.rawToken)).toBeNull()
  })
})
